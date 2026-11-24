// Dipakai di server (sumber kebenaran) dan client (hanya untuk tampilan).
export const rupiah = (n) => "Rp" + Number(n).toLocaleString("id-ID");

export function calcPricing(price, qty, method) {
  const ticketSubtotal = price * qty;
  const serviceFee = Math.round(ticketSubtotal * 0.025); // 2,5% dari harga tiket
  const adminFee = 2000; // tetap per transaksi
  const tax = Math.round(ticketSubtotal * 0.11); // PPN 11% dari total harga tiket
  const gatewayFee =
    method === "qris" ? Math.round(ticketSubtotal * 0.007) : 4000; // QRIS 0,7% | VA Rp4.000
  const total = ticketSubtotal + serviceFee + adminFee + tax + gatewayFee;
  return { ticketSubtotal, serviceFee, adminFee, tax, gatewayFee, total };
}
