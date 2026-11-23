# TixFour

TixFour adalah aplikasi penjualan tiket acara. Aplikasi ini menggunakan Next.js,
Supabase untuk data dan login, Midtrans Sandbox untuk pembayaran, serta smart
contract di jaringan uji Ethereum Sepolia untuk penerbitan tiket.

## Pembagian tugas tim

Pembagian ini menentukan siapa yang mengerjakan dan merapikan tiap bagian.
Semua anggota tetap menerima seluruh file proyek setelah perubahan di-merge
ke branch `main`.

### Kamu (pemilik repo) - tampilan pengguna dan konfigurasi bersama

- Halaman pengguna: `app/page.js`, `app/events/`, `app/login/`, `app/tickets/`,
  `app/ticket/`, dan `app/verify/`.
- Tampilan dan aset: `app/layout.js`, `app/globals.css`, `components/`, dan
  `public/`.
- Konfigurasi bersama dan panduan: `README.md`, `package.json`,
  `package-lock.json`, `next.config.mjs`, `jsconfig.json`, `.gitignore`, dan
  `.env.example`.

### Zahra - admin dan data acara

- Halaman dan API admin: `app/admin/` dan `app/api/admin/events/`.
- Logika dan dukungan data: `lib/events.js`, `lib/db-compat.js`,
  `lib/server.js`, dan `lib/supabase-browser.js`.
- Database dan data awal: seluruh `supabase/` dan `scripts/seed.mjs`.

### Ica - pesanan, pembayaran, dan blockchain

- API pesanan dan tiket: `app/api/orders/`, `app/api/tickets/`, dan
  `app/api/admin/reconcile/`.
- Pembayaran: `app/api/midtrans/`, `lib/midtrans.js`, dan `lib/pricing.js`.
- Penerbitan tiket di blockchain: `contracts/`, `lib/chain.js`, `lib/mint.js`,
  dan `lib/order-sync.js`.

### Hana - fitur EO, check-in, dan autentikasi

- Halaman dan API EO: `app/eo/` dan `app/api/eo/`.
- Login dan keamanan tiket: `app/api/auth/`, `lib/scanner-db.js`,
  `lib/totp.js`, dan `middleware.js`.
- Pengujian otomatis: `scripts/test-all.mjs`.

Kalau tugas membutuhkan perubahan di bagian anggota lain, koordinasikan dulu
dengan pemilik bagian tersebut dan minta ia meninjau Pull Request. Contohnya,
endpoint admin yang memanggil blockchain perlu dikoordinasikan antara Zahra
dan Ica.

## Persiapan sebelum menjalankan

Siapkan:

- Git, Node.js, dan npm.
- Project Supabase yang bisa diakses oleh anggota tim.
- Akun Midtrans Sandbox untuk mencoba pembayaran.
- RPC Sepolia dan kontrak yang sudah di-deploy ke Sepolia untuk mencoba
  penerbitan tiket di blockchain.

Untuk sekadar membuka aplikasi, tetap siapkan nilai environment yang diminta
oleh aplikasi. Fitur pembayaran dan blockchain memerlukan kredensial layanan
yang valid; tanpa itu, fitur tersebut tidak akan berfungsi penuh.

## Menjalankan di Windows

Setelah clone repository, buka PowerShell dan masuk ke folder yang berisi
`package.json`. Pada struktur repository tim, folder aplikasi bernama
`tixfour`:

```powershell
cd .\tixfour
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Isi nilai yang benar di `.env.local` sebelum mencoba fitur aplikasi. Setelah
server berjalan, buka `http://localhost:3000`.

`npm ci` memasang dependency sesuai `package-lock.json`. Jangan menghapus atau
mengubah lock file secara manual. Jika dependency di `package.json` berubah,
jalankan `npm install` agar `package-lock.json` ikut diperbarui, lalu commit
keduanya.

## Mengisi konfigurasi lokal

File `.env.example` berisi nama variabel dan contoh formatnya. Isi nilai
sebenarnya ke `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`: dari
  pengaturan API project Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: service role key Supabase. Jaga rahasia ini.
- `MIDTRANS_SERVER_KEY` dan `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`: dari akun
  Midtrans Sandbox.
- `SEPOLIA_RPC_URL`: URL RPC untuk jaringan Ethereum Sepolia.
- `CONTRACT_ADDRESS`: alamat smart contract TixFour yang sudah di-deploy.
- `ISSUER_PRIVATE_KEY`: private key wallet khusus proyek untuk menerbitkan
  tiket. Jangan gunakan wallet yang menyimpan aset asli.
- `ADMIN_EMAILS`: email admin, pisahkan beberapa email dengan koma.

Minta kredensial yang dibutuhkan kepada pengelola proyek melalui cara yang
aman. Jangan mengirim rahasia ke chat umum atau memasukkannya ke GitHub.
`.env.local` hanya untuk komputer masing-masing dan tidak boleh di-commit.

## Menyiapkan Supabase

Di Supabase Dashboard, buka **SQL Editor** dan jalankan file berikut secara
berurutan:

1. `supabase/schema.sql`
2. `supabase/migration_phase2.sql`

Untuk development, pengaturan konfirmasi email dapat disesuaikan di bagian
Authentication Supabase. Daftarkan akun yang akan dipakai untuk login. File
`supabase/seed_phase2.sql` bersifat opsional untuk membuat data contoh; gunakan
setelah akun testing yang diperlukan sudah dibuat.

## Menyiapkan pembayaran dan blockchain

Untuk menguji pembayaran, gunakan kredensial Midtrans Sandbox. Agar Midtrans
bisa mengirim notifikasi ke komputer lokal, aplikasi perlu URL HTTPS publik
sementara, misalnya melalui ngrok atau Cloudflare Tunnel. Alamat notifikasi
harus mengarah ke:

```text
https://<alamat-publik>/api/midtrans/webhook
```

Untuk menguji penerbitan tiket di blockchain, deploy `contracts/TixFour.sol`
ke Sepolia dan isi `CONTRACT_ADDRESS`, `SEPOLIA_RPC_URL`, serta
`ISSUER_PRIVATE_KEY` di `.env.local`. Jangan masukkan private key ke repository.

## Menjalankan pemeriksaan

Dari folder aplikasi:

```powershell
node .\scripts\test-all.mjs
npm run build
```

Tes otomatis memeriksa beberapa fungsi seperti TOTP, format QR, perhitungan
harga, kompatibilitas skema, dan utilitas blockchain. Pengujian pembayaran
langsung tetap memerlukan konfigurasi layanan eksternal.

## Alur kerja GitHub

1. Setiap anggota membuat branch sendiri, misalnya `fitur/nama-anggota`.
2. Commit perubahan hanya pada tugas yang dikerjakan.
3. Push branch tersebut ke repository yang sama, lalu buat Pull Request ke
   `main`.
4. Minta anggota lain meninjau dan menjalankan aplikasi sebelum Pull Request
   di-merge.
5. Setelah perubahan di-merge, anggota lain menjalankan `git pull` untuk
   mendapatkan perubahan terbaru.

Setiap anggota pull seluruh repository, bukan hanya folder tugasnya. Agar
aplikasi berjalan di komputer anggota lain, file aplikasi dan konfigurasi
contoh harus sudah di-commit, lalu anggota tersebut mengisi `.env.local` dan
menyiapkan akses Supabase, Midtrans, serta Sepolia sesuai kebutuhan.
