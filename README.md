# TixFour

**TixFour** adalah platform pemesanan dan verifikasi tiket acara digital berbasis web yang menggabungkan pembayaran **Midtrans Snap Sandbox**, pencatatan kepemilikan tiket **ERC-721 (non-transferable)** di jaringan **Ethereum Sepolia**, **QR dinamis TOTP** (berubah setiap 30 detik), serta dukungan **PWA luring (offline-first)** untuk pembeli dan petugas pintu masuk (Event Organizer).

---

## Fitur Utama & Role Pengguna

1. **Pembeli (`user`)**
   - Menjelajahi daftar acara, melihat rincian biaya transparan (harga tiket, biaya layanan 2,5%, biaya administrasi, PPN 11% dari total harga tiket, dan biaya metode pembayaran QRIS/VA), serta melakukan checkout via **Midtrans Snap Sandbox**.
   - Penerbitan tiket NFT otomatis ke smart contract `TixFour` di Ethereum Sepolia setelah pembayaran terkonfirmasi.
   - Halaman **Tiket Saya** (`/tickets`) memisahkan **Tiket Aktif** (dapat membuka QR TOTP dinamis dan disimpan lokal untuk akses luring) dan **Riwayat Tiket** (tiket yang sudah dipindai/check-in tidak dapat menghasilkan QR lagi).
   - Verifikasi keaslian token on-chain melalui `/verify/[tokenId]`.

2. **Event Organizer (`eo`)**
   - **Scanner Tiket** (`/eo/scanner`): memindai QR tiket via kamera atau input manual Token ID & kode OTP 6-digit, bekerja secara **offline-first** menggunakan IndexedDB + verifikasi kriptografis TOTP, lalu menyinkronkan status check-in ke Supabase saat online.
   - **Dashboard EO** (`/eo/dashboard`): memantau kapasitas tiket, jumlah hadir, distribusi kedatangan per jam, log peserta, dan ekspor laporan CSV.

3. **Admin (`admin`)**
   - **Dashboard Admin** (`/admin`): membuat, mengedit, dan menghapus acara (otomatis mendaftarkan acara ke smart contract `TixFour` melalui `createEvent`).
   - **Monitoring Pesanan** (`/admin/monitoring`): menampilkan **Laporan Pencocokan Data** (Acara, Kuota, Smart Contract, Tiket Terbit, Status) serta **Pesanan Tertunda** (cek status Midtrans, batalkan pesanan pending, atau terbitkan ulang NFT).

---

## Struktur Proyek

```text
contracts/TixFour.sol           Smart contract ERC-721 non-transferable (soulbound-style)
supabase/
  schema.sql                    Skema tabel dasar (events, orders, tickets) + RLS
  migration_phase2.sql          Skema Fase 2 (profiles, eo_id, status minting, check-in)
  seed_phase2.sql               Data awal (SQL)
lib/
  chain.js                      Koneksi ethers.js Sepolia, lock nonce wallet, & sinkronisasi acara
  mint.js                       Proses minting tiket ERC-721 yang idempoten
  midtrans.js                   Integrasi Midtrans Snap & Core API Status
  order-sync.js                 Penyelarasan status pesanan Midtrans -> database -> minting
  pricing.js                    Perhitungan harga, biaya layanan/admin, PPN 11%, & gateway fee
  totp.js                       Implementasi TOTP RFC 6238 (WebCrypto)
  scanner-db.js                 Penyimpanan manifest & antrean check-in luring (IndexedDB)
app/
  page.js                       Beranda & daftar acara
  events/[id]/page.js           Detail acara & checkout Midtrans
  tickets/page.js               Tiket Saya (Tiket Aktif & Riwayat Tiket)
  ticket/[tokenId]/page.js      Tampilan tiket & QR TOTP dinamis
  verify/[tokenId]/page.js      Verifikasi keaslian tiket di smart contract Sepolia
  admin/page.js                 Dashboard Admin (Kelola Acara)
  admin/monitoring/page.js      Monitoring Pesanan (Pencocokan Data & Pesanan Tertunda)
  eo/scanner/page.js            Scanner Tiket EO (Kamera & Input Manual Luring)
  eo/dashboard/page.js          Dashboard Analitik Kehadiran EO
  api/                          Endpoint API (orders, midtrans webhook, tickets, admin, eo)
scripts/
  seed.mjs                      Seeder akun, acara, & registrasi acara ke smart contract
  test-all.mjs                  Pengujian otomatis unit (TOTP, pricing, RBAC, db-compat, chain)
public/
  sw.js, manifest.json          Konfigurasi PWA luring
```

---

## Panduan Pengaturan & Menjalankan Lokal

### 1. Persiapan Layanan & Kunci
1. **Supabase**: Buat project baru, lalu salin Project URL, `anon key`, dan `service_role key` (Settings > API).
2. **Midtrans Sandbox**: Daftar di dashboard Midtrans Sandbox dan ambil Server Key serta Client Key (Settings > Access Keys).
3. **RPC Sepolia & Wallet Kustodian**: Siapkan URL RPC Sepolia (Alchemy/Infura/public RPC) serta wallet khusus pengujian yang memiliki saldo ETH Sepolia.
4. **Smart Contract**: Deploy `contracts/TixFour.sol` (Solidity `0.8.24`+, OpenZeppelin v5) ke jaringan Sepolia dengan `initialOwner` = alamat wallet kustodian, lalu catat alamat kontraknya ke `CONTRACT_ADDRESS`.

### 2. Pengaturan Database
Jalankan isi `supabase/schema.sql` dan `supabase/migration_phase2.sql` di **Supabase > SQL Editor**.

### 3. Konfigurasi Environment & Jalankan Aplikasi
```bash
cp .env.example .env.local   # lengkapi seluruh variabel, misalnya ADMIN_EMAILS=aul@email.com
npm install
node scripts/seed.mjs        # opsional: seed akun uji, acara, & sinkronisasi ke smart contract
npm run dev
```

Untuk deployment produksi (misalnya Vercel), atur **Payment Notification URL** di Midtrans Dashboard ke:
`https://<domain-aul>.vercel.app/api/midtrans/webhook`

### 4. Pengujian Otomatis
```bash
node scripts/test-all.mjs
```
