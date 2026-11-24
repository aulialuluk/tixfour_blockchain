import { getAdmin, requireUser, isAdmin, json } from "@/lib/server";
import { syncOrderWithMidtrans } from "@/lib/order-sync";
import { hasOrdersPhase2Cols } from "@/lib/db-compat";

export const maxDuration = 60;

export async function POST(req, { params }) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const asyncMint = Boolean(body?.asyncMint);

  const db = getAdmin();
  const { data: order, error } = await db
    .from("orders")
    .select("order_id,user_id,status,qty,total,created_at")
    .eq("order_id", id)
    .maybeSingle();

  if (error || !order) {
    return json({ error: "Pesanan tidak ditemukan." }, 404);
  }

  // Hanya pemilik pesanan atau admin yang dapat menyelaraskan status
  if (order.user_id !== user.id && !isAdmin(user)) {
    return json({ error: "Tidak memiliki hak akses ke pesanan ini." }, 403);
  }

  // Sinkronkan langsung dengan Midtrans Core API & jalankan minting ke Sepolia
  const synced = await syncOrderWithMidtrans(order, {
    triggerMint: true,
    awaitMint: !asyncMint,
  });

  if (synced.error) {
    return json({ error: synced.error }, synced.httpStatus || 500);
  }

  const hasOrderP2 = await hasOrdersPhase2Cols(db);
  const cols = hasOrderP2
    ? "order_id,status,midtrans_status,last_error,mint_error,snap_token,snap_redirect_url,paid_at"
    : "order_id,status,midtrans_status,last_error,snap_token,paid_at";

  const { data: updated } = await db
    .from("orders")
    .select(cols)
    .eq("order_id", id)
    .single();

  return json({
    orderId: id,
    status: updated?.status || synced.status,
    midtransStatus: updated?.midtrans_status,
    changed: synced.changed,
    lastError: updated?.last_error || updated?.mint_error || null,
    snapToken: updated?.snap_token || null,
    snapRedirectUrl: updated?.snap_redirect_url || null,
  });
}
