import crypto from "node:crypto";
import { getAdmin, json } from "@/lib/server";
import { syncOrderWithMidtrans } from "@/lib/order-sync";

export const maxDuration = 60; // mint berjalan di after() dan ikut batas ini

function validSignature(b) {
  const expected = crypto
    .createHash("sha512")
    .update(`${b.order_id}${b.status_code}${b.gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest("hex");
  const given = String(b.signature_key || "");
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || !validSignature(body)) return json({ error: "Invalid signature" }, 403);

  const db = getAdmin();
  const { data: order } = await db.from("orders").select("*").eq("order_id", body.order_id).maybeSingle();
  if (!order) return json({ error: "Order not found" }, 404);

  const synced = await syncOrderWithMidtrans(order);
  if (synced.error) return json({ error: synced.error }, synced.httpStatus || 500);

  return json({ ok: true });
}
