import { after } from "next/server";
import { getAdmin, requireUser, json } from "@/lib/server";
import { syncOrderWithMidtrans } from "@/lib/order-sync";
import { mintOrder } from "@/lib/mint";
import { hasOrdersPhase2Cols, hasTicketsPhase2Cols } from "@/lib/db-compat";

export const maxDuration = 60;

export async function GET(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  const db = getAdmin();

  const [hasOrderP2, hasTicketP2] = await Promise.all([
    hasOrdersPhase2Cols(db),
    hasTicketsPhase2Cols(db),
  ]);
  const orderCols = hasOrderP2
    ? "order_id,status,qty,total,last_error,mint_error,snap_token,snap_redirect_url,minting_at,created_at,events(name)"
    : "order_id,status,qty,total,last_error,snap_token,minting_at,created_at,events(name)";
  const ticketCols = hasTicketP2
    ? "token_id,tx_hash,order_id,idx,checked_in_at,events(name,event_date,venue)"
    : "token_id,tx_hash,order_id,idx,events(name,event_date,venue)";

  const [ticketsRes, ordersRes] = await Promise.all([
    db
      .from("tickets")
      .select(ticketCols)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    db
      .from("orders")
      .select(orderCols)
      .eq("user_id", user.id)
      .in("status", ["pending", "paid", "minting"])
      .order("created_at", { ascending: false }),
  ]);

  if (ticketsRes.error) return json({ error: ticketsRes.error.message }, 500);
  if (ordersRes.error) return json({ error: ordersRes.error.message }, 500);

  const tickets = (ticketsRes.data || []).map((t) => ({
    ...t,
    checked_in_at: t.checked_in_at || null,
  }));
  const orders = ordersRes.data || [];

  // 1. Selaraskan pesanan `pending` dengan Midtrans Core API (berguna di localhost tanpa webhook)
  const pendingOrders = orders.filter((o) => o.status === "pending").slice(0, 10);
  if (pendingOrders.length) {
    const synced = await Promise.all(
      pendingOrders.map(async (o) => [
        o.order_id,
        await syncOrderWithMidtrans(o, { triggerMint: false }),
      ])
    );
    const byId = Object.fromEntries(synced);
    for (const o of orders) {
      const res = byId[o.order_id];
      if (res?.status) o.status = res.status;
    }
  }

  // 2. Auto-Retry Minting di background untuk seluruh pesanan `paid` (atau `minting` yang stale > 2 menit)
  const staleBefore = Date.now() - 2 * 60_000;
  const paidOrders = orders.filter(
    (o) =>
      o.status === "paid" ||
      (o.status === "minting" &&
        (!o.minting_at || new Date(o.minting_at).getTime() < staleBefore))
  );
  if (paidOrders.length) {
    try {
      after(async () => {
        for (const po of paidOrders) {
          await mintOrder(po.order_id).catch(() => {});
        }
      });
    } catch {
      paidOrders.forEach((po) => mintOrder(po.order_id).catch(() => {}));
    }
  }

  const activeOrders = orders.filter((o) => ["pending", "paid", "minting"].includes(o.status));
  return json({ tickets, orders: activeOrders });
}
