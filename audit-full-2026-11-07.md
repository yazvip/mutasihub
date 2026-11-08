# Audit Penuh MutasiHub — 7 November 2026

**Situs:** https://mutasi.rajacek.com · **Backend live:** hash v20 `887136f0` · **Waktu audit:** 7 Nov 2026 ~19:10–19:30 WIB
**Sifat:** AUDIT SAJA — tidak ada kode yang diperbaiki, tidak ada deploy, tidak ada data produksi yang diubah.
**Metode:** 6 pekerja paralel per area (auth & sesi; flow member; flow admin; webhook/sinkronisasi/pembayaran; API & docs; keamanan & kebersihan data). Masing-masing membaca kode lalu membuktikan live via curl (User-Agent browser). Akun tes dibuat per pekerja (prefix `audit1-` s.d. `audit6-`) dan **semuanya sudah dihapus** — verifikasi akhir koordinator: member kembali **5 asli**, 0 akun `audit%` tersisa.
**Verifikasi koordinator:** temuan P0 token (baca kode), literal sandi reset di source halaman change-password, klaim ulang trial (baca kode), callback Gobiz non-atomik (baca kode), tidak ada penanganan timezone di kode — semuanya dikonfirmasi ulang dari kode. Pendaftaran webhook Connecta diverifikasi langsung: `GET /b2b/webhook` live mengembalikan URL webhook (jadi temuan "webhook belum terbukti terdaftar" dari satu pekerja **tidak berlaku lagi**).

> Catatan keamanan laporan ini: tidak ada PIN, sandi, API key, atau nomor rekening utuh yang dicantumkan. Nilai sandi reset admin hanya disebut sebagai "nilai sandi reset" / "konstanta sandi reset" tanpa nilainya.

## Ringkasan eksekutif

- **Total temuan: 44** — **P0: 3 · P1: 17 · P2: 24**.
- Tiga P0 semuanya terkait uang/akses akun, bukan kosmetik: (1) token verifikasi email & reset password **tidak pernah tersimpan** sehingga kedua fitur mati total; (2) sandi reset admin **statis untuk semua member dan tercetak di bundle JS publik** — takeover akun tanpa login; (3) **Trial gratis bisa diklaim berulang tanpa batas** — paket berbayar tidak pernah wajib dibeli.
- Satu pola berulang di balik banyak temuan P1: **penegakan kebijakan tidak konsisten antar jalur** — `/api/v1/mutasi` via sesi melewati cek `disabled`/`must_change_password` yang ditegakkan di semua endpoint lain; gate kedaluwarsa ada di inquiry tapi tidak di dashboard/sync/admin; scope API key dibaca lalu dibuang.
- Pembayaran (Gobiz) saat ini **stub**: tidak ada QRIS nyata, order menumpuk `pending`, callback tidak atomik — wajib dibereskan sebelum GoBiz diaktifkan, dan sementara ini `gobiz_enabled=1` memberi kesan pembayaran aktif padahal mati.
- Yang **bersih dan terkonfirmasi**: isolasi peran (401), IDOR tertutup, masking nomor/email konsisten, API key hanya tampil sekali + hash di DB, kredensial DANA/BCA terenkripsi AES-256-GCM dan tidak bisa dibaca admin, settings tidak membocorkan secret, log server bersih dari PII/secret, webhook Connecta & Gobiz fail-closed, gate inquiry Trial OFF, limit BCA global ditegakkan.

## Urutan perbaikan yang disarankan

1. **P0-B** sandi reset statis + bocor di JS publik — sebelum reset berikutnya; ganti ke acak per-reset, hapus literal dari frontend, cabut sesi lama saat reset.
2. **P0-A** token verify/reset tidak tersimpan — hapus argumen berlebih, cek error INSERT, tambah test.
3. **P0-C** klaim ulang trial — tolak paket gratis bila member sudah pernah trial.
4. **P1-1** gate `/mutasi` via sesi — satukan ke satu helper dengan `authMember`.
5. **P1-2** revokasi sesi (logout/ganti sandi/reset).
6. **P1-4** callback Gobiz atomik + re-verifikasi — sebelum Gobiz live.
7. **P1-5** kejujuran jalur pembayaran (matikan atau pesan manual) — keputusan produk.
8. **P1-6** zona waktu — samakan di DSN/sesi MySQL.
9. **P1-3** Google lewati TOTP — sebelum Google OAuth diaktifkan.
10. P1 lainnya, lalu P2.

---

## P0 — Kritis

### P0-A — Token verifikasi email & reset password TIDAK PERNAH tersimpan: kedua fitur mati total
- **Flow:** Register → verify-email; Forgot-password → reset-password.
- **Bukti (terkonfirmasi live + diverifikasi koordinator dari kode):** `backend/internal/http/auth_handlers.go` — `INSERT INTO email_verification_tokens (id, member_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))` dipanggil dengan **4 argumen untuk 3 placeholder** (argumen waktu ke-4 berlebih); error dibuang via `_, _ =`. Pola identik di INSERT `password_reset_tokens` (INTERVAL 1 HOUR). `database/sql` menolak argumen berlebih → INSERT selalu gagal diam-diam. Live: setelah register + forgot-password, `SELECT COUNT(*) FROM email_verification_tokens` = **0**, `password_reset_tokens` = **0**.
- **Dampak:** Bukan sekadar "SMTP belum ada" — bahkan bila SMTP dikonfigurasi besok, kedua fitur tetap tidak jalan karena tidak ada token yang pernah tercipta. Member lupa sandi tidak bisa reset mandiri (hanya via admin); verifikasi email tidak mungkin dilakukan siapa pun.
- **Perbaikan:** Hapus argumen waktu berlebih (biarkan `DATE_ADD(NOW(), …)` yang menentukan `expires_at`) di kedua INSERT; cek error INSERT (jangan `_, _ =`); tambah test yang assert baris token tercipta setelah register/forgot.

### P0-B — Sandi reset admin statis untuk semua member DAN tercetak di bundle JS publik → takeover akun
- **Flow:** Admin reset kata sandi member → login member → ganti kata sandi.
- **Bukti (terkonfirmasi live + diverifikasi koordinator dari kode):**
  - `backend/internal/http/admin_handlers.go:531` — sandi reset adalah satu konstanta yang sama untuk setiap member yang direset (`:550` meng-hash nilai itu + `must_change_password=1`).
  - `frontend/app/member/change-password/page.tsx:43-45` — halaman membandingkan input dengan **nilai sandi reset secara literal**; chunk publik yang disajikan (`app/member/change-password/page-*.js`) mengandung nilai tersebut dan bisa dibaca **tanpa login** (grep hitung = 1).
  - `backend/internal/http/auth_handlers.go:474-514` — `handleChangePassword` hanya menerima `new_password`, tidak pernah memverifikasi sandi saat ini (mengirim `current_password` ditolak `400 invalid_json: unknown field`).
  - Live: login dengan sandi reset → `200, must_change_password:true`; ganti sandi hanya dengan `new_password` → `200`, flag `false`.
- **Dampak:** Siapa pun yang tahu email member dan bahwa admin baru saja meresetnya dapat login lalu mengganti sandi → takeover penuh. Gate `must_change_password` tidak menghentikan ini — penyerang justru diarahkan mengganti sandi. (Pengecualian: member dengan TOTP aktif masih terlindungi di langkah login.)
- **Perbaikan:** Sandi reset acak per member per reset (min 12 char, `crypto/rand`), tampil sekali saja ke admin, jangan pernah hardcode; hapus perbandingan nilai reset dari frontend (backend sudah menolak nilai itu); minta `current_password` untuk ganti sandi mandiri; cabut semua sesi lama saat reset.

