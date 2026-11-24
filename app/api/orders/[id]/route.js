import { getAdmin, requireUser, isAdmin, json } from "@/lib/server";
import { syncOrderWithMidtrans } from "@/lib/order-sync";
import { hasOrdersPhase2Cols } from "@/lib/db-compat";

export const maxDuration = 60;

export async function GET(req, { params }) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  const { id } = await params;
  const db = getAdmin();

  const hasOrderP2 = await hasOrdersPhase2Cols(db);
  const cols = hasOrderP2
    ? "order_id,user_id,status,qty,total,last_error,mint_error,snap_token,snap_redirect_url,created_at"
    : "order_id,user_id,status,qty,total,last_error,snap_token,created_at";

  const { data, error } = await db
    .from("orders")
    .select(cols)
    .eq("order_id", id)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Tidak ditemukan." }, 404);
  if (data.user_id !== user.id && !isAdmin(user)) return json({ error: "Tidak diizinkan." }, 403);

  if (data.status === "pending" || data.status === "paid") {
    const synced = await syncOrderWithMidtrans(data);
    if (synced.status) data.status = synced.status;
  }
  return json(data);
}

export async function DELETE(req, { params }) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  const { id } = await params;
  const db = getAdmin();

  const { data: order } = await db
    .from("orders")
    .select("order_id,user_id,status")
    .eq("order_id", id)
    .maybeSingle();

  if (!order) return json({ error: "Tidak ditemukan." }, 404);
  if (order.user_id !== user.id && !isAdmin(user)) return json({ error: "Tidak diizinkan." }, 403);
  if (order.status !== "pending") return json({ error: "Hanya pesanan pending yang dapat dibatalkan." }, 400);

  await db.from("orders").update({
    status: "expired",
    last_error: "Dibatalkan secara manual.",
  }).eq("order_id", id);

  return json({ ok: true, status: "expired" });
}
