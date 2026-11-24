import { after } from "next/server";
import { getAdmin } from "./server";
import { getStatus } from "./midtrans";
import { mintOrder } from "./mint";
import { hasOrdersPhase2Cols, pickOrderFields } from "./db-compat";

/**
 * Menyelaraskan status pesanan `pending` dengan Midtrans Core API `/status`.
 * Dipakai oleh webhook, API sync-status, maupun saat client memuat status pesanan/tiket.
 */
export async function syncOrderWithMidtrans(order, { triggerMint = true, awaitMint = false } = {}) {
  if (!order) {
    return { status: null, changed: false };
  }

  // Jika pesanan sudah paid namun belum minted, dan minting dipicu
  if (order.status === "paid") {
    if (triggerMint) {
      if (awaitMint) {
        await mintOrder(order.order_id);
      } else {
        try {
          after(async () => {
            await mintOrder(order.order_id);
          });
        } catch {
          mintOrder(order.order_id).catch(() => {});
        }
      }
    }
    return { status: "paid", changed: false };
  }

  if (order.status !== "pending") {
    return { status: order.status, changed: false };
  }

  let st;
  try {
    st = await getStatus(order.order_id);
  } catch {
    return { status: order.status, changed: false, error: "Gagal memeriksa status ke Midtrans", httpStatus: 500 };
  }

  // Snap token dibuat tetapi user belum memilih metode bayar -> Midtrans balas 404
  if (!st || String(st.status_code) === "404" || !st.transaction_status) {
    return { status: order.status, changed: false };
  }

  if (order.total && Math.round(Number(st.gross_amount)) !== order.total) {
    return { status: order.status, changed: false, error: "Jumlah pembayaran tidak sesuai", httpStatus: 400 };
  }

  const db = getAdmin();
  const ts = st.transaction_status;

  if (ts === "settlement" || (ts === "capture" && st.fraud_status === "accept")) {
    const hasOrderP2 = await hasOrdersPhase2Cols(db);
    const paidPatch = pickOrderFields(hasOrderP2, {
      status: "paid",
      paid_at: new Date().toISOString(),
      midtrans_status: ts,
      last_error: null,
      mint_error: null,
    });

    // Transisi atomik pending -> paid
    const { data: changed, error: updErr } = await db
      .from("orders")
      .update(paidPatch)
      .eq("order_id", order.order_id)
      .eq("status", "pending")
      .select("order_id");

    if (updErr) {
      console.error(`[SYNC ERROR] Update paid gagal (${order.order_id}):`, updErr.message);
      return { status: order.status, changed: false, error: updErr.message, httpStatus: 500 };
    }

    if (changed?.length && triggerMint) {
      if (awaitMint) {
        await mintOrder(order.order_id);
      } else {
        try {
          after(async () => {
            const r = await mintOrder(order.order_id);
            if (!r.ok && !r.skipped) console.error("Auto-mint failed:", order.order_id, r.error);
          });
        } catch {
          mintOrder(order.order_id).catch((e) => console.error("Auto-mint error:", e));
        }
      }
    }
    return { status: "paid", changed: Boolean(changed?.length) };
  }

  if (ts === "expire") {
    const { data: changed } = await db
      .from("orders")
      .update({ status: "expired", midtrans_status: ts })
      .eq("order_id", order.order_id)
      .eq("status", "pending")
      .select("order_id");
    return { status: "expired", changed: Boolean(changed?.length) };
  }

  if (["deny", "cancel", "failure"].includes(ts)) {
    const { data: changed } = await db
      .from("orders")
      .update({ status: "failed", midtrans_status: ts })
      .eq("order_id", order.order_id)
      .eq("status", "pending")
      .select("order_id");
    return { status: "failed", changed: Boolean(changed?.length) };
  }

  return { status: order.status, changed: false };
}