### P0-C — Trial gratis bisa diklaim berulang tanpa batas (bypass paket berbayar)
- **Flow:** Langganan / masa berlaku paket.
- **Bukti (terkonfirmasi live + diverifikasi koordinator dari kode):** registrasi → Trial aktif 1 hari. Lalu `POST /api/v1/subscriptions {"plan_slug":"trial"}` → `201 {"status":"active","message":"paket gratis diaktifkan"}`, dan `GET /api/v1/subscriptions` menampilkan **dua** subscription Trial aktif sekaligus. Kode `backend/internal/http/member_handlers.go:610-630` — jalur `price_cents == 0` langsung INSERT active tanpa cek subscription aktif/trial yang sudah pernah dipakai. Jalur yang sama di `auth_handlers.go` (trial saat registrasi) juga tanpa guard.
- **Dampak:** Member bisa memperpanjang Trial 1 hari selamanya dengan satu klik — paket berbayar tidak pernah wajib dibeli. Kerugian pendapatan langsung.
- **Perbaikan:** Tolak `plan_slug` gratis bila member sudah pernah punya subscription trial (cek `subscriptions` apa pun statusnya, atau flag `trial_used` di members); idealnya hanya registrasi yang memberi trial, dan `POST /subscriptions` untuk paket harga 0 harus ditolak bila sudah ada subscription aktif.

---

## P1 — Perilaku salah / keamanan

### P1-1 — Sesi member yang dinonaktifkan / wajib ganti sandi masih bisa membaca `/api/v1/mutasi`
- **Flow:** `GET /api/v1/mutasi` via cookie sesi.
- **Bukti (terkonfirmasi live oleh 4 pekerja independen):** `middleware.go:105-187` `authenticateMutasi` — cabang sesi hanya memvalidasi JWT + role, tanpa cek `status`/`must_change_password`; `authMember` memeriksa keduanya. Live: akun dinonaktifkan admin → dashboard `403 account_disabled`, tetapi `GET /api/v1/mutasi` dengan sesi yang sama → `200` + data lengkap (total=8 pada akun uji berisi mutasi). Pola sama saat flag ganti sandi aktif. Jalur API key-nya benar (disabled → 401).
- **Dampak:** "Nonaktifkan menutup akses total" tidak benar untuk endpoint data utama; member nonaktif tetap bisa mengunduh riwayat mutasi sampai sesi 24 jam kedaluwarsa.
- **Perbaikan:** Terapkan cek `status` + `must_change_password` yang sama di cabang sesi `authenticateMutasi` (satukan ke satu helper agar tidak drift lagi).

### P1-2 — Logout tidak mencabut sesi; ganti sandi / reset admin juga tidak mencabut sesi lama
- **Flow:** Logout; change-password; admin reset-password.
- **Bukti (terkonfirmasi live):** Sesi JWT stateless HS256 TTL 24 jam, tanpa denylist/`jti`/versi sesi. Live: login → `/me` 200 → `POST /logout` 200 → `/me` dengan token lama yang sama **tetap 200**. Sesi lama (dibuat sebelum reset + ganti sandi) → `/me` tetap 200 setelah sandi diganti dan flag kembali `false`.
- **Dampak:** Token yang dicuri tetap berlaku penuh 24 jam walau korban sudah logout atau mengganti sandi; "logout" dan "ganti sandi setelah pembobolan" memberi rasa aman palsu.
- **Perbaikan:** Simpan sesi server-side (atau minimal denylist `jti` + kolom `session_version`/`password_changed_at` di members yang dicek `authMember`, dinaikkan saat ganti/reset sandi dan saat logout).

### P1-3 — Login Google melewati TOTP dan flag `must_change_password`
- **Flow:** Login Google → sesi member.
- **Bukti (hanya dari baca kode):** `handleGoogleCallback` (`auth_handlers.go` ~240-300) mencocokkan `google_sub` lalu email, cek `disabled`, lalu langsung `setSession` — tidak ada pengecekan `totp_enabled`/kode TOTP dan tidak ada pengecekan `must_change_password`. Sementara `handleLogin` mewajibkan TOTP bila `totp_enabled=1`.
- **Dampak:** Member ber-2FA tetap bisa dibobol lewat Google OAuth hanya dengan akses akun Google-nya. Akun ber-flag juga bisa login via Google (meski `authMember` kemudian memblokir endpoint non-exempt).
- **Status:** Laten — `GET /api/v1/auth/google` live `503 google_not_configured`, jadi saat ini tidak tereksploitasi; menjadi lubang penuh saat Google OAuth diaktifkan.
- **Perbaikan:** Di callback Google, bila `totp_enabled=1` jangan langsung `setSession` — arahkan ke verifikasi TOTP dulu; cek juga flag `must_change_password` dan sampaikan ke frontend seperti jalur login biasa.

### P1-4 — Callback Gobiz tidak atomik: order ditandai paid SEBELUM langganan aktif
- **Flow:** Callback Gobiz → aktivasi langganan.
- **Bukti (hanya dari baca kode; diverifikasi koordinator):** `member_handlers.go:748-755` — `UPDATE gobiz_orders SET status='paid'` lalu `UPDATE subscriptions SET status='active', …` sebagai dua statement terpisah tanpa transaksi. Bila statement kedua gagal → respons 500 `db_error`, padahal order sudah `paid`; replay callback kemudian masuk cabang `orderStatus == "paid"` dan langsung balas `already_paid` **tanpa pernah mengaktifkan subscription**. Tidak ada jalur rekonsiliasi/manual retry.
- **Dampak:** Saat Gobiz live, pelanggan yang sudah bayar bisa stuck "sudah bayar, langganan tidak aktif" dan tidak bisa diperbaiki lewat replay webhook.
- **Perbaikan:** Bungkus kedua UPDATE dalam satu transaksi DB; atau, pada cabang `already_paid`, verifikasi subscription-nya dan aktifkan bila masih pending (idempotent repair). Saat ini belum bisa diuji live karena `GOBIZ_WEBHOOK_SECRET` kosong (semua callback ditolak).

### P1-5 — Pembelian nyata mustahil: Gobiz stub, order menggantung pending selamanya + bisa dobel
- **Flow:** Pembayaran langganan (Gobiz QRIS).
- **Bukti (terkonfirmasi live):** `POST /subscriptions/{id}/pay-gobiz` pada subscription Starter pending → `201 {"status":"pending","message":"order Gobiz dibuat; QRIS akan tersedia setelah integrasi Gobiz diaktifkan penuh"}` — tanpa `qr_url`. Panggil 2x → **2 order pending berbeda** untuk subscription yang sama (tidak ada cek order pending yang sudah ada). DB: `gobiz_orders` = 4 baris, semua `pending` (2 Starter, 2 Trial Rp0), **0 punya `qr_url`, 0 punya `external_id`**. Env live: `GOBIZ_API_KEY` + `GOBIZ_WEBHOOK_SECRET` kosong, `gobiz_enabled=1`. Kode `member_handlers.go:671-685` — komentar eksplisit "real Gobiz QRIS charge call is pending". `handleCreateSubscription` juga tidak mengecek subscription pending/aktif yang sudah ada untuk member+plan yang sama (DB live: satu member punya 2 subscription Starter pending sekaligus).
- **Dampak:** Member yang mau bayar tidak pernah mendapat QRIS; order menumpuk pending tanpa kedaluwarsa/pembersihan; `gobiz_enabled=1` memberi kesan pembayaran aktif padahal mati; saat QRIS live, risiko bayar dobel.
- **Perbaikan:** Sampai QRIS nyata siap, matikan jalur ini secara jujur (`gobiz_enabled=0` + pesan "pembayaran manual, hubungi admin") atau tambahkan `expires_at` + job pembersih order pending; kembalikan order/subscription pending yang sudah ada (atau tolak 409 `already_pending`); tambahkan unique index untuk pending.

