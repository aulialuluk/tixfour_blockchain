import { ethers } from "ethers";
import { getAdmin, requireAdmin, json } from "@/lib/server";
import { getReadContract } from "@/lib/chain";
import { hasOrdersPhase2Cols, hasProfilesTable } from "@/lib/db-compat";

export const maxDuration = 60;

const RPC_TIMEOUT_MS = 10_000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function openVerifiedContract() {
  const contractAddress = process.env.CONTRACT_ADDRESS?.trim();
  if (!process.env.SEPOLIA_RPC_URL?.trim() || !contractAddress) {
    return { contract: null, warning: "SEPOLIA_RPC_URL atau CONTRACT_ADDRESS belum dikonfigurasi." };
  }
  if (!ethers.isAddress(contractAddress)) {
    return { contract: null, warning: `CONTRACT_ADDRESS tidak valid: ${contractAddress}` };
  }

  let contract = null;
  try {
    contract = getReadContract();
    const code = await withTimeout(
      contract.runner.getCode(contractAddress),
      RPC_TIMEOUT_MS,
      "Timeout menghubungi RPC Sepolia."
    );
    if (!code || code === "0x" || code.startsWith("0xef0100")) {
      contract.runner?.destroy?.();
      return {
        contract: null,
        warning: `Smart contract TixFour belum ter-deploy di ${contractAddress} pada jaringan Sepolia.`,
      };
    }
    return { contract, warning: null };
  } catch (err) {
    contract?.runner?.destroy?.();
    return {
      contract: null,
      warning: err.shortMessage || err.message || "Gagal terhubung ke smart contract.",
    };
  }
}

// Laporan pencocokan & daftar pesanan tertahan (pending + paid)
export async function GET(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const db = getAdmin();

  const { data: events, error: eventsErr } = await db
    .from("events")
    .select("id,name,chain_event_id,max_supply");
  if (eventsErr) return json({ error: eventsErr.message }, 500);

  const [hasOrderP2, hasProfiles] = await Promise.all([
    hasOrdersPhase2Cols(db),
    hasProfilesTable(db),
  ]);

  const stuckCols = hasOrderP2
    ? "order_id,user_id,event_id,status,qty,total,payment_method,last_error,mint_error,snap_token,snap_redirect_url,created_at,paid_at,events(name)"
    : "order_id,user_id,event_id,status,qty,total,payment_method,last_error,snap_token,created_at,paid_at,events(name)";

  // Requirement A.5: Ambil semua pesanan pending DAN paid (termasuk minting), urutkan created_at DESC
  const { data: stuck, error: stuckErr } = await db
    .from("orders")
    .select(stuckCols)
    .in("status", ["pending", "paid", "minting"])
    .order("created_at", { ascending: false });
  if (stuckErr) return json({ error: stuckErr.message }, 500);

  // Ambil email pembeli untuk setiap pesanan tertahan
  const userIds = [...new Set((stuck || []).map((o) => o.user_id).filter(Boolean))];
  const emailsById = {};
  if (userIds.length > 0) {
    if (hasProfiles) {
      try {
        const { data: profiles } = await db
          .from("profiles")
          .select("id, email")
          .in("id", userIds);
        if (profiles) {
          for (const p of profiles) {
            if (p.email) emailsById[p.id] = p.email;
          }
        }
      } catch {}
    }

    const missingIds = userIds.filter((id) => !emailsById[id]);
    if (missingIds.length > 0) {
      try {
        const { data: listData } = await db.auth.admin.listUsers();
        if (listData?.users) {
          for (const u of listData.users) {
            emailsById[u.id] = u.email;
          }
        }
      } catch {}
    }
  }

  const enrichedStuck = (stuck || []).map((o) => ({
    order_id: o.order_id,
    status: o.status,
    qty: o.qty,
    total: o.total,
    event_name: o.events?.name || "Acara",
    buyer_email: emailsById[o.user_id] || "Pembeli (anonim)",
    payment_method: o.payment_method,
    last_error: o.last_error || o.mint_error,
    created_at: o.created_at,
    paid_at: o.paid_at,
    snap_token: o.snap_token,
    snap_redirect_url: o.snap_redirect_url,
  }));

  const { contract, warning: chainWarning } = await openVerifiedContract();
  const rows = [];

  try {
    for (const e of events || []) {
      const { count, error: countErr } = await db
        .from("tickets")
        .select("*", { count: "exact", head: true })
        .eq("event_id", e.id);
      if (countErr) return json({ error: countErr.message }, 500);

      const dbCount = count ?? 0;
      let chain = null;
      let onChain = null;
      let rowError = chainWarning;

      if (contract) {
        try {
          const [exists, countVal] = await withTimeout(
            Promise.all([
              contract.eventExists(e.chain_event_id),
              contract.mintedCount(e.chain_event_id),
            ]),
            RPC_TIMEOUT_MS,
            "Timeout membaca data acara dari smart contract."
          );
          onChain = Boolean(exists);
          chain = Number(countVal);
          if (!onChain) {
            rowError = `Acara #${e.chain_event_id} belum terdaftar di smart contract.`;
          }
        } catch (err) {
          rowError = err.shortMessage || err.message || "Gagal membaca data chain.";
        }
      }

      rows.push({
        id: e.id,
        name: e.name,
        chain_event_id: e.chain_event_id,
        max_supply: e.max_supply,
        db: dbCount,
        chain,
        on_chain: onChain,
        match: chain !== null && onChain !== false && dbCount === chain,
        ...(rowError ? { error: rowError } : {}),
      });
    }
  } finally {
    contract?.runner?.destroy?.();
  }

  return json({
    rows,
    stuck: enrichedStuck,
    ...(chainWarning ? { chainWarning } : {}),
  });
}
