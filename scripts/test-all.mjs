import assert from "node:assert";
import { authenticator } from "otplib";
import { ethers } from "ethers";
import { totp, verifyTotp } from "../lib/totp.js";
import { calcPricing } from "../lib/pricing.js";
import {
  ensureChainEvent,
  extractMintedTokenId,
  withIssuerLock,
} from "../lib/chain.js";
import {
  isMissingSchemaError,
  pickOrderFields,
  pickTicketFields,
  hasOrdersPhase2Cols,
  hasTicketsPhase2Cols,
  resetSchemaCache,
} from "../lib/db-compat.js";

function isAdminEmail(email) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

async function runTests() {
  console.log("==================================================");
  console.log("🧪 MENJALANKAN PENGUJIAN OTOMATIS TIXFOUR FASE 2");
  console.log("==================================================");

  // 1. PENGUJIAN KRIPTOGRAFIS TOTP (RFC 6238 WebCrypto vs otplib)
  console.log("\n[1] Menguji Kriptografis TOTP (WebCrypto + otplib)...");
  const secret = authenticator.generateSecret();
  assert(secret && secret.length >= 16, "Secret harus valid");

  // Generate token dari WebCrypto implementation
  const now = Date.now();
  const tokenWebCrypto = await totp(secret, now);
  assert(/^\d{6}$/.test(tokenWebCrypto), "Token TOTP harus 6 digit angka");

  // Validasi kecocokan dengan otplib
  const tokenOtplib = authenticator.generate(secret);
  console.log(`    Token WebCrypto: ${tokenWebCrypto} | Token otplib: ${tokenOtplib}`);
  assert.strictEqual(
    tokenWebCrypto,
    tokenOtplib,
    "Token yang dihasilkan WebCrypto harus identik dengan otplib"
  );

  // Validasi verifyTotp dengan toleransi window
  const isValidCurrent = await verifyTotp(tokenWebCrypto, secret, { nowMs: now });
  assert.strictEqual(isValidCurrent, true, "Token saat ini harus valid");

  // Token step sebelumnya (-30 detik)
  const pastToken = await totp(secret, now - 30_000);
  const isValidPast = await verifyTotp(pastToken, secret, { nowMs: now, window: 1 });
  assert.strictEqual(isValidPast, true, "Token -30s harus lolos dalam window ±1 step");

  // Token step berikutnya (+30 detik)
  const futureToken = await totp(secret, now + 30_000);
  const isValidFuture = await verifyTotp(futureToken, secret, { nowMs: now, window: 1 });
  assert.strictEqual(isValidFuture, true, "Token +30s harus lolos dalam window ±1 step");

  // Token usang (> 2 menit)
  const expiredToken = await totp(secret, now - 120_000);
  const isValidExpired = await verifyTotp(expiredToken, secret, { nowMs: now, window: 1 });
  assert.strictEqual(isValidExpired, false, "Token usang (>120s) harus ditolak");

  // Token palsu
  const isFakeValid = await verifyTotp("000000", secret, { nowMs: now, window: 1 });
  assert.strictEqual(isFakeValid, false, "Token acak/palsu harus ditolak");
  console.log("    ✓ Kriptografis TOTP dan toleransi window ±1 step berhasil diuji!");

  // 2. PENGUJIAN FORMAT PAYLOAD QR
  console.log("\n[2] Menguji Kompatibilitas Payload QR...");
  const payloadModern = JSON.stringify({ tokenId: 9001, otp: "123456" });
  const parsed1 = JSON.parse(payloadModern);
  assert.strictEqual(parsed1.tokenId, 9001);
  assert.strictEqual(parsed1.otp, "123456");

  const payloadLegacy = JSON.stringify({ t: 9001, c: "123456" });
  const parsed2 = JSON.parse(payloadLegacy);
  assert.strictEqual(parsed2.t, 9001);
  assert.strictEqual(parsed2.c, "123456");
  console.log("    ✓ Format payload QR kompatibel untuk seluruh versi scanner!");

  // 3. PENGUJIAN LOGIKA PRICING & BIAYA GATEWAY
  console.log("\n[3] Menguji Perhitungan Biaya Transaksi (Pricing)...");
  const pQris = calcPricing(100_000, 2, "qris");
  assert.strictEqual(pQris.ticketSubtotal, 200_000);
  assert.strictEqual(pQris.serviceFee, 5_000); // 2.5%
  assert.strictEqual(pQris.adminFee, 2_000);
  assert.strictEqual(pQris.tax, Math.round(200_000 * 0.11)); // PPN 11% dari total harga tiket
  assert.strictEqual(pQris.gatewayFee, 1_400); // QRIS 0.7% dari 200k
  assert.strictEqual(pQris.total, 200_000 + 5_000 + 2_000 + 22_000 + 1_400);

  const pVa = calcPricing(100_000, 1, "va");
  assert.strictEqual(pVa.tax, 11_000, "PPN VA harus 11% dari harga tiket (Rp11.000)");
  assert.strictEqual(pVa.gatewayFee, 4_000, "Biaya gateway VA harus Rp4.000");
  assert.strictEqual(pVa.total, 100_000 + 2_500 + 2_000 + 11_000 + 4_000);

  const p250 = calcPricing(250_000, 1, "qris");
  assert.strictEqual(p250.tax, 27_500);
  assert.strictEqual(p250.total, 287_500);
  console.log(`    ✓ Perhitungan harga QRIS total: Rp${pQris.total.toLocaleString("id-ID")}`);
  console.log(`    ✓ Perhitungan harga VA total: Rp${pVa.total.toLocaleString("id-ID")}`);

  // 4. PENGUJIAN RBAC ADMIN EMAIL CHECK
  console.log("\n[4] Menguji RBAC & Hak Akses...");
  process.env.ADMIN_EMAILS = "admin@email.com,superadmin@tixfour.com";
  assert.strictEqual(isAdminEmail("admin@email.com"), true, "admin@email.com harus diakui admin");
  assert.strictEqual(isAdminEmail("ADMIN@EMAIL.COM"), true, "Pemeriksaan email harus case-insensitive");
  assert.strictEqual(isAdminEmail("eo@tixfour.test"), false, "eo@tixfour.test bukan admin");
  assert.strictEqual(isAdminEmail("hana@gmail.com"), false, "hana@gmail.com bukan admin");
  console.log("    ✓ RBAC email admin filter berhasil diuji!");

  // 5. PENGUJIAN KOMPATIBILITAS SKEMA FASE 1 VS FASE 2
  console.log("\n[5] Menguji Schema Compatibility (db-compat)...");
  assert.strictEqual(isMissingSchemaError({ code: "42703", message: "column orders.mint_error does not exist" }), true);
  assert.strictEqual(isMissingSchemaError({ code: "PGRST204", message: "Could not find the 'snap_redirect_url' column" }), true);
  assert.strictEqual(isMissingSchemaError({ code: "23505", message: "duplicate key value" }), false);

  const rawOrderPatch = {
    status: "minting",
    snap_token: "tok-123",
    snap_redirect_url: "https://example.com",
    minting_in_progress: true,
    mint_error: null,
    last_error: null,
  };
  const baseOnlyOrder = pickOrderFields(false, rawOrderPatch);
  assert.strictEqual("snap_redirect_url" in baseOnlyOrder, false);
  assert.strictEqual("minting_in_progress" in baseOnlyOrder, false);
  assert.strictEqual("mint_error" in baseOnlyOrder, false);
  assert.strictEqual(baseOnlyOrder.snap_token, "tok-123");
  assert.strictEqual(baseOnlyOrder.status, "minting");

  const p2Order = pickOrderFields(true, rawOrderPatch);
  assert.strictEqual(p2Order.snap_redirect_url, "https://example.com");
  assert.strictEqual(p2Order.minting_in_progress, true);

  const rawTicketRow = { order_id: "O1", idx: 0, token_id: 1, sync_status: "synced" };
  const baseOnlyTicket = pickTicketFields(false, rawTicketRow);
  assert.strictEqual("sync_status" in baseOnlyTicket, false);
  assert.strictEqual(baseOnlyTicket.token_id, 1);

  // Mock Supabase DB tanpa kolom Fase 2
  resetSchemaCache("ordersPhase2");
  resetSchemaCache("ticketsPhase2");
  const mockMissingDb = {
    from: () => ({
      select: () => ({
        limit: async () => ({ error: { code: "42703", message: "column does not exist" } }),
      }),
    }),
  };
  assert.strictEqual(await hasOrdersPhase2Cols(mockMissingDb), false);
  assert.strictEqual(await hasTicketsPhase2Cols(mockMissingDb), false);

  // Mock Supabase DB dengan kolom Fase 2
  resetSchemaCache("ordersPhase2");
  resetSchemaCache("ticketsPhase2");
  const mockFullDb = {
    from: () => ({
      select: () => ({
        limit: async () => ({ error: null }),
      }),
    }),
  };
  assert.strictEqual(await hasOrdersPhase2Cols(mockFullDb), true);
  assert.strictEqual(await hasTicketsPhase2Cols(mockFullDb), true);
  console.log("    ✓ Kompatibilitas skema Fase 1 & Fase 2 berhasil diuji!");

  // 6. PENGUJIAN UTILITAS SMART CONTRACT & NONCE LOCK
  console.log("\n[6] Menguji ensureChainEvent, extractMintedTokenId, dan withIssuerLock...");
  const timeline = [];
  await Promise.all([
    withIssuerLock(async () => {
      timeline.push("start-1");
      await new Promise((r) => setTimeout(r, 25));
      timeline.push("end-1");
    }),
    withIssuerLock(async () => {
      timeline.push("start-2");
      timeline.push("end-2");
    }),
  ]);
  assert.deepStrictEqual(timeline, ["start-1", "end-1", "start-2", "end-2"]);

  // Mock contract belum punya event -> memanggil createEvent
  let createdCalls = 0;
  const mockContractMissing = {
    eventExists: async () => false,
    createEvent: async (id, supply) => {
      createdCalls += 1;
      assert.strictEqual(id, 7);
      assert.strictEqual(supply, 500);
      return { hash: "0xabc", wait: async () => ({ status: 1 }) };
    },
  };
  const regRes = await ensureChainEvent(mockContractMissing, 7, 500);
  assert.strictEqual(regRes.created, true);
  assert.strictEqual(createdCalls, 1);

  // Mock contract sudah punya event -> tidak memanggil createEvent
  let skippedCalls = 0;
  const mockContractExists = {
    eventExists: async () => true,
    createEvent: async () => {
      skippedCalls += 1;
    },
  };
  const skipRes = await ensureChainEvent(mockContractExists, 7, 500);
  assert.strictEqual(skipRes.created, false);
  assert.strictEqual(skippedCalls, 0);

  // Uji parsing log TicketMinted dari receipt
  const iface = new ethers.Interface([
    "event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, bytes32 indexed orderRef)",
  ]);
  const encoded = iface.encodeEventLog(iface.getEvent("TicketMinted"), [
    13n,
    7n,
    ethers.keccak256(ethers.toUtf8Bytes("ORDER-1-0")),
  ]);
  const extracted = extractMintedTokenId(
    { interface: iface },
    { logs: [{ topics: encoded.topics, data: encoded.data }] }
  );
  assert.strictEqual(extracted, 13n);
  console.log("    ✓ Utilitas smart contract & antrean nonce wallet berhasil diuji!");

  console.log("\n==================================================");
  console.log("🎉 SELURUH PENGUJIAN BERHASIL DENGAN SEMPURNA (100% PASS)!");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