### P1-6 — Zona waktu: timestamp subscription 8 jam lebih maju; field `date` API berlabel UTC padahal docs janji WIB
- **Flow:** `starts_at`/`expires_at`, field `date` di `GET /api/v1/mutasi`.
- **Bukti (terkonfirmasi live + diverifikasi koordinator: tidak ada penanganan zona di kode):** server `date` = CST (+08:00), MySQL `@@system_time_zone=CST`, tidak ada `SET time_zone`/`loc=` di DSN maupun `Asia/Jakarta` di backend (grep: nol). Akun diregistrasi ~19:11 CST, API mengembalikan `"starts_at":"2026-11-07T19:11:18Z"` — wall-clock CST diberi label UTC. Frontend `formatDateWIB` memakai `timeZone:'Asia/Jakarta'` pada nilai yang sudah salah, sehingga tampil **9 Nov 02:11 WIB** padahal kedaluwarsa sebenarnya **8 Nov 18:11 WIB**. Terpisah: `member_handlers.go:415` `m.Date = d.Format(time.RFC3339)` + `parseTxDate` tanpa zona → semua `date` berbentuk `…Z`, sementara docs mencontohkan `"date": "2026-11-07T10:15:00+07:00"` dan menyebut "zona WIB".
- **Dampak:** Member melihat masa berlaku 8 jam lebih lambat; token reset (1 jam) / verifikasi (24 jam) bisa berlaku ~8 jam lebih lama dari niat (perbandingan di sisi Go memakai nilai yang sama-sama bergeser; gate MySQL `expires_at > NOW()` tidak terpengaruh karena NOW() dan kolom sama-sama CST). Konsumen API yang parse sebagai UTC lalu konversi ke WIB mendapat +7 jam (tanggal bisa geser hari).
- **Perbaikan:** Samakan zona di semua lapis — set `time_zone='+07:00'` di DSN/sesi MySQL; format `date` dengan zona `Asia/Jakarta` agar sesuai docs (atau ubah docs ke UTC — putuskan satu).

### P1-7 — Sinkronisasi tetap jalan untuk member kedaluwarsa; gate kedaluwarsa tidak konsisten antar endpoint
- **Flow:** Sinkronisasi mutasi / masa berlaku paket.
- **Bukti (baca kode + sebagian live):** `sync/sync.go:100-110` (`PollOnce`) — `LEFT JOIN subscriptions … AND sub.status='active' AND sub.expires_at > NOW()` tetapi tidak ada filter yang mensyaratkan subscription aktif ada; hasilnya hanya dipakai untuk `api_delay_minutes`/`callback_enabled`. Akun milik member kedaluwarsa tetap di-poll tiap menit. Tidak ada job yang mengubah status subscription menjadi `expired`. Yang meng-gate `expires_at > NOW()`: tambah rekening, inquiry, rate-limit Enterprise. Yang **tidak** meng-gate: dashboard (`handleDashboard` ambil paket `status='active'` tanpa cek expiry — live: dashboard Trial menampilkan `"plan":"Trial","plan_expires_at":"2026-11-08T19:11:22Z"`), `GET /api/v1/mutasi` via sesi (lihat P1-1).
- **Dampak:** Kuota Connecta terbuang untuk member yang sudah tidak bayar; member kedaluwarsa/dinonaktifkan tetap melihat paket aktif dan membaca riwayat mutasi.
- **Perbaikan:** Tambahkan `AND EXISTS (SELECT 1 FROM subscriptions … active AND expires_at > NOW())` di query `PollOnce`; samakan gate di `authMember` + jalur sesi `authenticateMutasi`; dashboard hanya tampilkan paket bila `expires_at > NOW()` (atau tampilkan "kedaluwarsa").

### P1-8 — Kunci dedup mutasi rapuh: bisa dobel dan bisa menghilangkan mutasi orang lain
- **Flow:** Sinkronisasi / webhook — dedup mutasi.
- **Bukti (baca kode; cek DB: 8 mutasi saat audit, tidak ada `dedup_hash` ganda):** `sync/sync.go:24-30` `MutationHash(phone|date|type|amount|description)` — **tidak** memuat member, akun, provider, atau sender; `mutations.dedup_hash` adalah `UNIQUE` global (`0001_init.sql`) dan insert memakai `INSERT IGNORE`. Konsekuensi: (a) dua member berbeda dengan transaksi yang sama persis → mutasi member kedua diam-diam dibuang; (b) tanggal yang sama dalam format berbeda menghasilkan hash berbeda → dobel; (c) `parseTxDate` gagal → `time.Now()` (`sync.go:315`) sehingga `tx_date` salah walau hash tetap.
- **Dampak:** Duplikasi atau kehilangan mutasi diam-diam tanpa error.
- **Perbaikan:** Masukkan `member_id` + `linked_account_id` + provider ke hash (atau unique key `(linked_account_id, dedup_hash)`); normalisasi tanggal ke satu format sebelum hashing; tolak/beri `tx_date` NULL-tercatat bila tanggal tidak bisa diparse, jangan `time.Now()`.

### P1-9 — Webhook Connecta: binding aktif tanpa cek status, cocok nomor hanya 4 digit pertama
- **Flow:** Webhook Connecta → aktivasi binding DANA.
- **Bukti (baca kode):** `webhooks.go:60-75` — cabang `binding` tidak pernah memeriksa `body.Status` (event gagal/dibatalkan pun mengaktifkan), dan UPDATE memakai `phone_masked LIKE CONCAT(LEFT(?,4),'%')` — hanya 4 digit awal nomor HP (semua nomor `0812…` cocok). Satu-satunya pembatas adalah `member_id = client_ref` dan secret webhook.
- **Dampak:** Dengan secret yang bocor/salah konfigurasi, binding bisa diaktifkan palsu; bahkan tanpa itu, payload dengan status gagal tetap mengaktifkan akun. Member dengan dua nomor DANA berawalan sama bisa teraktifkan keduanya sekaligus.
- **Perbaikan:** Hanya aktifkan bila `status` bernilai sukses yang dikenal (sesuaikan kontrak Connecta); cocokkan nomor lengkap (atau `client_ref` + `account_id` persis), bukan prefix 4 digit.

