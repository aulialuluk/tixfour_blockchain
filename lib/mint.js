import { authenticator } from "otplib";
import { getAdmin } from "./server";
import {
  ensureChainEvent,
  extractMintedTokenId,
  getIssuer,
  refFor,
  withIssuerLock,
} from "./chain";
import {
  hasOrdersPhase2Cols,
  hasTicketsPhase2Cols,
  pickOrderFields,
  pickTicketFields,
} from "./db-compat";

/**
 * Menerbitkan semua tiket untuk satu pesanan berstatus `paid`.
 * - Klaim atomik: paid -> minting (request ganda tidak bisa mint dua kali).
 * - Kompatibel dengan skema dasar (schema.sql) maupun skema Fase 2 (migration_phase2.sql).
 * - Aman diulang: tiket yang sudah tercatat dilewati; tiket yang sudah ada di chain
 *   (tapi gagal tersimpan di DB) dipulihkan lewat tokenByRef.
 * - Gagal di tengah jalan -> status kembali `paid` + mencatat error agar auto-retry berjalan.
 */
export async function mintOrder(orderId) {
  const db = getAdmin();
  const stale = new Date(Date.now() - 2 * 60_000).toISOString();

  const [hasOrderP2, hasTicketP2] = await Promise.all([
    hasOrdersPhase2Cols(db),
    hasTicketsPhase2Cols(db),
  ]);

  const claimPatch = pickOrderFields(hasOrderP2, {
    status: "minting",
    minting_in_progress: true,
    minting_at: new Date().toISOString(),
    last_error: null,
    mint_error: null,
  });

  // Klaim atomik pesanan untuk proses minting
  const { data: order, error: claimErr } = await db
    .from("orders")
    .update(claimPatch)
    .eq("order_id", orderId)
    .or(`status.eq.paid,and(status.eq.minting,minting_at.lt.${stale}),and(status.eq.minting,minting_at.is.null)`)
    .select()
    .maybeSingle();

  if (claimErr) {
    console.error(`[MINT CLAIM ERROR] Order ${orderId}:`, claimErr.message);
    return { ok: false, error: claimErr.message };
  }

  if (!order) return { ok: false, skipped: true };

  try {
    const { data: ev, error: evErr } = await db
      .from("events")
      .select("chain_event_id, max_supply")
      .eq("id", order.event_id)
      .single();
    if (evErr || !ev) throw new Error("Acara terkait tidak ditemukan.");

    const { data: existing } = await db.from("tickets").select("idx").eq("order_id", orderId);
    const done = new Set((existing || []).map((t) => t.idx));

    await withIssuerLock(async () => {
      // Perbarui timestamp klaim setelah antre lock agar tidak dianggap stale saat diproses.
      await db
        .from("orders")
        .update({ minting_at: new Date().toISOString() })
        .eq("order_id", orderId)
        .eq("status", "minting");

      const { contract, address, provider } = getIssuer();
      try {
        // Pastikan acara sudah tercatat di smart contract (menangani acara hasil seed/DB langsung).
        await ensureChainEvent(contract, ev.chain_event_id, ev.max_supply);

        // Dikerjakan berurutan untuk menghindari nonce bentrok pada satu wallet.
        for (let i = 0; i < order.qty; i++) {
          if (done.has(i)) continue;
          const ref = refFor(orderId, i);

          let tokenId = await contract.tokenByRef(ref);
          let txHash = null;
          if (tokenId === 0n) {
            const tx = await contract.mint(address, ev.chain_event_id, ref);
            const receipt = await tx.wait(1, 45_000);
            txHash = receipt.hash;
            tokenId = extractMintedTokenId(contract, receipt);
            if (tokenId === 0n) {
              tokenId = await contract.tokenByRef(ref);
            }
          }
          if (!tokenId || tokenId === 0n) {
            throw new Error(`Token ID tidak ditemukan setelah mint untuk tiket #${i + 1}.`);
          }

          const ticketRow = pickTicketFields(hasTicketP2, {
            order_id: orderId,
            idx: i,
            token_id: Number(tokenId),
            tx_hash: txHash,
            totp_secret: authenticator.generateSecret(),
            user_id: order.user_id,
            event_id: order.event_id,
            sync_status: "synced",
          });

          const { error } = await db
            .from("tickets")
            .upsert(ticketRow, { onConflict: "order_id,idx", ignoreDuplicates: true });
          if (error) throw new Error("DB: " + error.message);
        }
      } finally {
        provider?.destroy?.();
      }
    });

    const donePatch = pickOrderFields(hasOrderP2, {
      status: "minted",
      minting_in_progress: false,
      mint_error: null,
      last_error: null,
    });
    const { error: doneErr } = await db.from("orders").update(donePatch).eq("order_id", orderId);
    if (doneErr) throw new Error("DB status update: " + doneErr.message);

    return { ok: true };
  } catch (e) {
    const msg = String(e.shortMessage || e.message || e).slice(0, 500);
    console.error(`[MINT ERROR] Order ${orderId}:`, msg);
    const failPatch = pickOrderFields(hasOrderP2, {
      status: "paid",
      minting_in_progress: false,
      mint_error: msg,
      last_error: msg,
    });
    await db.from("orders").update(failPatch).eq("order_id", orderId);

    return { ok: false, error: msg };
  }
}

export const mintTicketsForOrder = mintOrder;
