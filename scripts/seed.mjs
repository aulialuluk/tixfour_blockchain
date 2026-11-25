import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { ensureChainEvent, getIssuer } from "../lib/chain.js";
import {
  hasEventsPhase2Cols,
  hasOrdersPhase2Cols,
  hasProfilesTable,
  hasTicketsPhase2Cols,
  pickOrderFields,
  pickTicketFields,
} from "../lib/db-compat.js";

const require = createRequire(import.meta.url);
const nextEnv = require("@next/env");
const { combinedEnv } = nextEnv.loadEnvConfig(process.cwd());

const supabaseUrl = (combinedEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const serviceKey = (combinedEnv.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_USERS = [
  { email: "admin@email.com", password: "Password123!", role: "admin" },
  { email: "eo@tixfour.test", password: "Password123!", role: "eo" },
  { email: "hana@gmail.com", password: "Password123!", role: "user" },
  { email: "budi@tixfour.test", password: "Password123!", role: "user" },
];

function assertOk(res, label) {
  if (res?.error) {
    throw new Error(`${label}: ${res.error.message}`);
  }
  return res?.data;
}

async function main() {
  console.log("🌱 Menjalankan Seeder TixFour Phase 2...");

  const [hasProfiles, hasEventsP2, hasOrdersP2, hasTicketsP2] = await Promise.all([
    hasProfilesTable(supabase),
    hasEventsPhase2Cols(supabase),
    hasOrdersPhase2Cols(supabase),
    hasTicketsPhase2Cols(supabase),
  ]);

  console.log("Status Skema Supabase:", {
    profiles: hasProfiles,
    events_eo_id: hasEventsP2,
    orders_phase2: hasOrdersP2,
    tickets_phase2: hasTicketsP2,
  });

  // 1. Buat / Sinkronkan User Auth & Metadata Role
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);

  const usersByEmail = {};
  for (const u of SEED_USERS) {
    let existing = listData?.users?.find(
      (x) => x.email?.toLowerCase() === u.email.toLowerCase()
    );

    if (!existing) {
      console.log(`+ Membuat akun: ${u.email} (role: ${u.role})...`);
      const { data: created, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: { role: u.role },
      });
      if (error) {
        throw new Error(`Gagal membuat user ${u.email}: ${error.message}`);
      }
      existing = created.user;
    } else {
      console.log(`= Akun sudah ada: ${u.email} (sinkronisasi metadata role: ${u.role})`);
      if (existing.user_metadata?.role !== u.role) {
        const { data: updated, error: updErr } = await supabase.auth.admin.updateUserById(
          existing.id,
          { user_metadata: { ...existing.user_metadata, role: u.role } }
        );
        if (updErr) {
          console.warn(`  Peringatan update metadata ${u.email}:`, updErr.message);
        } else if (updated?.user) {
          existing = updated.user;
        }
      }
    }

    usersByEmail[u.email] = existing;

    if (hasProfiles) {
      assertOk(
        await supabase.from("profiles").upsert({
          id: existing.id,
          email: u.email,
          role: u.role,
          updated_at: new Date().toISOString(),
        }),
        `upsert profile ${u.email}`
      );
    }
  }

  const eoUser = usersByEmail["eo@tixfour.test"];
  const hanaUser = usersByEmail["hana@gmail.com"];
  const budiUser = usersByEmail["budi@tixfour.test"];

  // 2. Buat / Perbarui Acara Testing (2 acara untuk EO)
  const existingEvents = assertOk(
    await supabase.from("events").select("id, name, chain_event_id, max_supply"),
    "select events"
  );

  async function ensureEvent({ matchText, payload }) {
    const found = existingEvents?.find((e) => e.name.includes(matchText));
    if (found) {
      if (hasEventsP2 && eoUser) {
        assertOk(
          await supabase.from("events").update({ eo_id: eoUser.id }).eq("id", found.id),
          `update eo_id ${found.name}`
        );
      }
      console.log(`= Acara sudah ada: ${found.name} (${found.id}, chain #${found.chain_event_id})`);
      return found;
    }

    const insertRow = { ...payload };
    if (!hasEventsP2) delete insertRow.eo_id;

    const inserted = assertOk(
      await supabase
        .from("events")
        .insert(insertRow)
        .select("id, name, chain_event_id, max_supply")
        .single(),
      `insert event ${payload.name}`
    );
    console.log(`+ Acara dibuat: ${inserted.name} (${inserted.id}, chain #${inserted.chain_event_id})`);
    return inserted;
  }

  const event1 = await ensureEvent({
    matchText: "Soundfest",
    payload: {
      name: "Soundfest Music Festival 2026",
      description: "Festival musik akbar dengan penampilan musisi papan atas nasional dan internasional.",
      venue: "Stadion Madya GBK, Senayan, Jakarta",
      event_date: new Date(Date.now() + 14 * 86400_000).toISOString(),
      price: 150000,
      max_supply: 500,
      max_per_account: 4,
      eo_id: eoUser?.id || null,
    },
  });
  const event1Id = event1.id;

  const event2 = await ensureEvent({
    matchText: "Tech & Blockchain",
    payload: {
      name: "Tech & Blockchain Summit 2026",
      description: "Konferensi teknologi Web3, smart contracts, dan inovasi digital terbesar di Asia Tenggara.",
      venue: "Grand Ballroom JIExpo Kemayoran, Jakarta",
      event_date: new Date(Date.now() + 30 * 86400_000).toISOString(),
      price: 250000,
      max_supply: 300,
      max_per_account: 2,
      eo_id: eoUser?.id || null,
    },
  });
  const event2Id = event2.id;

  // Pastikan acara seed juga tercatat di smart contract Sepolia agar minting tidak gagal "Unknown event"
  if (
    combinedEnv.SEPOLIA_RPC_URL?.trim() &&
    combinedEnv.CONTRACT_ADDRESS?.trim() &&
    combinedEnv.ISSUER_PRIVATE_KEY?.trim()
  ) {
    const { contract, provider } = getIssuer(combinedEnv);
    try {
      for (const ev of [event1, event2]) {
        const res = await ensureChainEvent(contract, ev.chain_event_id, ev.max_supply);
        if (res.created) {
          console.log(`⛓️  Acara didaftarkan ke smart contract: ${ev.name} (chain #${ev.chain_event_id}, tx: ${res.txHash})`);
        } else {
          console.log(`⛓️  Acara sudah ada di smart contract: ${ev.name} (chain #${ev.chain_event_id})`);
        }
      }
    } catch (err) {
      console.warn("⚠️  Peringatan sinkronisasi smart contract:", err.shortMessage || err.message);
    } finally {
      provider?.destroy?.();
    }
  }

  // 3. Buat Transaksi & Tiket Dummy
  if (hanaUser && event1Id) {
    assertOk(
      await supabase.from("orders").upsert(
        pickOrderFields(hasOrdersP2, {
          order_id: "TIX4-SEED-PENDING-01",
          user_id: hanaUser.id,
          event_id: event1Id,
          qty: 1,
          payment_method: "qris",
          ticket_subtotal: 150000,
          service_fee: 3750,
          admin_fee: 2000,
          tax: 633,
          gateway_fee: 1050,
          total: 157433,
          status: "pending",
          snap_token: "mock-snap-token-pending-123",
          snap_redirect_url:
            "https://app.sandbox.midtrans.com/snap/v2/vtweb/mock-snap-token-pending-123",
          created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        })
      ),
      "upsert TIX4-SEED-PENDING-01"
    );

    assertOk(
      await supabase.from("orders").upsert(
        pickOrderFields(hasOrdersP2, {
          order_id: "TIX4-SEED-PAID-01",
          user_id: hanaUser.id,
          event_id: event1Id,
          qty: 1,
          payment_method: "va",
          ticket_subtotal: 150000,
          service_fee: 3750,
          admin_fee: 2000,
          tax: 633,
          gateway_fee: 4000,
          total: 160383,
          status: "paid",
          snap_token: "mock-snap-token-paid-456",
          midtrans_status: "settlement",
          last_error: "Timeout menghubungi RPC Sepolia (Gas estimation timeout).",
          mint_error: "Timeout menghubungi RPC Sepolia (Gas estimation timeout).",
          paid_at: new Date(Date.now() - 60 * 60_000).toISOString(),
          created_at: new Date(Date.now() - 65 * 60_000).toISOString(),
        })
      ),
      "upsert TIX4-SEED-PAID-01"
    );

    assertOk(
      await supabase.from("orders").upsert(
        pickOrderFields(hasOrdersP2, {
          order_id: "TIX4-SEED-MINTED-01",
          user_id: hanaUser.id,
          event_id: event1Id,
          qty: 2,
          payment_method: "qris",
          ticket_subtotal: 300000,
          service_fee: 7500,
          admin_fee: 2000,
          tax: 1045,
          gateway_fee: 2100,
          total: 312645,
          status: "minted",
          snap_token: "mock-snap-token-minted-789",
          midtrans_status: "settlement",
          paid_at: new Date(Date.now() - 120 * 60_000).toISOString(),
          created_at: new Date(Date.now() - 125 * 60_000).toISOString(),
        })
      ),
      "upsert TIX4-SEED-MINTED-01"
    );

    assertOk(
      await supabase.from("tickets").upsert(
        pickTicketFields(hasTicketsP2, {
          order_id: "TIX4-SEED-MINTED-01",
          idx: 0,
          token_id: 9001,
          tx_hash: "0x3a7e589f8931215bb41f2398418920cb95c8812c3f87b32a394a5c92841f3e21",
          totp_secret: "JBSWY3DPEHPK3PXP",
          user_id: hanaUser.id,
          event_id: event1Id,
          created_at: new Date(Date.now() - 120 * 60_000).toISOString(),
        }),
        { onConflict: "order_id,idx" }
      ),
      "upsert ticket 9001"
    );

    assertOk(
      await supabase.from("tickets").upsert(
        pickTicketFields(hasTicketsP2, {
          order_id: "TIX4-SEED-MINTED-01",
          idx: 1,
          token_id: 9002,
          tx_hash: "0x5f9a231b671c890123ef61a29487c50a149b5c2a10486c91d830b81e4918f0a2",
          totp_secret: "KRSXG5CTMVRXEZLU",
          user_id: hanaUser.id,
          event_id: event1Id,
          checked_in_at: new Date(Date.now() - 30 * 60_000).toISOString(),
          checked_in_by: eoUser?.id || null,
          sync_status: "synced",
          created_at: new Date(Date.now() - 120 * 60_000).toISOString(),
        }),
        { onConflict: "order_id,idx" }
      ),
      "upsert ticket 9002"
    );
  }

  if (budiUser && event2Id) {
    assertOk(
      await supabase.from("orders").upsert(
        pickOrderFields(hasOrdersP2, {
          order_id: "TIX4-SEED-MINTED-02",
          user_id: budiUser.id,
          event_id: event2Id,
          qty: 1,
          payment_method: "qris",
          ticket_subtotal: 250000,
          service_fee: 6250,
          admin_fee: 2000,
          tax: 908,
          gateway_fee: 1750,
          total: 260908,
          status: "minted",
          snap_token: "mock-snap-token-minted-999",
          midtrans_status: "settlement",
          paid_at: new Date(Date.now() - 300 * 60_000).toISOString(),
          created_at: new Date(Date.now() - 305 * 60_000).toISOString(),
        })
      ),
      "upsert TIX4-SEED-MINTED-02"
    );

    assertOk(
      await supabase.from("tickets").upsert(
        pickTicketFields(hasTicketsP2, {
          order_id: "TIX4-SEED-MINTED-02",
          idx: 0,
          token_id: 9003,
          tx_hash: "0x7b1c4e928f61a0934d8123fa7591e0bc6241a87c530182bc9401826f18392019",
          totp_secret: "MZXW6YTBOI======",
          user_id: budiUser.id,
          event_id: event2Id,
          created_at: new Date(Date.now() - 300 * 60_000).toISOString(),
        }),
        { onConflict: "order_id,idx" }
      ),
      "upsert ticket 9003"
    );
  }

  if (!hasProfiles || !hasEventsP2 || !hasOrdersP2 || !hasTicketsP2) {
    console.log(
      "\n⚠️ CATATAN: Sebagian kolom/tabel Fase 2 (profiles, eo_id, checked_in_at, dll.) belum ada di Supabase."
    );
    console.log(
      "   Data akun, acara, pesanan, dan tiket dasar SUDAH di-seed."
    );
    console.log(
      "   Jalankan supabase/migration_phase2.sql lalu supabase/seed_phase2.sql di Supabase Dashboard > SQL Editor untuk mengaktifkan penuh skema Fase 2."
    );
  } else {
    console.log("\n✅ Seeding Fase 2 selesai 100% dengan skema lengkap!");
  }
}

main().catch((err) => {
  console.error("❌ Error seeding:", err);
  process.exit(1);
});