### P1-10 — Webhook transaksi bisa salah alamat akun; sync DANA hanya ambil 20 transaksi pertama
- **Flow:** Webhook + sinkronisasi mutasi.
- **Bukti (baca kode):** `webhooks.go:96-108` — akun dicari hanya dari `client_ref` (`LIMIT 1`, tanpa cocok nomor/akun), jadi member dengan >1 rekening DANA bisa mendapat mutasi di rekening yang salah; tidak ada validasi amount (0/negatif lolos) dan akun `pending` pun diterima. `sync.go:180` — `DanaTransactions(ctx, phone, 1, 20)`: hanya halaman 1, 20 baris; bila >20 transaksi baru masuk dalam satu interval, yang tertua tidak pernah muncul lagi di halaman 1 → hilang permanen.
- **Dampak:** Mutasi salah rekening / mutasi hilang diam-diam.
- **Perbaikan:** Cocokkan `phone`/`account_no` dari payload dengan `linked_accounts` member; validasi `amount != 0`; paginasi sync sampai tidak ada baris baru (atau pakai cursor/watermark tanggal terakhir).

### P1-11 — Nomor HP DANA & kredensial BCA tanpa validasi format
- **Flow:** `POST /api/v1/accounts` (DANA, BCA).
- **Bukti (terkonfirmasi live untuk DANA; BCA hanya dari baca kode karena slot penuh):** DANA: `{"provider":"DANA","phone":"abcdefghij"}` (10 huruf) → `201`, akun `pending`, `binding_url` OAuth dikembalikan dengan huruf itu di `seamlessData.mobileNumber`; `phone:"0000000000"` juga diterima. Akar: `member_handlers.go:168-172` hanya cek `len(phone)` 9–15, tanpa cek digit. BCA: cabang BCA hanya cek ketiga field tidak kosong — tanpa regex/panjang apa pun untuk `account_no`, `user_id`, `pin` (PIN KlikBCA semestinya 6 digit).
- **Dampak:** Akun/kredensial sampah terbentuk dan tersimpan terenkripsi, panggilan Connecta sia-sia, member tidak pernah diberitahu inputnya salah.
- **Perbaikan:** DANA `^[0-9]{9,15}$` (lebih ketat: awalan `08`/`628`); BCA `account_no ^[0-9]{5,20}$`, `user_id` alfanumerik 6–20, `pin ^[0-9]{6}$`; batasi juga `label` ≤255 — sebelum enkripsi/panggilan Connecta.

### P1-12 — Scope API key tidak pernah ditegakkan
- **Flow:** Buat API key → pakai `X-API-Key` di `GET /api/v1/mutasi`.
- **Bukti (terkonfirmasi live):** Key dibuat dengan scope fiktif/`webhook:receive` saja → `GET /api/v1/mutasi` = **`200`**. Akar: `middleware.go:152` `_ = scope` — scope dibaca dari DB lalu dibuang. UI member dan docs menjanjikan pembatasan scope ("Batasi dengan IP whitelist dan scope seminimal mungkin").
- **Dampak:** Janji least-privilege palsu — key bocor dengan scope minimal tetap membaca semua mutasi. Blast radius hari ini terbatas karena `/mutasi` satu-satunya endpoint berkunci.
- **Perbaikan:** Tegakkan di `authenticateMutasi` (tolak scope yang tidak mengandung `mutasi:read` untuk endpoint ini), atau hapus pilihan scope dari UI/docs sampai penegakannya ada.

### P1-13 — Filter `to` membuang satu hari penuh; nilai parameter tak valid diam-diam diabaikan
- **Flow:** `GET /api/v1/mutasi` — filter tanggal & angka.
- **Bukti (terkonfirmasi live dengan data uji):** `member_handlers.go:353-356` — `from`/`to` dilempar mentah ke `tx_date >= ?` / `tx_date <= ?`; `to=2026-11-07` sama dengan `<= 2026-11-07 00:00:00`, jadi seluruh mutasi tanggal itu setelah tengah malam terbuang (uji: `to=2026-11-07` → total=6, 2 baris 10:15 & 18:30 hilang). `min_amount=abc` → 200, filter diam-diam tidak jalan (total penuh); `from=2026-13-99` / `from=garbage` / `type=XX` → 200, total=0 tanpa error.
- **Dampak:** Member menyaring "sampai hari ini" kehilangan data hari itu; salah ketik terlihat seperti "tidak ada mutasi" — menyesatkan untuk rekonsiliasi.
- **Perbaikan:** Parse tanggal; `to` berupa tanggal saja → akhir hari (`tx_date < DATE_ADD(?, INTERVAL 1 DAY)`). Kembalikan `400 invalid_param` untuk nilai tak valid; validasi `type ∈ {CR,DB}` dan `provider` dikenal; `min_amount <= max_amount`.

### P1-14 — Export CSV hanya mengekspor halaman berjalan, bukan seluruh hasil filter
- **Flow:** Export CSV mutasi (dashboard + `GET /api/v1/mutasi?format=csv`).
- **Bukti (terkonfirmasi live):** `member_handlers.go:399-414` — cabang CSV memakai `LIMIT`/`OFFSET` yang sama dengan JSON; `exportCsv` di dashboard tidak menyetel `page_size`. Live: `format=csv&page_size=3` → 1 header + 3 baris padahal `total=8`; tidak ada `total`/nomor halaman di dalam file. Docs menyebut `format=csv` tanpa batas apa pun.
- **Dampak:** Rekonsiliasi member kehilangan baris ke-21+ tanpa peringatan.
- **Perbaikan:** CSV abaikan paginasi (dengan cap eksplisit + keterangan bila terpotong), atau set `page_size=100` di `exportCsv` dan beri tahu batasnya di UI/docs.

### P1-15 — Register langsung memberi sesi penuh + trial tanpa verifikasi email dan tanpa rate limit
- **Flow:** Register member.
- **Bukti (terkonfirmasi live):** `handleRegister` langsung `setSession` setelah INSERT — tidak ada gate `email_verified_at`; `handleLogin`/`authMember` juga tidak pernah memeriksa `email_verified`. Live: register → `201` + cookie sesi, `/me` langsung `{"email_verified":false,…}` dan dashboard dapat diakses. Rute `POST /api/v1/auth/register` tidak memakai limiter apa pun; `handleForgotPassword` juga tanpa rate limit. Dua register beruntun dari IP yang sama berhasil tanpa hambatan; tidak ada CAPTCHA.
- **Dampak:** Verifikasi email murni kosmetik (diperparah P0-A: tokennya bahkan tidak tersimpan). Siapa pun bisa mendaftar dengan email orang lain dan langsung memakai trial; pembuatan akun massal untuk menguras trial (diperparah P0-C).
- **Perbaikan:** Setelah P0-A diperbaiki + SMTP ada: tahan pemberian trial/akses fitur sampai email terverifikasi (atau batasi tanpa trial sampai verifikasi); rate limit per IP pada register & forgot-password (mis. 5/jam/IP) + CAPTCHA bila memungkinkan.

