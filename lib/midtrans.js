const SNAP_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
const STATUS_URL = "https://api.sandbox.midtrans.com/v2";

const authHeader = () =>
  "Basic " + Buffer.from((process.env.MIDTRANS_SERVER_KEY || "").trim() + ":").toString("base64");

export async function createSnap({ orderId, pricing, eventName, qty, price, method, email }) {
  const item_details = [
    { id: "ticket", name: eventName.slice(0, 50), price, quantity: qty },
    { id: "service", name: "Biaya layanan 2,5%", price: pricing.serviceFee, quantity: 1 },
    { id: "admin", name: "Biaya administrasi", price: pricing.adminFee, quantity: 1 },
    { id: "tax", name: "PPN 11%", price: pricing.tax, quantity: 1 },
    { id: "gateway", name: "Biaya pembayaran", price: pricing.gatewayFee, quantity: 1 },
  ];
  const body = {
    transaction_details: { order_id: orderId, gross_amount: pricing.total },
    item_details,
    customer_details: { email },
    // Nama channel mengikuti dokumentasi Snap. Cek jika ada yang tidak muncul di Sandbox.
    enabled_payments:
      method === "qris"
        ? ["other_qris"]
        : ["bca_va", "bni_va", "bri_va", "permata_va", "cimb_va"],
    expiry: { unit: "minutes", duration: 30 },
  };
  const res = await fetch(SNAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.token) {
    throw new Error("Midtrans: " + JSON.stringify(data.error_messages || data));
  }
  return data; // { token, redirect_url }
}

export async function getStatus(orderId) {
  const res = await fetch(`${STATUS_URL}/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: "application/json", Authorization: authHeader() },
    cache: "no-store",
  });
  return res.json();
}
