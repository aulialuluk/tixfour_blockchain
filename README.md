# TixFour (MVP)

Next.js + Supabase + Midtrans Snap Sandbox + ERC-721 di Ethereum Sepolia. QR dinamis TOTP dan PWA luring.

## Struktur
```
contracts/TixFour.sol        smart contract (deploy via Remix)
supabase/schema.sql          tabel + RLS
lib/                         pricing, chain (ethers), midtrans, mint, totp, api
app/api/                     orders, webhook, mint, tickets, admin
app/                         halaman: acara, checkout, tiket saya, tiket (QR), verify, admin
public/sw.js, manifest.json  PWA
```

## Langkah 1 - Akun dan kunci
1. **Supabase**: buat project. Catat Project URL, anon key, service_role key (Settings > API).
   Authentication > Providers > Email: matikan "Confirm email" selama development.
2. **Midtrans Sandbox**: daftar di sandbox dashboard. Ambil Server Key dan Client Key (Settings > Access Keys).
3. **RPC Sepolia**: buat app di Alchemy atau Infura, salin URL HTTPS Sepolia.
4. **Wallet kustodian**: buat akun MetaMask BARU khusus proyek ini. Export private key-nya. Ambil ETH Sepolia dari faucet
   (Alchemy / Google Cloud Web3 faucet). Jangan pakai wallet berisi aset asli.

## Langkah 2 - Database
Supabase > SQL Editor > tempel isi `supabase/schema.sql` > Run.

## Langkah 3 - Deploy smart contract (Remix)
1. Buka https://remix.ethereum.org, buat file `TixFour.sol`, tempel isi `contracts/TixFour.sol`.
2. Compile dengan Solidity 0.8.24 atau lebih baru. OpenZeppelin v5 di-import otomatis oleh Remix.
3. **Uji dulu di Remix VM**: createEvent(1, 2), mint 2 kali, mint ke-3 harus revert "Sold out", mint dengan
   orderRef sama harus revert, panggil transferFrom harus revert "non-transferable", mint dari akun lain harus revert.
4. Deploy ke Sepolia: Environment = "Injected Provider - MetaMask" (akun wallet kustodian),
   constructor `initialOwner` = alamat wallet kustodian.
5. Salin alamat kontrak ke `CONTRACT_ADDRESS`.

## Langkah 4 - Jalankan lokal
```bash
cp .env.example .env.local     # isi semua nilainya
npm install
npm run dev
```
`ADMIN_EMAILS` = email akun yang boleh membuka /admin. Daftarkan akun itu dulu lewat halaman /login.

## Langkah 5 - Deploy ke Vercel (disarankan sebelum tes pembayaran)
Webhook Midtrans butuh URL publik HTTPS, dan service worker hanya jalan di HTTPS.
1. Push ke GitHub, import di Vercel.
2. Isi semua variabel di `.env.example` pada Project Settings > Environment Variables.
3. Deploy. Midtrans Dashboard > Settings > Configuration > **Payment Notification URL**:
   `https://<domain-kamu>.vercel.app/api/midtrans/webhook`
   (Untuk lokal: pakai tunnel seperti ngrok / cloudflared ke localhost:3000.)

## Langkah 6 - Isi data awal
Login sebagai admin > /admin > "Acara baru". Ini menyimpan acara di Supabase DAN memanggil `createEvent` di kontrak
(butuh ETH Sepolia di wallet kustodian).

## Langkah 7 - Coba alur lengkap
1. Daftar akun pembeli lain > pilih acara > Bayar.
2. Di popup Snap Sandbox, pilih QRIS atau VA, lalu selesaikan dengan **Midtrans Simulator**
   (https://simulator.sandbox.midtrans.com).
3. Buka /tickets. Status: Dibayar > Menerbitkan > tiket muncul. Cek transaksinya di Sepolia Etherscan.
4. Buka tiket, QR berganti tiap 30 detik.

## Langkah 8 - Pengujian sesuai proposal
| Uji | Cara |
|---|---|
| Bayar berhasil / gagal / kedaluwarsa | Midtrans Simulator, cek kolom `status` di tabel `orders` |
| Signature tidak valid | `curl -X POST <url>/api/midtrans/webhook -H "Content-Type: application/json" -d '{"order_id":"x","status_code":"200","gross_amount":"1.00","signature_key":"salah"}'` harus 403 |
| 100 webhook ganda | Kirim ulang notifikasi yang sama 100x (script loop); `tickets` tetap sejumlah qty |
| Kuota / non-owner / order sama / transfer | Skenario Remix di Langkah 3, lalu ulangi di Sepolia |
| Waktu penerbitan < 30 detik | Bandingkan `paid_at` dengan `tickets.created_at` |
| Mint gagal lalu berhasil | Kosongkan saldo ETH wallet sementara > bayar > isi lagi > buka /tickets atau klik "Coba ulang" di /admin |
| Luring | Buka halaman tiket saat online, muat ulang sekali, aktifkan mode pesawat, buka lagi: QR tetap berganti |

**Penting untuk uji luring:** gunakan build produksi (URL Vercel atau `npm run build && npm start` di localhost).
Service worker sengaja dimatikan pada `npm run dev`.

## Keterbatasan yang disengaja (sesuai proposal)
- Tidak ada cron: pesanan `paid` yang tidak dibuka pembeli dan tidak ditangani admin tetap tertahan.
- Tiket tidak bisa dipindahtangankan; tidak ada penjualan kembali.
- Pemindaian/validasi oleh petugas (online maupun offline) belum ada. `/verify/[tokenId]` hanya membuktikan penerbitan.
- Pemeriksaan kuota di API belum atomik penuh; kontrak tetap menolak penerbitan melebihi `maxSupply`.
- Tarif gateway (VA Rp4.000, QRIS 0,7%) adalah asumsi proposal dan dihitung di `lib/pricing.js`.
