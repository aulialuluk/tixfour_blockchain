import crypto from "node:crypto";
import { getAdmin, requireUser, isBuyer, json } from "@/lib/server";
import { calcPricing } from "@/lib/pricing";
import { createSnap } from "@/lib/midtrans";
import { hasOrdersPhase2Cols, pickOrderFields } from "@/lib/db-compat";

export const maxDuration = 30;
const PENDING_TTL_MS = 30 * 60_000; // sama dengan expiry Snap

export async function POST(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);

  // Requirement D.2: Tolak permintaan pembuatan pesanan dari akun role admin atau eo
  if (!isBuyer(user)) {
    return json(
      { error: "Mode pembelian tiket dinonaktifkan untuk akun pengelola (Admin/EO)." },
      403
    );
  }

  const body = await req.json().catch(() => ({}));
  const qty = Number(body.qty);
  const method = body.method;
  if (!body.eventId || !Number.isInteger(qty) || qty < 1 || !["qris", "va"].includes(method)) {
    return json({ error: "Data pesanan tidak valid." }, 400);
  }

  const db = getAdmin();
  const { data: ev } = await db.from("events").select("*").eq("id", body.eventId).single();
  if (!ev) return json({ error: "Acara tidak ditemukan." }, 404);

  // Pembatasan frekuensi: maks 5 pesanan per menit per akun
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count: recent } = await db
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((recent ?? 0) >= 5) return json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, 429);

  // Kuota: pending yang belum kedaluwarsa + paid/minting/minted dihitung terpakai
  const { data: rows } = await db
    .from("orders")
    .select("qty,user_id,status,created_at")
    .eq("event_id", ev.id)
    .in("status", ["pending", "paid", "minting", "minted"]);
  const cutoff = Date.now() - PENDING_TTL_MS;
  const active = (rows || []).filter(
    (r) => r.status !== "pending" || new Date(r.created_at).getTime() >= cutoff
  );
  const sold = active.reduce((s, r) => s + r.qty, 0);
  const mine = active.filter((r) => r.user_id === user.id).reduce((s, r) => s + r.qty, 0);

  if (mine + qty > ev.max_per_account) {
    return json({ error: `Batas pembelian ${ev.max_per_account} tiket per akun.` }, 409);
  }
  if (sold + qty > ev.max_supply) {
    return json({ error: "Tiket tidak cukup atau sudah habis." }, 409);
  }

  // Total dihitung di server. Angka dari client tidak dipercaya.
  const pricing = calcPricing(ev.price, qty, method);
  const orderId = `TIX4-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

  const { error: insErr } = await db.from("orders").insert({
    order_id: orderId,
    user_id: user.id,
    event_id: ev.id,
    qty,
    payment_method: method,
    ticket_subtotal: pricing.ticketSubtotal,
    service_fee: pricing.serviceFee,
    admin_fee: pricing.adminFee,
    tax: pricing.tax,
    gateway_fee: pricing.gatewayFee,
    total: pricing.total,
    status: "pending",
  });
  if (insErr) return json({ error: insErr.message }, 500);

  try {
    const snap = await createSnap({
      orderId,
      pricing,
      eventName: ev.name,
      qty,
      price: ev.price,
      method,
      email: user.email,
    });

    // Simpan snap_token dan snap_redirect_url ke database Supabase (aman jika kolom Fase 2 belum ada)
    const hasOrderP2 = await hasOrdersPhase2Cols(db);
    const snapPatch = pickOrderFields(hasOrderP2, {
      snap_token: snap.token,
      snap_redirect_url: snap.redirect_url,
    });
    const { error: snapUpdErr } = await db.from("orders").update(snapPatch).eq("order_id", orderId);
    if (snapUpdErr) console.error(`[ORDER SNAP UPDATE ERROR] ${orderId}:`, snapUpdErr.message);

    return json({
      orderId,
      snapToken: snap.token,
      snapRedirectUrl: snap.redirect_url,
      total: pricing.total,
    });
  } catch (e) {
    await db.from("orders").update({
      status: "failed",
      last_error: String(e.message).slice(0, 500),
    }).eq("order_id", orderId);
    return json({ error: "Gagal membuat transaksi pembayaran." }, 502);
  }
}
