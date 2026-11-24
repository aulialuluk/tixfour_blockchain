import { getAdmin, requireUser, isAdmin, json } from "@/lib/server";
import { mintOrder } from "@/lib/mint";
import { syncOrderWithMidtrans } from "@/lib/order-sync";

export const maxDuration = 60;

// Dipanggil saat pembeli membuka halaman tiket atau admin menekan "Coba ulang".
export async function POST(req, { params }) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  const { id } = await params;

  const { data: order } = await getAdmin()
    .from("orders").select("order_id,user_id,status,total").eq("order_id", id).maybeSingle();
  if (!order) return json({ error: "Pesanan tidak ditemukan." }, 404);
  if (order.user_id !== user.id && !isAdmin(user)) return json({ error: "Tidak diizinkan." }, 403);

  if (order.status === "pending") {
    const synced = await syncOrderWithMidtrans(order, { triggerMint: false });
    if (synced.status) order.status = synced.status;
  }
  if (!["paid", "minting"].includes(order.status)) return json({ status: order.status });

  const result = await mintOrder(id);
  const { data: after } = await getAdmin().from("orders").select("status,last_error").eq("order_id", id).single();
  return json({ ...result, status: after?.status, last_error: after?.last_error });
}