### P1-16 — Inquiry: error gangguan provider dipetakan jadi pesan yang menyesatkan
- **Flow:** Inquiry rekening (member + admin playground).
- **Bukti (terkonfirmasi live):** Member: `inquiry_handlers.go:74-83` — semua error berisi `HTTP 400` → `400 invalid_request` / "permintaan inquiry ditolak bank/provider"; live 7 Nov ~19:12 WIB BRI 002 dan BCA 014 → `400 invalid_request`, padahal provider membalas `SERVICE_TEMPORARILY_UNAVAILABLE` / `BANK_SERVICE_UNAVAILABLE`. Admin: `handleAdminDanaInquiry` memetakan **semua** error Connecta ke `502 connecta_error`; live via origin: `502 {"error":"connecta_error","message":"connecta: POST /b2b/dana/account-inquiry returned HTTP 400: {\"error\":\"LIMIT_EXCEEDED\",\"message\":\"Batas limit transaksi penerima telah tercapai\"}"}`; live via `https://mutasi.rajacek.com` (3×): `502 text/plain` body `error code: 502` — Cloudflare mengganti body origin sehingga detail hilang total.
- **Dampak:** Member mengira inputnya salah dan mengulang sia-sia; admin tidak bisa melihat penyebab gagal dari playground (`LIMIT_EXCEEDED` hilang, terlihat seperti gateway down).
- **Perbaikan:** Kenali pesan gangguan sementara dari Connecta → `502/503 provider_unavailable` ("layanan bank sedang gangguan, coba lagi nanti"); petakan error upstream 4xx ke status 4xx sendiri (mis. `400`/`422` dengan pesan provider yang sudah disanitasi); `502` hanya untuk 5xx/timeout agar body lolos Cloudflare.

### P1-17 — Rate limit login tidak terpicu bagi klien yang IP-nya berotasi (key IP+email)
- **Flow:** Login admin & member (gagal beruntun).
- **Bukti (terkonfirmasi live):** 6× login admin PIN salah berturut-turut → semua `401 invalid_credentials`, tidak ada satu pun `429`. `audit_logs` menunjukkan setiap request tercatat dengan **IP IPv6 berbeda** (egress merotasi IP sumber tiap request), sehingga bucket per-IP tidak pernah penuh; tidak ada satu pun baris `login_blocked`. Uji member: 6 login gagal beruntun semua `401`, login benar langsung `200` — 429 tidak pernah muncul (kemungkinan penyebab sama).
- **Dampak:** Proteksi 5-gagal/15-menit tidak berfungsi bagi klien ber-IP-rotasi (egress proxy, CGNAT, IPv6 privacy). PIN admin 8 digit numerik; yang membatasi saat ini praktis hanya biaya bcrypt per percobaan.
- **Perbaikan:** Kunci limiter per-email (bukan IP+email), atau gabung email + prefix /64 IPv6; audit percobaan login gagal (saat ini gagal login tidak meninggalkan jejak apa pun).

---

## P2 — Polish / inkonsistensi / drift docs

### P2-1 — Validasi register lemah: nama kosong lolos, nama 1000 karakter → 500 `db_error`, validasi email minimal
- **Flow:** Register member.
- **Bukti (terkonfirmasi live):** Nama `""` → `201` dan akun tercipta; nama 1000 karakter → `500 {"error":"db_error","message":"gagal membuat akun"}` (kolom `name VARCHAR(255)`); `validEmail` hanya memeriksa ada `@` dan `.` setelahnya. Pola sama (baca kode) pada `label` rekening — tanpa batas panjang.
- **Dampak:** Data member kotor; error 500 menyesatkan untuk input yang seharusnya ditolak 400 dengan pesan jelas.
- **Perbaikan:** Validasi nama 1–255 karakter dan label ≤255 di handler, sebelum INSERT; perketat validasi email. (Satu pekerja menilai aspek 500 ini P1; dikonsolidasi ke P2 karena tidak ada dampak data/uang.)

### P2-2 — Materi vendor / body mentah diteruskan ke member
- **Flow:** Respons member (akun, inquiry, daftar bank).
- **Bukti (baca kode; sebagian live):** `connecta/client.go:96` merangkai error `connecta: <METHOD> <path> returned HTTP <n>: <300 char pertama body upstream>`; handler meneruskannya verbatim (`member_handlers.go:184,210,324`). Kode error `connecta_error`/`connecta_unavailable`, `gobiz_disabled`, pesan "Connecta belum dikonfigurasi", dan string UI ("Connecta tidak mengembalikan link otorisasi", "Pembayaran Gobiz sedang nonaktif", "QRIS Gobiz") mengekspos nama vendor — bertentangan dengan komentar `server.go` ("Member-facing JSON never contains the upstream provider's real name"). `inquiry_handlers.go:141-158` — bila `normalizeBankCodes` gagal, raw Connecta ditulis verbatim ke member (live bentuknya ternormalisasi bersih, jadi hanya dari baca kode).
- **Dampak:** Nama vendor + path internal + kemungkinan gema input sampai ke member; melanggar aturan kerahasiaan struktural (tingkat rendah; bukan URL/kunci/data sensitif).
- **Perbaikan:** Log body upstream di server saja; ke member kembalikan pesan generik; ganti kode/pesan menjadi generik (`provider_error`, "provider pembayaran", "QRIS"); bila normalisasi daftar bank gagal → `502` generik, jangan passthrough.

### P2-3 — `readJSON` tidak memverifikasi EOF: JSON ganda/trailing garbage diterima
- **Flow:** Semua endpoint `readJSON`.
- **Bukti (terkonfirmasi live):** Body `'{"scope":"all"} {"scope":"all"}'` → **`201` API key dibuat**. Akar: `server.go:156-165` — satu `Decode`, tanpa decode kedua untuk memastikan `io.EOF`.
- **Dampak:** Input malformed lolos; inkonsisten dengan `DisallowUnknownFields` yang ketat.
- **Perbaikan:** Setelah `Decode` pertama, `Decode` lagi dan pastikan `io.EOF`.

### P2-4 — Pesan error membocorkan detail internal + menyesatkan
- **Flow:** Register / login / validasi JSON.
- **Bukti (terkonfirmasi live):** Password 100 karakter → `400 {"error":"weak_password","message":"auth: hash password: bcrypt: password length exceeds 72 bytes"}` — membocorkan nama library + batas internal, dan menyesatkan (dibilang "lemah" padahal terlalu panjang). Field tak dikenal → `"body JSON tidak valid: json: unknown field \"bogus_field\""` (detail implementasi Go). Akar: `server.go:161` dan `auth_handlers.go:50,386,509` menyertakan `err.Error()` mentah; `friendlyError` frontend meneruskan pesan backend verbatim ke UI.
- **Perbaikan:** Pesan generik berbahasa Indonesia ("kata sandi maksimal 72 karakter", "field tidak dikenal: <nama>") tanpa `err.Error()` library; log detail di server.

