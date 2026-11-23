// TOTP (RFC 6238: HMAC-SHA1, 6 digit, 30 detik) memakai WebCrypto di perangkat.
// Kompatibel dengan otplib `authenticator` yang membuat secret di server.
// Berjalan luring penuh di browser tanpa dependensi eksternal.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function totp(secret, nowMs = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(nowMs / 1000 / step);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const off = h[h.length - 1] & 0xf;
  const bin =
    ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Memvalidasi kode TOTP 6-digit terhadap totp_secret tiket.
 * Memberikan toleransi window ±1 step (±30 detik) untuk mengatasi perbedaan jam perangkat.
 */
export async function verifyTotp(token, secret, { window = 1, nowMs = Date.now(), step = 30 } = {}) {
  if (!token || !secret) return false;
  const cleanToken = String(token).trim();
  for (let i = -window; i <= window; i++) {
    const expected = await totp(secret, nowMs + i * step * 1000, step);
    if (expected === cleanToken) {
      return true;
    }
  }
  return false;
}