### P2-5 — Filter `sender` LIKE tanpa escape wildcard
- **Flow:** `GET /api/v1/mutasi?sender=...`.
- **Bukti (baca kode):** `member_handlers.go:370` `sender LIKE "%"+v+"%"` tanpa escape `%`/`_`/`\`. Uji live `sender=%` mengembalikan `200` kosong (akun tes 0 mutasi, tak bisa membedakan).
- **Dampak:** `sender=%` melebar ke semua baris.
- **Perbaikan:** Escape LIKE (`\%`, `\_`, `\\` + `ESCAPE`).

### P2-6 — Email mentah tersimpan sebagai `actor_id` di `audit_logs`
- **Flow:** Audit login gagal.
- **Bukti (terkonfirmasi live via cek DB read-only):** `auth_handlers.go:101,604` — `s.audit(r, "member"/"admin", email, "login_blocked", ...)` memakai email sebagai `actor_id`. Dari 78 baris `audit_logs`, **2** berisi `@`.
- **Dampak:** PII di tabel audit (tidak terekspos di respons API).
- **Perbaikan:** Pakai ID member/admin atau hash email sebagai `actor_id`.

### P2-7 — Ganti kata sandi tanpa `current_password` (residual dari P0-B)
- **Flow:** `POST /api/v1/auth/change-password`.
- **Bukti (terkonfirmasi live; keputusan desain tercatat di kode):** Komentar di `auth_handlers.go:464-473` menyatakan "sesi yang masih berlaku sudah membuktikan identitas"; live: ganti sandi berhasil hanya dengan sesi. Dikombinasikan dengan P1-2 (sesi lama tidak dicabut), sesi yang dibajak dapat mengganti sandi dan mengunci pemilik asli.
- **Perbaikan:** Minta `current_password` untuk ganti sandi mandiri (tetap tanpa itu untuk alur paksa pasca-reset); cabut semua sesi lain setelah ganti sandi.

### P2-8 — Callback member (Enterprise) tanpa signature, tanpa retry, respons sukses dibuang
- **Flow:** Callback `mutation.new` ke member.
- **Bukti (baca kode):** `sync/sync.go:290-310` `fireCallback` — POST tanpa header signature apa pun, tanpa retry, `response_body` hanya diisi saat error (saat sukses `body=""`), dan hanya dipicu bila `newCount > 0` + `callback_enabled` paket. Positif: payload minimal — tidak membocorkan isi mutasi.
- **Dampak:** Member tidak bisa memverifikasi keaslian callback; kegagalan pengiriman hilang tanpa jejak respons.
- **Perbaikan:** Tambahkan HMAC signature + `X-MutasiHub-Event`; simpan response body/status selalu; retry terbatas (mis. 3x backoff) atau antrean callback.

### P2-9 — Sinkronisasi BCA memakai feed global tanpa filter per rekening
- **Flow:** Sinkronisasi BCA.
- **Bukti (baca kode):** `sync.go:216-237` — `BCAMutations(ctx, 25, "")` tanpa `account_no`; semua mutasi BCA yang dikembalikan Connecta ditulis ke akun BCA lokal. Saat ini aman secara praktis karena `handleCreateAccount` membatasi **1 akun BCA di seluruh platform**, tetapi bila limit itu dilonggarkan, mutasi akan tercampur antar-member.
- **Perbaikan:** Filter mutasi BCA per `account_no`; tambahkan guard di sync yang menolak bila ada >1 akun BCA.

### P2-10 — CRUD paket: paket yang pernah di-assign tidak bisa dihapus; paket nonaktif masih bisa di-assign; slug/batas atas tanpa validasi
- **Flow:** CRUD paket (admin).
- **Bukti (terkonfirmasi live):** `handleAdminDeletePlan`: `SELECT COUNT(*) FROM subscriptions WHERE plan_id=?` tanpa filter status — paket tes di-assign lalu dikembalikan ke Trial (subscription jadi `cancelled`) → hapus **tetap `409 plan_in_use`**; baru berhasil setelah member tes dihapus total. `handleAdminUpdateMember` hanya cek paket ada + `duration_days`, tanpa cek `is_active` — paket tes `is_active:false` tetap bisa di-assign (`200`, subscription aktif). `ValidatePlan` (`domain.go:27-53`): hanya cek kosong/negatif/minimum; slug boleh berisi spasi/karakter aneh, `price_cents`/`duration_days`/`max_accounts` tanpa batas atas (penolakan harga negatif/durasi 0/slug kosong/duplikat sudah benar).
- **Perbaikan:** Hitung hanya `status='active'` saat hapus; tolak `plan_id` dengan `is_active=0`; regex slug `^[a-z0-9-]+$` + batas atas wajar (mis. durasi maks 3650 hari).

### P2-11 — Daftar & detail member menampilkan langganan "active" yang sudah kedaluwarsa
- **Flow:** Daftar member, detail member (admin).
- **Bukti (hanya dari baca kode):** `admin_handlers.go:224` (list) dan `:458-460` (detail): `WHERE sub.status='active'` tanpa `expires_at > NOW()`. Tidak ada job yang mengubah status jadi expired.
- **Dampak:** Admin melihat paket "aktif" untuk member yang masa berlakunya sudah lewat — keputusan penagihan/perpanjangan bisa salah.
- **Perbaikan:** Tambah `AND sub.expires_at > NOW()` di kedua query admin, atau job periodik yang menandai expired.

### P2-12 — Audit log: tanpa nilai lama→baru, aksi penting tidak diaudit, tidak ada UI/endpoint audit
- **Flow:** Audit log (admin).
- **Bukti (terkonfirmasi live + baca kode):** `audit_logs` untuk aksi admin: `member_update "member … diubah (nama)"` — hanya nama field, tanpa nilai lama/baru (paket lama→baru, email lama→baru tidak terlacak). Yang **tidak** diaudit: percobaan login gagal (hanya `login_blocked` bila limiter terpicu — yang tidak pernah terpicu, lihat P1-17), inquiry gagal (`dana_inquiry` hanya di jalur sukses), logout admin. Tidak ada `GET /api/v1/admin/audit-logs` maupun halaman audit di panel.
- **Dampak:** Forensik terbatas; brute force tidak meninggalkan jejak; admin tidak bisa memantau aktivitas admin lain dari panel.
- **Perbaikan:** Sertakan old→new di detail `member_update`/`plan_update` (mask email/nomor); audit login gagal dan inquiry gagal; tambah endpoint list audit + halaman panel.

### P2-13 — Daftar member: API dukung pagination, frontend tidak memakainya; tanpa total/filter
- **Flow:** Daftar member (admin).
- **Bukti (terkonfirmasi live + baca kode):** `handleAdminListMembers` dukung `?page=` (size 20), respons `{members, page}` tanpa `total_count`/`has_more`. Live: `page=2` → `[]`, `page=0`/`page=abc` → halaman 1. Frontend memanggil tanpa parameter dan tanpa UI halaman/filter.
- **Dampak:** Di atas 20 member, member lama tidak terlihat di panel; tidak bisa cari/filter member.
- **Perbaikan:** Tambah `total_count` di respons + UI pagination/filter (email/nama/paket/status).

### P2-14 — Drift docs & paginasi: `page_size` clamp diam-diam, `format` tak dikenal diabaikan, rate limit hanya API key, tabel error docs tidak lengkap
- **Flow:** `GET /api/v1/mutasi`, halaman `/docs`.
- **Bukti (terkonfirmasi live):** `page_size=999` → respons `page_size=20` (kode: `size<1 atau >100 → 20`); docs hanya bilang "maks 100 (default 20)". `format=xml` → 200 JSON (hanya `== "csv"` yang istimewa). Rate limit hanya di cabang API key (`middleware.go:137-146`); cabang sesi tanpa limiter — live key Trial burst 65 → 64×200 + 1×429; docs hero "Rate Limit 60/menit" tanpa kualifikasi. Tabel error docs tidak memuat 503 `db_unavailable` (kode `server.go` `requireDB`). Klaim rate limit Enterprise: akurat vs kode (`api_delay_minutes=0` → 300/mnt), tapi kondisi sebenarnya adalah "paket aktif dengan `api_delay_minutes=0`", bukan label paket.
- **Perbaikan:** Dokumentasikan perilaku clamp; `format` selain `csv`/kosong → 400; sebutkan di docs bahwa limit berlaku untuk API key (pertimbangkan limiter ringan untuk sesi); tambah baris 503 ke tabel error; sebutkan syarat delay di klaim Enterprise.

### P2-15 — Dashboard "Terakhir Disinkronkan" menampilkan waktu buka halaman, bukan waktu sinkronisasi
- **Flow:** Dashboard member.
- **Bukti (hanya dari baca kode):** `frontend/app/member/dashboard/page.tsx:120` — `setLastSync(new Date().toISOString())` saat load; `last_synced_at` per akun tersedia di API tapi tidak dipakai di kartu ini.
- **Perbaikan:** Pakai `max(last_synced_at)` akun, atau ubah label menjadi "Terakhir dimuat".

### P2-16 — Limit BCA: cek limit sebelum validasi input; dihitung dari semua baris tanpa filter status, tanpa perlindungan race
- **Flow:** Hubungkan BCA.
- **Bukti (terkonfirmasi live untuk precedence; race hanya dari baca kode):** `member_handlers.go:139-150` (cek limit) berjalan sebelum `:207-210` (validasi field) — live: `POST BCA` dengan semua field kosong → `409 bca_limit`, bukan `400`. `COUNT(*) WHERE provider='BCA'` tanpa filter status; tidak ada unique constraint — dua create bersamaan bisa sama-sama lolos (TOCTOU). Dampak live: satu baris BCA `pending` milik pekerja lain memblokir BCA untuk semua member.
- **Perbaikan:** Validasi input dulu, baru cek limit; hitung hanya baris yang relevan (atau sediakan jalan admin membebaskan slot); tambah unique partial index dan tangkap race saat INSERT.

### P2-17 — 2FA: tidak ada endpoint disable, tidak ada recovery code; enable bisa dipanggil berulang menimpa secret
- **Flow:** 2FA TOTP.
- **Bukti (terkonfirmasi live untuk tidak adanya endpoint; menimpa secret hanya dari baca kode):** `POST /api/v1/auth/2fa/disable` → `404`. Rute yang ada hanya `2fa/enable` + `2fa/verify`. `handle2FAEnable` mengembalikan secret TOTP di JSON dan pemanggilan ulang menimpa secret lama tanpa verifikasi tambahan.
- **Dampak:** Member yang kehilangan authenticator terkunci dari akunnya (login TOTP wajib, tanpa jalan keluar mandiri) — harus minta admin mengutak-atik DB.
- **Perbaikan:** Tambah endpoint disable (wajib kode TOTP saat ini) + recovery codes sekali pakai saat enable; minta sandi saat ini sebelum menimpa secret yang sudah aktif.

### P2-18 — Cookie sesi `Domain=.rajacek.com` + TTL 24 jam tanpa refresh; inkonsistensi fallback JWT secret
- **Flow:** Sesi (cookie `mh_session`).
- **Bukti (sebagian live, sebagian baca kode):** `server.go:setSession` — `HttpOnly: true, Secure: true, SameSite: Lax, Domain: .rajacek.com`, `MaxAge: 24*3600`. Jar cookie live mengonfirmasi `HttpOnly`, `Secure`, domain, dan `exp-iat = 86400`. Domain `.rajacek.com` berarti cookie dikirim ke semua subdomain rajacek.com, bukan hanya MutasiHub. `newSessionToken` memakai secret acak per proses bila `JWT_SECRET` kosong, sementara `ValidateJWT` memakai `cfg.JWTSecret` mentah — bila secret kosong, sesi dibuat tapi tidak pernah bisa divalidasi.
- **Perbaikan:** Pertimbangkan domain host-only bila tidak butuh lintas subdomain; tambah refresh/sliding; samakan fallback secret di kedua sisi atau gagal start bila `JWT_SECRET` kosong di produksi.

### P2-19 — `mh_oauth_role` (cookie klien) menentukan peran Google callback; admin Google auto-provisioning
- **Flow:** Google OAuth callback (peran admin).
- **Bukti (hanya dari baca kode):** `handleGoogleCallback` membaca cookie `mh_oauth_role` yang dikontrol klien untuk memilih jalur admin; jalur admin lalu memeriksa allowlist `IsAdminGoogleEmail` dan membuat baris `admin_users` bila belum ada. Allowlist-lah yang mencegah eskalasi, bukan cookie-nya.
- **Dampak:** Rendah saat ini (allowlist + Google belum dikonfigurasi live) — tapi peran sebaiknya tidak diambil dari cookie klien.
- **Perbaikan:** Ikat peran ke `state` (HMAC) atau simpan di server; dokumentasikan bahwa allowlist email adalah satu-satunya gerbang admin.

### P2-20 — Urutan cek di login: akun disabled harus lolos TOTP dulu sebelum mendapat 403
- **Flow:** Login email+password (akun disabled + TOTP aktif).
- **Bukti (kode; sebagian live):** `handleLogin` memeriksa sandi → TOTP → baru `status=="disabled"`. Login akun disabled dengan TOTP valid → `403 account_disabled` (terkonfirmasi); varian sandi salah pada akun disabled tidak diuji.
- **Dampak:** Kecil — UX membingungkan + kebocoran kecil; percobaan sandi salah pada akun disabled menghabiskan budget rate-limit.
- **Perbaikan:** Pindahkan cek `disabled` segera setelah member ditemukan (sebelum cek sandi/TOTP), dengan tetap mengembalikan 401 generik untuk email tak dikenal agar tidak ada enumerasi.

### P2-21 — Pesan forgot-password menyesatkan: "tautan reset sudah dikirim" padahal tidak ada yang dikirim
- **Flow:** Forgot-password.
- **Bukti (terkonfirmasi live):** `POST /api/v1/auth/forgot-password` untuk email terdaftar maupun tidak terdaftar sama-sama `200 {"message":"jika email terdaftar, tautan reset sudah dikirim"}` — anti-enumerasi-nya benar, tapi isinya salah: tidak ada SMTP dan (P0-A) tokennya bahkan tidak tersimpan.
- **Perbaikan:** Setelah P0-A + SMTP diperbaiki pesannya menjadi benar; sementara ini ubah pesan menjadi netral yang tidak mengklaim pengiriman.

### P2-22 — Tidak ada batas jumlah API key per member dan tanpa kedaluwarsa
- **Flow:** API key.
- **Bukti (hanya dari baca kode):** `handleCreateAPIKey` — tanpa limit jumlah maupun expiry; hanya `key_prefix` + hash yang disimpan (itu sudah benar).
- **Perbaikan:** Batasi mis. 5 key aktif per member + dukung tanggal kedaluwarsa opsional.

### P2-23 — Webhook Connecta: secret mentah tanpa HMAC/timestamp; body rusak → 401 menyesatkan
- **Flow:** Webhook Connecta.
- **Bukti (terkonfirmasi live):** `POST /webhooks/connecta` tanpa secret → `401 {"error":"invalid_signature"}`; header secret salah → `401`; body bukan-JSON → juga `401 invalid_signature` (bukan 400) karena `json.Unmarshal` gagalnya diabaikan (`webhooks.go:38-39`) dan cek secret jalan duluan. Secret diterima lewat header `X-Webhook-Secret` **atau field JSON body `secret`** — bukan HMAC atas body, tanpa timestamp/nonce → payload valid bisa di-replay (dampak replay terbatas: binding idempotent, transaksi ter-dedup `INSERT IGNORE`). Positif: secret **sudah ter-set** live dan raw body sengaja tidak disimpan ke audit.
- **Catatan koordinator:** pendaftaran webhook di provider **terverifikasi** (`GET /b2b/webhook` live → URL webhook terdaftar, HTTP 200) — dugaan awal "belum terbukti terdaftar" tidak berlaku lagi. Yang tersisa: tidak ada kode yang mendaftarkan/memeriksa pendaftaran itu dan tidak ada visibilitas statusnya di panel admin.
- **Perbaikan:** Terima HMAC-SHA256 atas raw body + timestamp (bila Connecta mendukung); bila tidak, minimal kembalikan 400 `invalid_json` saat body gagal diparse sebelum cek secret; tambah endpoint admin read-only untuk status pendaftaran webhook.

### P2-24 — Callback Gobiz: status `paid` dari klaim webhook saja + komparasi secret `==`
- **Flow:** `POST /api/v1/gobiz/callback`.
- **Bukti (hanya dari baca kode):** `member_handlers.go:688-760` — status `paid` dari body langsung mengaktifkan langganan tanpa re-verifikasi ke provider; komparasi secret memakai `==` bukan `hmac.Equal`.
- **Dampak:** Bila secret bocor/lemah, klaim palsu bisa mengaktifkan langganan. Risiko live saat ini nihil: secret webhook Gobiz masih NULL sehingga callback fail-closed (`webhook_not_configured`, 401).
- **Perbaikan:** Re-verifikasi status order ke Gobiz sebelum aktivasi; pakai `hmac.Equal`.

---

## Flow yang bersih (terkonfirmasi live)

- **Isolasi peran:** cookie member → endpoint admin `401`; cookie admin → endpoint member `401`; tanpa sesi → `401`.
- **IDOR tertutup:** member B hapus/rebind rekening & API key milik A → `404 not_found`; `GET /accounts` dan `GET /mutasi` B hanya menampilkan milik B.
- **Masking konsisten:** `GET /accounts` hanya `phone_masked`/`account_masked`; admin list/detail memakai `crypto.MaskEmail`; satu-satunya rekening produksi (DANA `pending`) ter-mask.
- **API key hanya tampil sekali:** plaintext hanya di respons create; list hanya `key_prefix`; DB menyimpan `key_hash` + prefix.
- **Kredensial terenkripsi per member:** `linked_accounts.credential_ciphertext` AES-256-GCM; tidak ada handler admin yang me-`SELECT` kolom itu; admin hanya melihat status + mask.
- **Settings bersih:** `GET /api/v1/settings` tanpa auth hanya 5 key brand; `GET /api/v1/admin/settings` tanpa API key/secret.
- **Log server bersih:** `/var/log/mutasi-hub/api.log` (1638 baris): 0 kecocokan pola PII/token/secret; log sync hanya memakai nilai ter-mask.
- **Webhook Connecta & Gobiz fail-closed:** tanpa secret / secret salah → `401`; tidak ada mutasi/aktivasi dari callback palsu; webhook terdaftar di provider (terverifikasi koordinator).
- **Gate inquiry Trial OFF:** akun Trial → `403 inquiry_disabled`; bypass admin playground by-design.
- **Limit BCA global ditegakkan:** tambah BCA saat slot terisi → `409 bca_limit`.
- **Login benar/salah, cookie sesi, TOTP lokal, akun disabled (login + `/me`), flag `must_change_password` (login, `/me`, dashboard, ganti sandi):** semua berperilaku benar kecuali celah `/mutasi` (P1-1) dan revokasi sesi (P1-2).
- **Anti-enumerasi forgot-password:** email ada/tidak ada → respons 200 identik. **Hashing benar:** sandi bcrypt, token disimpan SHA-256.
- **DANA binding URL terbentuk:** `POST /accounts` → `201` + `binding_url` (host `m.dana.id`), status `pending`; rebind mengembalikan URL baru; limit paket Starter (maks 2 rekening) → `403 account_limit`.
- **API key (auth, IP whitelist, rate limit):** tanpa key → 401; key salah → 401; whitelist salah → 403 `ip_not_allowed`; burst 65–80 → 429 setelah ~60 hit; `last_used_at` ter-update; revoke → key mati 401.
- **`/api/v1/mutasi` (filter valid, respons, CSV):** semua filter bekerja saat nilai valid; bentuk respons sesuai docs; CSV header persis docs + escaping benar (koma dikutip, quote digandakan); contoh kode docs (cURL/JS/PHP) bisa jalan.
- **Admin (login, list/detail member, edit nama/paket, nonaktifkan, reset sandi, ubah email, CRUD paket, settings GET, playground baca):** semua berperilaku benar kecuali temuan P1-17, P2-10 s.d. P2-13.
- **Tidak ada crash pada payload rusak:** webhook Connecta / callback Gobiz body bukan-JSON dijawab 401/400 JSON tanpa crash (healthz tetap 200).
- **Disburse tidak ada:** tidak ada endpoint/member/admin untuk disburse/transfer; tidak ada jalur yang bisa dipanggil tidak sengaja.

## Belum terverifikasi (bukan lolos, bukan gagal)

1. **Seluruh alur Google OAuth** — `GET /api/v1/auth/google` live `503 google_not_configured` (login by `google_sub` lalu email, redirect `not_registered`, bypass TOTP P1-3, flag via Google, peran admin via cookie P2-19).
2. **Happy path inquiry** (nama pemilik kembali) — provider Connecta gangguan saat audit: `SERVICE_TEMPORARILY_UNAVAILABLE` / `BANK_SERVICE_UNAVAILABLE` / `LIMIT_EXCEEDED` (bukan bug MutasiHub, kecuali pemetaan pesannya P1-16).
3. **Binding DANA end-to-end** (klik OAuth nyata) — sengaja tidak diselesaikan.
4. **BCA end-to-end** — slot BCA platform sedang dipegang akun pekerja audit lain saat audit; validasi PIN hanya dari baca kode.
5. **Sinkronisasi DANA/BCA nyata** — belum ada akun terhubung aktif yang menarik mutasi; interval per-paket hanya dari baca kode; format tanggal provider yang sebenarnya belum terlihat (menentukan apakah risiko P1-8 benar-benar terpicu).
6. **Perilaku member saat paket kedaluwarsa secara live** — tidak bisa dipercepat tanpa mengubah data; hanya dari baca kode (P1-7).
7. **Idempotensi webhook Connecta dengan secret benar** — butuh secret valid; dari kode `INSERT IGNORE` + unique hash seharusnya dedup (dengan catatan P1-8).
8. **Callback Gobiz `paid` end-to-end** — mustahil saat ini: secret kosong + tidak ada QRIS nyata (P1-4, P1-5).
9. **Rate limit 300/mnt Enterprise; 500 `db_error`; 503 `db_unavailable`** — butuh paket Enterprise / DB mati; hanya dari baca kode.
10. **Kedaluarsa sesi 24 jam; SMTP / pengiriman email apa pun; callback member Enterprise nyata; perilaku `google_sub` saat ubah email dari kondisi non-NULL** — belum diuji.
11. **Rate limit login 429 secara konklusif dari IP stabil** — uji live tidak memicu 429 karena IP egress berotasi (P1-17).
12. **Filter tanggal/paginasi/CSV dengan data mutasi nyata dalam jumlah besar** — akun tes bermutasi sedikit/kosong; sebagian perilaku hanya dari baca kode.
13. **Redirect visual halaman change-password & playground di browser** — hanya dari kode + API (pekerja tanpa browser).
