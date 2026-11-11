# FLOW.md — MutasiHub

Peta alur proyek MutasiHub: cek mutasi DANA & BCA realtime untuk bisnis online
(top-up, deposit, rekonsiliasi pembayaran otomatis) via Connecta B2B Partner API.
Dokumen ini ditulis dari kode yang sebenarnya (`backend/`, `frontend/`,
`backend/migrations/0001–0017`) dan laporan audit yang ada — bukan dari ingatan.
Terakhir diperbarui: 11 November 2026 (versi live v40b).

> Aturan dokumen ini: tidak ada nilai kredensial/secret/key/token/password
> di sini — hanya NAMA variabel dan placeholder bila perlu.

---

## 1. Ringkasan

- **Produk:** MutasiHub — member menghubungkan rekening DANA / BCA miliknya
  sendiri, lalu platform menarik mutasi secara berkala dan menampilkannya di
  dashboard, mengirim callback (Enterprise), serta menyediakan API
  (`GET /api/v1/mutasi`) dan Inquiry Rekening (cek nama pemilik rekening bank).
- **Domain:** `https://mutasi.rajacek.com`
- **VPS:** 43.157.205.163 (Ubuntu, user `ubuntu`, akses key-only via wrapper
  `~/workspace/tools/vps157-ssh.sh`)
  - Backend Go: `127.0.0.1:8093`, systemd `mutasi-hub-api`,
    WorkingDir `/opt/mutasi-hub/backend`, env `/etc/mutasi-hub/mutasi.env` (600)
  - Frontend Next.js: `127.0.0.1:13001`, systemd `mutasi-hub-web`
  - MySQL 8.0.46, database `mutasi_hub`, akses `sudo -n mysql` / helper
    `/usr/local/bin/mutasi-db.sh`
  - nginx (api/webhook/healthz → 8093, `/` → 13001) + Let's Encrypt
    s/d 2027-02-04
  - Log: `/var/log/mutasi-hub/api.log`, `/var/log/mutasi-hub/web.log`
  - **Jam VPS = CST (UTC+8), 1 jam lebih cepat dari WIB.**
- **JANGAN disentuh di VPS .163:** port 8092 marketplace + 5433 Postgres,
  stack lama (nginx site rajacek.com, MySQL lain, Redis :6379, app :8080).
- **Provider:** Connecta B2B Partner API, base URL
  `https://connecta-crm.digitcodestudio.com/api/v1`, auth header `X-API-KEY`.
  Kuota partner akun **demo** (`is_demo=true`), ACTIVE, kedaluwarsa
  2026-12-07 10:10 WIB, maks **5 akun DANA** dan **1 akun BCA** (limit partner,
  bukan per member). Respons kuota mentah terbungkus
  `{"data": {...}, "success": true}`.
- **OVO ditunda** — tidak ada di Postman collection maupun di kode.
- **Disburse TIDAK dibangun** (sengaja): endpoint `transfer-to-balance` tidak
  ada di client Connecta maupun route member. Platform read-only untuk member.

---

## 2. Diagram arsitektur

```
                          Internet (Cloudflare)
                                   |
            +----------------------+----------------------+
            |                                             |
   Member (browser)                              Admin (browser)
   /login /member/*                              /admin-login /admin/*
            |                                             |
            +----------+                                  |
                       v                                  |
              Next.js 14 App Router                 (panel admin:
              127.0.0.1:13001                        template .app-shell)
              frontend/                                     |
                       |  fetch /api/v1/* (same-origin)     |
                       v                                  |
              Go 1.27 (stdlib net/http, tanpa framework)    |
              127.0.0.1:8093  <----------------------------+
              backend/cmd/server
                       |
        +--------------+--------------+------------------+
        |                             |                  |
   MySQL 8 mutasi_hub        Connecta B2B API     Sync worker internal
   (migrasi auto-apply)      X-API-KEY, 15 dtk    (goroutine, ticker
   3306                      timeout, retry 5xx   1 menit, di dalam
                             2x: 500ms, 1000ms    proses backend)
        |                             |                  |
        |                             |  webhook masuk   |
        |                             |  POST /webhooks/connecta
        |                             |  (secret bersama)
        |                             |
        |                      Gobiz QRIS (NONAKTIF)
        |                      pay-gobiz -> 503
        +------------------------------+------------------+
                       |
              Callback Enterprise -> URL member
              (HMAC-SHA256, retry 3x)
```

Alur data utama:

1. Browser → Next.js (render halaman) → Go API (JSON) → MySQL.
2. Go → Connecta (tarik mutasi, binding DANA, inquiry, cek kuota).
3. Connecta → Go via webhook (`POST /webhooks/connecta`): binding selesai,
   notifikasi transaksi.
4. Sync worker (di dalam proses Go) polling Connecta tiap menit, menulis
   `mutations`, memicu callback Enterprise.
5. Member eksternal → Go langsung via `GET /api/v1/mutasi` dengan
   `X-API-Key` (tanpa lewat Next.js).

---

## 3. Layout repo

```
mutasi-platform/
├── README.md                 # ikhtisar awal proyek (scaffold v1)
├── FLOW.md                   # file ini
├── audit-full-2026-11-07.md  # audit keamanan/fitur (44 temuan)
├── audit-uiux-2026-11-08.md  # audit UI/UX (23 temuan)
├── backend/                  # Go 1.27, module mutasi-hub
│   ├── go.mod                # deps: go-sql-driver/mysql v1.9.3,
│   │                         #   golang.org/x/crypto v0.44.0
│   ├── .env.example          # daftar env (placeholder saja)
│   ├── cmd/server/main.go    # start: config -> DB -> migrasi ->
│   │                         #   HTTP server + sync worker
│   ├── internal/
│   │   ├── config/           # Load() env -> Config (config.go)
│   │   ├── db/               # koneksi MySQL, Migrate() auto-apply,
│   │   │                     #   GetSetting/SetSetting, Audit()
│   │   ├── auth/             # bcrypt, JWT HS256, TOTP RFC 6238
│   │   ├── crypto/           # AES-256-GCM + masking (tel./rekening)
│   │   ├── connecta/         # client HTTP Connecta B2B (client.go)
│   │   ├── sync/             # worker polling mutasi + callback (sync.go)
│   │   ├── domain/           # aturan Plan + FreezeAccountIDs (v30)
│   │   └── http/             # router + handler + middleware
│   │       ├── server.go     # semua route, sesi, limiter
│   │       ├── middleware.go # authMember/authAdmin/API key
│   │       ├── auth_handlers.go    # register/login/Google/TOTP
│   │       ├── member_handlers.go  # dashboard/akun/mutasi/paket
│   │       ├── admin_handlers.go   # plan/member/settings/audit
│   │       ├── inquiry_handlers.go # inquiry + limit harian
│   │       ├── webhooks.go         # webhook Connecta
│   │       └── timefmt.go          # format WIB
│   └── migrations/0001-0015  # skema + seed (lihat §5)
└── frontend/                 # Next.js 14.2 App Router, output standalone
    ├── app/
    │   ├── page.tsx          # landing (Tailwind, scope .landing-tw)
    │   ├── layout.tsx        # root layout + SettingsProvider
    │   ├── globals.css       # Tailwind v3 (preflight: false,
    │   │                     #   important: true) + scope .member-shell
    │   ├── login/ register/ forgot-password/ reset-password/
    │   ├── verify-email/ admin-login/   # auth (shell v25)
    │   ├── docs/             # dokumentasi API member (publik)
    │   ├── member/           # dashboard, accounts, api,
    │   │                     #   playground, subscription, security,
    │   │                     #   change-password (halaman inquiry
    │   │                     #   dihapus v35b, dialihkan ke playground)
    │   └── admin/            # dashboard, members, members/[id],
    │                         #   plans, settings, audit-logs, playground
    ├── components/
    │   ├── ui.tsx            # Button, Card, Modal, StatusBadge,
    │   │                     #   DashboardShell, SiteChrome, Field
    │   ├── auth-shell.tsx    # AuthField, AuthButton, GoogleButton,
    │   │                     #   AuthDivider, AuthAlert
    │   ├── inquiry-premium.tsx # kartu hasil inquiry Playground (v35)
    │   └── icons.tsx
    └── lib/
        ├── api.ts            # apiGet/apiPost, ApiError, parseBody,
        │                     #   friendlyError
        ├── format.ts         # planPriceRupiah, formatRupiah,
        │                     #   inquiryFeatureText, planFeatures, dll.
        ├── settings.tsx      # SettingsProvider (GET /api/v1/settings)
        └── banks.ts          # FALLBACK_BANKS (daftar bank lokal)
```

Konvensi penting:

- Backend: router `net/http` stdlib, tanpa framework. Error JSON datar
  `{"error": "kode", "message": "..."}`. `readJSON` memakai
  `DisallowUnknownFields()` (field berlebih → 400) dan batas body 1 MB.
- Frontend: Tailwind v3.4 + PostCSS; `corePlugins.preflight: false` WAJIB
  (preflight merusak panel) + `important: true`. Scope landing/auth
  `.landing-tw`; panel member `.member-shell`; admin `.app-shell`.
- Aturan global lama `table { min-width: 640px }` (globals.css) masih ada —
  tabel panel di HP memakai pola **kartu berlabel** (sejak v31), bukan
  mengubah aturan global.
- Zona waktu: DSN memakai `loc=Asia%2FShanghai` (zona sesi MySQL = CST);
  format WIB dilakukan di lapisan aplikasi; tanggal inquiry dihitung di Go
  (Asia/Jakarta). **Jangan ubah `time_zone` sesi MySQL.**

---

## 4. Alur end-to-end

### 4a. Registrasi / login member

| Langkah | Endpoint / aksi | Tabel / status |
|---|---|---|
| Daftar | `POST /api/v1/auth/register` `{email, password, name}` — validasi email RFC 5322, password bcrypt (min 8 karakter). Limiter: 5/jam/IP | `members` INSERT (status `active`, `email_verified_at` NULL) |
| Verifikasi email | `POST /api/v1/auth/verify-email` — token disimpan hash SHA-256 di `email_verification_tokens` (ada expiry + `used_at`) | `members.email_verified_at` terisi |
| Login email | `POST /api/v1/auth/login` `{email, password}` — bcrypt `password_hash`; member `disabled` → 403; gagal 5x/15 mnt per identitas → 429 | Cookie `mh_session` (JWT HS256, lihat bawah); respons membawa flag `must_change_password` |
| Login Google | `GET /api/v1/auth/google` → redirect Google; `GET /api/v1/auth/google/callback` — cocokkan `google_sub` (bukan email saja); belum terdaftar → redirect `/login?error=not_registered` + banner ajakan daftar (akun TIDAK dibuat diam-diam) | `members.google_sub` |
| 2FA | Bila `totp_enabled=1`: login mengembalikan `totp_required=1` + cookie `mh_totp_pending`; `POST /api/v1/auth/totp/verify-pending` `{totp_code}` — kode TOTP **atau** recovery code sekali pakai (hash SHA-256 di `totp_recovery_codes`, ditandai `used_at` saat dipakai) | `members.totp_secret` (terenkripsi), `totp_recovery_codes` |
| Lupa / reset sandi | `POST /api/v1/auth/forgot-password` (pesan netral, limiter 5/jam/IP) → `POST /api/v1/auth/reset-password` — token hash SHA-256 di `password_reset_tokens` | `members.password_hash` baru |
| Wajib ganti sandi | `POST /api/v1/auth/change-password` (min 8, bukan sandi lama) — selama `must_change_password=1`, semua endpoint member lain diblokir 403 kecuali change-password/logout/me | `members.must_change_password` 1→0, `session_version`+1 |
| Sesi | Cookie `mh_session`: JWT HS256, HttpOnly, Secure, SameSite=Lax, MaxAge 24 jam, **host-only** (tanpa Domain; `COOKIE_DOMAIN` di env sengaja diabaikan server sejak v22). Klaim membawa `session_version`; sliding refresh bila sisa TTL < 12 jam. Logout / ganti sandi / reset sandi menaikkan `session_version` sehingga semua sesi lama mati. Backend menerima cookie `mh_session` ganda (warisan pra-v22 ber-Domain `.rajacek.com` dihapus saat login/logout — perbaikan v27) | `members.session_version`, `admin_users.session_version` |

### 4b. Beli / ganti paket

Paket (seed `0002_seed.sql`): Trial gratis 1 hari (2 rekening, delay 10 mnt,
notif 5 mnt, inquiry OFF); Starter Rp350.000/30 hari (2 rekening, delay 5,
notif 3, inquiry ON); Pro Rp900.000/30 hari (5 rekening, delay 3, notif 2,
inquiry ON); Enterprise Rp1.800.000/30 hari (5 rekening, delay 0, notif 1,
callback ON, inquiry ON). Semua field paket bisa diubah admin (CRUD).

| Langkah | Endpoint / aksi | Tabel / status |
|---|---|---|
| Lihat paket | `GET /api/v1/plans` (publik; fallback statis bila tanpa DB), `GET /api/v1/subscriptions` (member) | `plans`, `subscriptions` |
| Buat langganan | `POST /api/v1/subscriptions` `{plan_slug, confirm_replace?}` → `subscriptions` status `pending` (201). Paket sama yang pending/aktif → 409 `already_pending`. Trial: hanya sekali seumur hidup (`trial_already_used`) | `subscriptions` INSERT `pending` |
| Konfirmasi ganti paket (v30) | Bila ada paket aktif **berbeda** dan `confirm_replace` tidak `true` → **409 `active_subscription_exists`** + payload: `old_plan {name, expires_at, remaining_days}`, `new_plan {name, max_accounts, price_cents}`, `connected_count`, `would_freeze [{id, provider, masked, created_at}]`. Frontend menampilkan modal konfirmasi; tombol "Ya, ganti paket & lanjut bayar" mengulang POST dengan `confirm_replace: true`. **Pembatalan paket lama baru terjadi saat aktivasi, bukan saat order dibuat** | — |
| Bayar (Gobiz) | `POST /api/v1/subscriptions/{id}/pay-gobiz` — **saat ini 503 `payment_unavailable`** karena `gobiz_enabled=0` dan kredensial kosong (lihat §9). Bila aktif: order `pending` di `gobiz_orders` (kedaluwarsa +24 jam, migrasi 0008) | `gobiz_orders` |
| Callback paid | `POST /api/v1/gobiz/callback` — verifikasi secret (HMAC-equal) lalu **re-verifikasi status order ke provider**; gagal verifikasi → fail-closed, tidak ada aktivasi (saat ini belum ada klien status order, jadi callback menjawab 503 — lihat §9). Bila lolos: `activateSubscriptionTx` dalam SATU transaksi: order → `paid`, langganan → `active` (`starts_at=NOW()`, `expires_at=+duration_days`), **semua langganan aktif lain dibatalkan** (`cancelOldSubscriptionsTx`) + audit `subscription_replaced` | `gobiz_orders.status`, `subscriptions.status`, `audit_logs` |
| Klaim trial | Paket harga 0: aktif langsung dalam transaksi yang sama (cancel-old + insert `active` + audit `subscription_replaced` bila ada paket lama) | `subscriptions` INSERT `active` |
| Konfirmasi manual admin | Admin mengubah paket member (`PUT /api/v1/admin/members/{id}`): batalkan semua `active` → insert baru (sudah begitu sejak v19). Pembayaran manual: member buat langganan `pending`, hubungi admin, admin mengaktifkan via jalur ini | `subscriptions` |
| Beku sync (v30) | Bila paket baru `max_accounts` (N) < jumlah rekening terhubung (M): rekening N tertua (urut `created_at` ASC, tiebreak ID) tetap sync, sisanya **dibekukan** — `sync_paused=true` (dihitung live oleh `domain.FrozenAccountIDs`, tanpa migrasi; pulih sendiri saat upgrade/putus rekening). Tambah rekening tetap 403 `account_limit` bila sudah ≥ max | `linked_accounts` (status tetap `active`; beku = komputasi) |

### 4c. Hubung rekening DANA dan BCA

| Langkah | Endpoint / aksi | Tabel / status |
|---|---|---|
| Tambah rekening | `POST /api/v1/accounts` — cek: langganan aktif ada (403 `subscription_expired` bila tidak), jumlah rekening aktif/pending < `max_accounts` paket (403 `account_limit`) | `linked_accounts` INSERT `pending` |
| DANA — binding OAuth | Backend `POST /b2b/dana/binding` `{phone, client_ref=member_id, redirect_url}` → Connecta membalas `oauth_url` (m.dana.id) yang **wajib dibuka member**. Kredensial (nomor HP) dienkripsi AES-256-GCM ke `credential_ciphertext`; hanya `phone_masked` yang tampil. Status tetap `pending` sampai webhook / jaring pengaman sync | `linked_accounts.status='pending'` |
| DANA — aktivasi | Webhook binding Connecta (status sukses) → `active`; ATAU `syncDANA` memeriksa `danaBound` tiap poll dan mengaktifkan akun pending yang terverifikasi ter-binding. Tombol "Otorisasi DANA" permanen: `POST /api/v1/accounts/{id}/binding-url` (regenerasi link) | `linked_accounts.status` pending→active |
| BCA — User ID + PIN | `POST /api/v1/accounts` `{provider: BCA, account_no, user_id, pin}` (PIN KlikBCA 6 digit) → backend `POST /b2b/bca/account`. Kredensial terenkripsi; admin hanya lihat nomor ter-mask + status. **Limit partner: hanya 1 akun BCA di seluruh platform** (409 `bca_limit`) — sync BCA tanpa filter per-rekening akan mencampur mutasi antar-member bila lebih dari satu | `linked_accounts` (provider `BCA`) |
| Hapus rekening | `DELETE /api/v1/accounts/{id}` — mutasi terkait ikut terhapus (FK `ON DELETE CASCADE`) | `linked_accounts` DELETE |
| Lihat rekening | `GET /api/v1/accounts` — berisi `sync_paused` per rekening (v30), saldo, `last_synced_at` | — |

### 4d. Sync mutasi

Worker: goroutine di dalam proses backend (`Syncer.Start`, `internal/sync/sync.go`).
Satu pass langsung saat start, lalu ticker tiap **1 menit**. Status worker:
`GET /api/v1/admin/sync-status`.

| Langkah | Detail |
|---|---|
| Pilih rekening | `PollOnce`: `linked_accounts` status `active`/`pending` yang membernya punya langganan aktif belum kedaluwarsa. Rekening **beku** (v30) dilewati. |
| Patuhi delay paket | Bila `api_delay_minutes > 0` dan `last_synced_at` belum lewat, rekening dilewati pada pass ini (Enterprise delay 0 = tiap menit). |
| Tarik mutasi | DANA: `GET /b2b/dana/transactions?phone&page&page_size` (maks 10 halaman × 20 baris per pass). BCA: `GET /b2b/bca/mutations?limit&type` (filter per `account_no` bila payload membawanya). Akun `pending` DANA dicek dulu binding-nya (`danaBound`); belum ter-binding → diam (tanpa spam error). |
| Dedup | `MutationHash` = SHA-256 atas `member_id\|linked_account_id\|provider\|tx_date(UTC RFC3339)\|type\|amount_cents\|description`. Unik **per rekening** (`uq_mut_account_dedup`, migrasi 0007) — dua member dengan transaksi sama persis tidak saling membuang. Insert memakai `INSERT IGNORE` (baris duplikat dilewati). Tanggal tak ter-parse → baris ditolak (tidak pernah pakai `time.Now()` sebagai pengganti). |
| Simpan | `mutations` (member, rekening, provider, tanggal, tipe CR/DB, nominal sen, deskripsi, pengirim) + update `linked_accounts.balance_cents` + `last_synced_at`. |
| Callback (Enterprise) | Bila paket member `callback_enabled=1` dan `callback_url` terisi: POST JSON ke URL member dengan header `X-MutasiHub-Signature: sha256=<hex HMAC-SHA256(secret, body)>` + `X-MutasiHub-Event`. Secret per member di `members.callback_secret` (dibuat otomatis saat callback pertama). Retry **3 percobaan** (backoff 1 dtk, 2 dtk) bila transport gagal / non-2xx; setiap percobaan dicatat di `callbacks` (status + body respons). |

### 4e. Inquiry rekening

`POST /api/v1/inquiry/bank-account` `{bank_code, account_number}` →
`{account_name, account_number, bank_code, bank_name}` via
`POST /b2b/dana/account-inquiry`. `GET /api/v1/banks` (daftar bank; frontend
punya fallback lokal `FALLBACK_BANKS` di `lib/banks.ts`).
`GET /api/v1/inquiry/usage` → `{inquiry_enabled, limit_today, used_today,
remaining_today, resets_at}`.

Urutan gate (v24, v28):

1. Auth member.
2. Paket aktif `inquiry_enabled=1`, kalau tidak **403 `inquiry_disabled`**
   (Trial OFF; Starter/Pro/Enterprise ON).
3. Rate limit 30/menit per member → 429 `rate_limited`.
4. Limit harian paket → **429 `inquiry_limit_reached`**
   (`{limit_today, remaining_today: 0}`). `plans.inquiry_limit`: NULL =
   tanpa batas, 0 = tidak ada hit diizinkan.
5. Provider (`POST /b2b/dana/account-inquiry`).

Counter (`inquiry_usage_daily`, migrasi 0014): satu baris per member per
**tanggal WIB** (dihitung di Go, Asia/Jakarta — bukan jam MySQL). Naik secara
atomik (transaksi + `SELECT ... FOR UPDATE`, insert bila baris baru) dan
**HANYA setelah provider menjawab** — sukses maupun jawaban definitif
"tidak ditemukan" (404 `inquiry_not_found`) memotong hit; error/timeout
provider **tidak** memotong. Reset 00:00 WIB (`resets_at`).

Error provider **tidak pernah 502** (v28 — Cloudflare mengganti body 502
dengan halaman HTML-nya): gangguan sementara / 5xx / timeout → **503**
`provider_unavailable` / `provider_error` dengan pesan generik (nama vendor
dan body mentah tidak pernah diteruskan ke member). Audit: tiap panggilan
dicatat `bank_inquiry` / `bank_inquiry_failed` (hanya kode bank, tidak
pernah nomor rekening).

Admin playground (`POST /api/v1/admin/connecta/dana/account-inquiry`)
melewati gate paket (admin-only).

### 4f. API member

Hanya `GET /api/v1/mutasi` yang menerima API key (`X-API-Key`); endpoint
member lain session-only (cookie `mh_session`).

| Aturan | Detail |
|---|---|
| Key | Format `mh_` + token acak; yang disimpan hanya hash SHA-256 (`key_hash`) + prefix 11 karakter pertama. Plaintext tampil **satu kali** saat dibuat. Maks 5 key aktif per member; `expires_at` opsional (kedaluwarsa → 401 `api_key_expired`). |
| Scope | `mutasi:read`, `accounts:read`, `webhook:receive`, atau `all` (default). Tanpa `mutasi:read` → 403 `insufficient_scope`. |
| IP whitelist | Daftar IP dipisah koma, cocok **persis** (bukan CIDR); tidak cocok → 403 `ip_not_allowed`. |
| Rate limit | **60/menit** default; **300/menit** untuk paket delay-0 (Enterprise). `last_used_at` diperbarui tiap pakai. |
| Parameter | `from`, `to` (YYYY-MM-DD; `to` = akhir hari), `min_amount`, `max_amount` (**sen**), `sender` (LIKE, di-escape), `type` (CR/DB), `provider` (DANA/BCA), `page`, `page_size` (default 20, maks 100), `format=csv` (seluruh hasil filter; ekspor dibatasi 5000 baris). `format` tak dikenal → 400. |
| Respons | `{data: [{provider, date, type, amount_cents, description, sender}], page, page_size, total}`. Error: 401 `invalid_api_key`/`unauthorized`, 403 `ip_not_allowed`, 429 `rate_limited`, 500 `db_error`. |
| Kelola key | `GET/POST/DELETE /api/v1/api-keys` (member, via sesi). |

### 4g. Admin

Login: `POST /api/v1/admin/login` `{email, pin}` — PIN dicek bcrypt terhadap
`admin_users.pin_hash`; sesi sama seperti member (cookie `mh_session`,
`session_version` di `admin_users`). Login Google admin juga ada lewat
allowlist `ADMIN_GOOGLE_EMAILS`. **Tidak ada UI/endpoint ganti PIN admin**
(ganti manual dari server; terakhir diganti manual 8 Nov 2026).

| Area | Endpoint / aksi |
|---|---|
| Paket | `GET/POST/PUT/DELETE /api/v1/admin/plans` — CRUD lengkap incl. `inquiry_enabled` + `inquiry_limit` (nullable: null = hapus batas, tidak dikirim = tidak diubah); audit old → new. |
| Member | `GET /api/v1/admin/members` (pagination + filter + `total_count`), `GET /api/v1/admin/members/{id}` (email ter-mask, langganan aktif, rekening masked, statistik, prefix API key), `PUT /api/v1/admin/members/{id}` `{name?, plan_id?, status?, email?}` — ganti paket = tutup lama (`cancelled`) + insert baru; ganti email = `google_sub` dihapus + `email_verified_at` direset (unik, 409 `email_taken`); `disabled` menutup akses total (login 403, sesi lama 403, API key 401). `POST /api/v1/admin/members/{id}/reset-password` — sandi sementara **acak 16 karakter** (tampil sekali ke admin), `must_change_password=1`, `session_version`+1. |
| Daftar Rekening (v40) | `GET /api/v1/admin/accounts` (filter provider/status, cari nomor tersamar/nama/email, sortir created/balance/synced, pagination 20 + `total_count`) + `GET /api/v1/admin/accounts/{id}` (detail + 10 mutasi terakhir; dibaca admin diaudit `account_view`) — tiap baris: provider, label, nomor tersamar, member (nama + email ter-mask), saldo, status tampil (Aktif/Menunggu/Beku), terakhir sinkron, ditambahkan, diotorisasi, transaksi terakhir + total mutasi; ringkasan global (total rekening, total saldo, DANA, BCA, pending). Status Beku dihitung SQL paritas `domain.FrozenAccountIDs` (N rekening tertua dipertahankan per `max_accounts` paket aktif; tanpa paket aktif semua beku). Halaman `/admin/rekening` (menu Kelola): kartu statistik, tabel desktop 9 kolom + kartu HP (`.mobile-card-table`), modal detail read-only (strip warna channel DANA `#108ee9` / BCA `#005baa`). Hanya nomor tersamar yang keluar; `credential_ciphertext` tidak pernah dipilih. Tanpa migrasi baru. |
| Pengaturan | `GET/PUT /api/v1/admin/settings` — 5 kunci (lihat §6). |
| Email | `POST /api/v1/admin/email/test` — kirim email tes ke email admin lewat provider aktif (400 bila provider belum dikonfigurasi); semua pengiriman dicatat di `email_logs`. |
| Template Email (v39) | `GET/PUT /api/v1/admin/email-templates[/{key}]`, `POST .../{key}/reset`, `POST .../{key}/preview` — 7 template (verifikasi, reset, tagihan pending/paid, pengingat H-3/H-1, kedaluwarsa) dengan placeholder `{{...}}`; isi default premium di-seed migrasi 0017; fallback ke default kode bila baris hilang/kosong; pratinjau render tanpa kirim. v39b: `POST .../{key}/test` `{to, subject?, body_html?}` — kirim tes template ke alamat tujuan (isi editor saat itu bila diberikan, kalau tidak template tersimpan; subjek diawali `[Tes] `; dicatat `email_logs` kind `template_test`); `GET /api/v1/admin/me` untuk prefill email admin. |
| Audit log | `GET /api/v1/admin/audit-logs` — semua aksi admin/member penting tercatat di `audit_logs` (actor = ID atau hash SHA-256 email, tanpa PII mentah). |
| Connecta | `GET /api/v1/admin/connecta/quota`, `GET /api/v1/admin/connecta/banks`, `POST /api/v1/admin/connecta/test`, `GET /api/v1/admin/connecta/webhook` (status pendaftaran webhook), `POST /api/v1/admin/connecta/dana/account-inquiry` (playground admin). |
| Sync | `GET /api/v1/admin/sync-status` — worker jalan/tidak, last run, last error. |
| Playground | `/admin/playground` — uji inquiry + bank-codes tanpa gate paket. |

### 4h. Webhook Connecta + Gobiz (fail-closed)

| Webhook | Verifikasi | Perilaku |
|---|---|---|
| Connecta → Go `POST /webhooks/connecta` | Secret bersama di header `X-Webhook-Secret` atau field body `secret`; bandingkan `hmac.Equal`. **Tanpa secret yang dikonfigurasi → tolak semua (401)**. Body tak valid → 400 `invalid_json` (sebelum cek secret). | Event `binding`: aktifkan rekening DANA pending hanya bila status ada di allowlist sukses (`success`/`completed`/`bound`/`active`) — status lain/kosong tidak mengaktifkan apa pun (payload webhook Connecta tidak terdokumentasi di koleksi Postman; jaring pengaman = `danaBound` di sync). Event `transaction`/`mutation`: simpan ke `mutations` (dedup, `INSERT IGNORE`), hanya untuk rekening `active` yang nomornya cocok persis (didekripsi lalu dibandingkan; tanpa kunci enkripsi fallback ke bentuk ter-mask). Amount 0 / tanggal tak ter-parse dilewati. Audit tanpa raw body. |
| Gobiz → Go `POST /api/v1/gobiz/callback` | Secret di header `X-Gobiz-Secret` atau field body; `hmac.Equal`; lalu **re-verifikasi status order ke provider** sebelum aktivasi apa pun. | Idempotent (order `paid` tidak boleh memperpanjang `expires_at` lewat replay). **Saat ini re-verifikasi belum bisa dilakukan** (tidak ada klien status order Gobiz) → callback menjawab 503 dan tidak mengaktifkan apa pun. |

---

## 5. Tabel database utama

Migrasi auto-apply saat startup backend (`db.Migrate`, tracking
`schema_migrations`, versi = nama file). 0001–0017.

| Tabel | Kolom kunci | Relasi / catatan |
|---|---|---|
| `members` | `id` (36), `email` UNIQUE, `password_hash` (bcrypt), `name`, `google_sub` UNIQUE NULL, `email_verified_at`, `callback_url`, `callback_secret` (0009), `totp_secret` (terenkripsi), `totp_enabled`, `status` (0004: `active`/`disabled`), `must_change_password` (0005), `session_version` (0006) | Induk: subscriptions, linked_accounts, mutations, api_keys, callbacks, token, inquiry_usage_daily — semua `ON DELETE CASCADE` |
| `admin_users` | `id`, `email` UNIQUE, `pin_hash` (bcrypt), `role`, `session_version` (0006) | Admin pertama dibuat saat deploy awal |
| `plans` | `id` BIGINT AUTO_INCREMENT, `slug` UNIQUE, `name`, `price_cents`, `duration_days`, `max_accounts`, `api_delay_minutes`, `notif_interval_minutes`, `max_devices`, `callback_enabled`, `inquiry_enabled` (0003), `inquiry_limit` NULL (0013), `is_active` | — |
| `subscriptions` | `id`, `member_id` FK, `plan_id` FK, `status` (`pending`/`active`/`cancelled`), `starts_at`, `expires_at` | Satu member bisa punya riwayat banyak; yang aktif dijamin ≤1 sejak v30 (aktivasi membatalkan yang lain) |
| `linked_accounts` | `id`, `member_id` FK, `provider` (DANA/BCA), `label`, `phone_masked`, `account_masked`, `credential_ciphertext` (AES-256-GCM), `status` (`pending`/`active`), `balance_cents`, `last_synced_at`, `created_at`, `authorized_at` NULL (0015, v34: tanggal otorisasi pertama, diisi saat pertama jadi `active`, tidak di-backfill) | Index provider (0012, untuk lock BCA) |
| `mutations` | `id` BIGINT, `member_id` FK, `linked_account_id` FK, `provider`, `tx_date`, `type`, `amount_cents`, `description`, `sender`, `dedup_hash` CHAR(64) | Unik per rekening: `uq_mut_account_dedup (linked_account_id, dedup_hash)` (0007) |
| `api_keys` | `id`, `member_id` FK, `key_hash` CHAR(64), `key_prefix`, `scope`, `ip_whitelist`, `is_active`, `last_used_at`, `expires_at` NULL (0010) | Maks 5 aktif/member (aturan aplikasi) |
| `callbacks` | `id` BIGINT, `member_id` FK, `event`, `payload`, `target_url`, `status_code`, `response_body` | Jejak callback Enterprise (tiap percobaan) |
| `settings` | `setting_key` PK, `value`, `updated_at` | Kunci brand + Gobiz + SMTP v37 (lihat §6) |
| `audit_logs` | `id` BIGINT, `actor_type`, `actor_id` (ID atau hash SHA-256 email), `action`, `detail`, `ip` | Tanpa PII mentah |
| `gobiz_orders` | `id`, `member_id` FK, `subscription_id` FK, `amount_cents`, `qr_url`, `status` (`pending`/`paid`/…), `external_id`, `expires_at` (0008, +24 jam) | — |
| `password_reset_tokens` | `id`, `member_id` FK, `token_hash` CHAR(64), `expires_at`, `used_at` | — |
| `email_verification_tokens` | `id`, `member_id` FK, `token_hash` CHAR(64), `expires_at`, `used_at` | — |
| `totp_recovery_codes` (0011) | `id`, `member_id` FK, `code_hash` CHAR(64), `used_at` | 8 kode per enable 2FA; plaintext tidak pernah disimpan |
| `inquiry_usage_daily` (0014) | `member_id` + `usage_date` (PK), `used` | Satu baris per member per tanggal WIB |
| `email_logs` (0016, v37) | `id`, `member_id` NULL, `kind`, `ref_id` NULL, `subject`, `to_email`, `status` (`sent`/`failed`), `error` NULL | Semua pengiriman email; anti-duplikat pengingat via (`kind`, `ref_id`) |
| `admin_announcements` (0016, v37) | `id`, `title`, `body`, `created_by` NULL, `status` (`draft`/`sent`), `sent_count`, `failed_count`, `sent_at` NULL | Pengumuman admin ke semua member aktif; hanya bisa dikirim sekali |
| `email_templates` (0017, v39) | `` `key` `` PK (= nilai `kind` sendMail: `email_verification`, `password_reset`, `order_pending`, `order_paid`, `expiry_reminder_h3`, `expiry_reminder_h1`, `subscription_expired`), `subject`, `body_html`, `updated_at` | Template email yang bisa dicustom admin (`/admin/email-templates`); default premium di-seed migrasi (= fallback di kode); baris hilang/kosong → default kode |
| `schema_migrations` | `version` | Tracking migrasi yang sudah ter-apply |

---

## 6. Konfigurasi

### 6a. Variabel env backend (dibaca `internal/config/config.go`)

File: `/etc/mutasi-hub/mutasi.env` (600, di server saja — jangan commit).
Nilai di bawah ini HANYA nama + arti; isinya ada di server.

| Variabel | Arti / default |
|---|---|
| `PORT` | Port HTTP backend; default `8080`, deploy `8093` |
| `MYSQL_DSN` | DSN go-sql-driver; kosong = mode tanpa-DB (server tetap jalan, `/healthz` 200, endpoint DB → 503). Backend menambahkan `loc=Asia%2FShanghai` bila belum ada |
| `FRONTEND_URL` | URL publik frontend; dipakai redirect balik OAuth Google; deploy `https://mutasi.rajacek.com` |
| `COOKIE_DOMAIN` | **Diabaikan server** sejak v22 — cookie sesi selalu host-only |
| `JWT_SECRET` | Secret penanda sesi JWT (min 32 karakter acak); kosong = fallback acak per-proses (sesi tidak bertahan restart) |
| `ENCRYPTION_KEY` | Kunci AES-256-GCM 32 byte (base64/hex) untuk kredensial member; bila tidak valid, enkripsi dimatikan + log peringatan |
| `CONNECTA_BASE_URL` | Base URL Connecta; WAJIB berakhir `/api/v1` |
| `CONNECTA_API_KEY` | Kunci partner Connecta (header `X-API-KEY`) |
| `CONNECTA_WEBHOOK_SECRET` | Secret bersama webhook Connecta masuk |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URL` | OAuth Google (redirect URI deploy: `https://mutasi.rajacek.com/api/v1/auth/google/callback`) |
| `ADMIN_GOOGLE_EMAILS` | Allowlist email admin Google, dipisah koma |
| `GOBIZ_API_KEY` / `GOBIZ_WEBHOOK_SECRET` | QRIS Gobiz (saat ini kosong — lihat §9) |

### 6b. Variabel env frontend

| Variabel | Arti |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL backend Go; deploy `https://mutasi.rajacek.com` |
| `NEXT_PUBLIC_SITE_NAME` | Nama brand default bila settings belum termuat (`MutasiHub`) |

### 6c. Setting di database (tabel `settings`, diubah admin dari panel)

| Kunci | Seed (0002) | Arti |
|---|---|---|
| `site_name` | `MutasiHub` | Nama brand (dipakai landing, judul, `GET /api/v1/settings`) |
| `tagline` | `Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern` | Tagline hero landing |
| `logo_url` | (kosong) | URL logo |
| `accent_color` | `#0B6B4F` | Warna aksen; **nilai live saat ini `#047857` (emerald, diputuskan v31)** |
| `gobiz_enabled` | `1` | Saklar pembayaran Gobiz; **nilai live saat ini `0`** (lihat §9) |
| `smtp_enabled` (v37) | `0` | Saklar pengiriman email; `1` = email aktif (butuh host + alamat pengirim) |
| `smtp_host` (v37) | (kosong) | Host SMTP, mis. `smtp.gmail.com` |
| `smtp_port` (v37) | (kosong → 587) | Port SMTP: 587 STARTTLS, 465 TLS |
| `smtp_username` (v37) | (kosong) | Username SMTP (boleh kosong = tanpa auth) |
| `smtp_password` (v37) | (kosong) | Password SMTP — disimpan `enc:` + AES-256-GCM; **tidak pernah dikembalikan ke panel** (hanya flag `smtp_password_configured`); kosong saat simpan = pertahankan yang lama |
| `smtp_tls_mode` (v37) | `starttls` | `none` / `starttls` / `tls` |
| `smtp_from_name` (v37) | `MutasiHub` | Nama pengirim di email member (dipakai ulang provider Mailketing API) |
| `smtp_from_email` (v37) | (kosong) | Alamat pengirim (wajib berisi `@` bila diisi; dipakai ulang provider Mailketing API) |
| `mail_provider` (v38) | (kosong → `smtp`) | Provider pengiriman email: `smtp` atau `mailketing_api` |
| `mailketing_api_key` (v38) | (kosong) | Token API Mailketing — disimpan `enc:` + AES-256-GCM; **tidak pernah dikembalikan ke panel** (hanya flag `mailketing_api_key_configured`); kosong saat simpan = pertahankan yang lama |

---

## 7. Alur deploy

Versi terakhir live: **v40b** (backend tetap v40 sha256 `18278bacfbc9da5a9a496222780b6caa29774aa79038572fd14cea62b051166d`, frontend v40b; BUILD_ID `CxrvAUDqfiUtfU-Elf9bR`). Penomoran:
`v<angka>` untuk rilis, huruf akhir (`b/c/d`) untuk hotfix.

1. **Bangun lokal** (workspace `~/workspace/mutasi-platform/`):
   - Backend: `source ~/workspace/tools/go1.27.2/env.sh` (Go 1.27.2,
     `GOTOOLCHAIN=local`) → `go vet ./...` + `go test ./...` hijau →
     `GOOS=linux GOARCH=amd64 go build -o <staging>/mutasi-hub ./cmd/server`
     (polos — tanpa `-trimpath`, `-ldflags '-s -w'`, atau `CGO_ENABLED=0`;
     perintah lama dengan ketiganya menghasilkan binary berbeda, terbukti
     saat verifikasi rebuild v34: hash hanya cocok dengan `go build` polos).
   - Frontend: `NEXT_PUBLIC_API_URL=https://mutasi.rajacek.com
     NEXT_PUBLIC_SITE_NAME=MutasiHub npm run build` → salin
     `.next/standalone` + `.next/static` + `public/` (standalone TIDAK
     menyertakan `public/` otomatis; server standalone harus di-restart
     setelah menyalin keduanya).
2. **Staging persisten** di `~/workspace/mutasi-transfer-staging/v<versi>/`
   (BUKAN `/tmp` — tmpfs 512 MB dan dibersihkan antar-turn). Script transfer
   per versi: `~/workspace/tools/mutasi-transfer-v<versi>.sh`.
3. **Transfer chunked 128 KB** via wrapper SSH (scp langsung putus ~510 KB):
   verifikasi hash **per-chunk** + hash final di VPS sebelum deploy.
4. **Backup dulu** di VPS: `/root/backup-mutasi-v<versi>/` (binary +
   frontend yang sedang live). Backup awal: `/root/backup-mutasi-20261107`.
5. **Deploy**: letakkan binary + aset baru, `chown` sesuai proses,
   restart `mutasi-hub-api` (bila backend berubah) dan/atau
   `mutasi-hub-web` (bila frontend berubah). **Jangan** restart keduanya
   tanpa alasan; `mutasi-hub-web` tidak perlu restart bila hanya backend
   yang berubah (dan sebaliknya).
6. **Hard gate (wajib untuk deploy backend):** setelah start, poll
   `https://mutasi.rajacek.com/healthz` sampai `db:true` (maks ~60 dtk).
   Bila tidak `db:true` → **otomatis rollback ke backup** dan laporkan.
   (Pelajaran v21: deploy lolos cek hash tapi backend jalan mode no-DB
   karena DSN rusak — `db:false` satu-satunya penanda.)
7. **Verifikasi live:** healthz 200 + `db:true`, halaman kunci 200
   (`/login`, `/member/*`, `/admin/*`, `/docs`), skenario yang diubah
   dites end-to-end dengan akun tes, lalu akun tes **dihapus** (member
   live kembali 6).
8. **Aturan file hasil deploy:** `cp -r <src> <dest>` bila dest SUDAH ADA
   menyarangkan src ke dalam dest — pakai `cp -r <src>/. <dest>/` atau
   pastikan dest belum ada.

Peringatan yang pernah terbukti (jangan diulang):

- Jangan andalkan `cargo`/`go build ... | tail` tanpa cek exit code.
- Jangan splice file dengan dua `index()` tanpa cek urutan start < end.
- Jangan baca/print file env ke output (nilai teredaksi di tampilan tool
  bisa tersalin sebagai teks `<redacted>` harfiah).
- Cloudflare mengganti body 502 origin dengan halaman HTML-nya sendiri —
  error provider selalu 503 (v28).
- Perintah start proses lewat SSH jangan dirangkai `... && nohup ... &`
  dalam satu baris (sesi menggantung).

---

## 8. Riwayat versi singkat

Satu baris per versi besar (detail lengkap ada di laporan audit dan
catatan proyek; nomor versi terbukti dari script transfer
`mutasi-transfer-v<versi>.sh`).

| Versi | Isi |
|---|---|
| v1 (6–7 Nov 2026) | Scaffold awal (Go + Next.js) + deploy awal ke mutasi.rajacek.com |
| v5 | Perbaikan kontrak FE↔BE; Gobiz callback + webhook fail-closed; limit BCA 1 akun; trial langsung aktif |
| v6–v7 | `binding-url` DANA + tombol "Otorisasi DANA" permanen |
| v8 | Inquiry Rekening (`plans.inquiry_enabled`, Trial OFF) |
| v9–v10 | Redesign ala Rajacek + Playground Live/Demo; template panel Rajacek |
| v11–v18 | Audit premium P0+P1; tipografi compact; progressive disclosure (modal + filter); /docs; landing premium + SEO; jarak kartu rapat |
| v19 | Detail + edit member admin (modal edit premium di v19c) |
| v20 | Reset kata sandi member oleh admin + admin bisa ubah email member |
| v21 | **Gagal deploy** (DSN rusak → mode no-DB) + rollback ke v20 |
| v21b | DSN diperbaiki (`loc=Asia%2FShanghai`) + reset sandi acak + hard gate healthz |
| v21c/v21d | Layout Detail Member; modal HP bisa di-scroll |
| v22 | Semua 24 temuan P2 audit penuh (2FA lengkap, callback HMAC, batas API key, dsb.) + hotfix v22b |
| v23 | Redesign landing (gaya Stripe/Linear/Wise) + Kalkulator Simulasi Harga |
| v24 | Limit harian Inquiry (reset 00:00 WIB, counter atomik) |
| v25 | Template login/registrasi mengikuti landing |
| v26 | Template member panel (scope `.member-shell`) |
| v27 | Perbaikan cookie ganda (member terpental ke login <1 detik) |
| v28 | Error provider 502 → 503 (Cloudflare tidak lagi mengganti body) |
| v29 | Hapus banner statis "PIN awal masih default" di /admin-login |
| v30 | Konfirmasi ganti paket + beku sync nomor lebih |
| v30b | Badge "Sync dijeda" rapi di dalam kartu HP |
| v31 | Semua 23 temuan audit UI/UX (P0: 2, P1: 9, P2: 12): tabel panel jadi kartu di HP, /docs + /admin-login ikut bahasa desain baru, aksen emerald `#047857`, input panel 16px |
| v31b | Hotfix: harga member mono→sans tabular + tabel Rekening detail member jadi kartu |
| v31c–v32 | Modal Tambah Rekening bertema channel (tab BCA badge "Read-Only" + "AES-256", PIN 6 digit) + kartu premium |
| v33 | Daftar "Rekening terhubung" premium |
| v34 | Tanggal "Ditambahkan" (selalu, dari `created_at`) + "Diotorisasi" (hanya bila aktif dan `authorized_at` terisi) di rekening; migrasi 0015 `authorized_at` + 2 jalur self-heal sync |
| v35 | Redesign inquiry Playground (komponen `inquiry-premium.tsx`); inquiry member + admin terverifikasi live |
| v35b | Hapus tab "Inquiry Rekening" dari nav member + hapus halaman `app/member/inquiry/`; redirect 307 `/member/inquiry` → `/member/playground` |
| v36 | Redesign premium daftar Rekening terhubung, murni CSS (scope `.member-shell.accounts-card`; `page.tsx` tidak diubah) |
| antara v36–v37 (10 Nov, VPS Agent) | Halaman Syarat & Ketentuan + Kebijakan Privasi premium + sitemap (`/terms`, `/privacy`, `sitemap.ts`, `legal-shell.tsx`) + `DEPLOY_RUNBOOK.md`; di-deploy langsung dari VPS (BUILD_ID `ufQxR59nXfRRDbR4ET3mr`) dan di-push VPS Agent ke GitHub (`dea617e`); masuk repo lokal via `git fetch` + rebase saat v37 |
| v37 | **SMTP + email member**: package `internal/mail` (stdlib `net/smtp` + `crypto/tls`; STARTTLS 587, TLS 465, plain); pengaturan SMTP di panel admin (password terenkripsi AES-256-GCM, tidak pernah dikembalikan ke panel) + `POST /admin/email/test` (400 `smtp_not_configured` bila belum dikonfigurasi); email verifikasi + reset password (fail-open); email tagihan pending (pay-gobiz) + paid (callback Gobiz); pengingat paket H-3/H-1 + notice kedaluwarsa via job 30 menit (anti-duplikat via `email_logs`); pengumuman admin ke semua member aktif (`/admin/announcements`, draf → terkirim sekali); migrasi 0016 (`email_logs`, `admin_announcements`); `GET /api/v1/settings` kini allowlist kunci publik (kunci `smtp_*` tidak bocor) |
| v38 | **Provider Mailketing API (pengganti SMTP, keputusan user)**: `internal/mail` tambah provider `mailketing_api` — kirim lewat REST API v2 `POST https://api.mailketing.co.id/api/v2/send` (`Authorization: Bearer` token, body `from_name`/`from_email`/`subject`/`recipient`/`content`, satu request = satu penerima; error mapping 401 token tidak valid / 402 kredit habis / 403 domain belum terverifikasi / 422 validasi / 429 rate limit; token tidak pernah muncul di error/log); pengaturan admin tambah `mail_provider` (`smtp` \| `mailketing_api`) + `mailketing_api_key` terenkripsi AES-256-GCM (hanya flag `mailketing_api_key_configured` yang dikembalikan ke panel); alamat/nama pengirim dipakai ulang dari field SMTP; tombol kirim email tes memakai provider aktif (400 `mailketing_api_key_not_configured` bila provider Mailketing aktif tapi key belum diisi); semua alur email (verifikasi, reset, tagihan, pengingat H-3/H-1, pengumuman) lewat provider aktif; kode SMTP tetap ada sebagai pilihan provider; tanpa migrasi baru (hanya settings key) |
| v39 | **Template email custom admin**: tabel `email_templates` (migrasi 0017, di-seed 7 default premium) — key = nilai `kind` sendMail; admin mengedit subjek + isi HTML dari `/admin/email-templates` (menu Kelola, di sebelah Pengumuman) dengan placeholder `{{nama}}`/`{{paket}}`/`{{jumlah}}`/`{{order_id}}`/`{{tautan}}`/`{{berlaku_sampai}}`/`{{sisa_hari}}` (nilai di-escape HTML; placeholder tak dikenal dibiarkan apa adanya); teks polos diturunkan otomatis dari HTML (tautan jadi "label (url)"); fallback ke default kode bila baris hilang/kosong; tombol reset ke default + pratinjau render dengan data contoh (tanpa kirim email); validasi `{{tautan}}` wajib ada di template verifikasi/reset; endpoint `GET/PUT /api/v1/admin/email-templates[/...]` + `POST .../reset` + `POST .../preview`, diaudit; kerangka `emailShell` tetap sebagai pembungkus baku; email tes tetap baku, pengumuman tetap ditulis admin tiap kali |
| v39b | **Tombol Kirim Tes per template**: `POST /api/v1/admin/email-templates/{key}/test` `{to, subject?, body_html?}` (admin-only, diaudit) — kirim tes template ke alamat tujuan yang dimasukkan admin; bila subject/body_html diberikan, isi editor saat itu dirender (belum tentu tersimpan), bila tidak, template tersimpan; subjek diawali `[Tes] `; validasi alamat tujuan (RFC 5322) → 400 bila tidak valid; gagal bersih bila provider belum dikonfigurasi; dicatat `email_logs` kind `template_test`; `GET /api/v1/admin/me` untuk prefill email admin; halaman template tambah input alamat tujuan (prefill email admin) + tombol Kirim Tes (nonaktif saat mengirim); tanpa migrasi baru (schema tetap 0017) |
| v39c | **Perbaikan crash halaman Template Email ("Application error")**: akar masalah — 5 dari 7 definisi template tidak punya field `Required` (slice Go nil) sehingga `templateRow()` mengembalikan `"required_placeholders": null` di list + detail; frontend crash di `selected.required_placeholders.length` (`null.length` → TypeError → error boundary). Daftar tampil normal, auto-select template pertama (email_verification, punya Required) normal, 5 template lain crash saat diklik. Perbaikan: backend `templateRow()` memaksa `Placeholders`/`Required` non-nil (helper `nonNilStrings`, JSON `[]` bukan `null`; isi Required tetap kosong untuk 5 template itu — hanya verifikasi/reset yang wajib `{{tautan}}`); frontend `?? []` sebelum `.map`/`.length` (defense in depth); tes regresi `TestTemplateRowNeverNullArrays` (list + detail ke-7 template tidak pernah mengembalikan array null; 5 template tanpa Required terserialisasi `[]`); pratinjau/tes tidak mengembalikan array (hanya string) jadi tidak tersentuh. Tanpa migrasi baru (schema tetap 0017) |
| v40 | **Halaman admin Daftar Rekening** (`/admin/rekening`, menu Kelola): endpoint `GET /api/v1/admin/accounts` (filter provider/status, cari nomor tersamar/nama/email, sortir created/balance/synced, pagination 20 + `total_count`) + `GET /api/v1/admin/accounts/{id}` (detail + 10 mutasi terakhir; diaudit `account_view`) + ringkasan global (total rekening, total saldo, DANA, BCA, pending); tiap baris: provider, label, nomor tersamar, member (nama + email ter-mask), saldo, status tampil, terakhir sinkron, ditambahkan, diotorisasi, transaksi terakhir + total mutasi. Status Beku dihitung SQL paritas `domain.FrozenAccountIDs` (N rekening tertua dipertahankan per `max_accounts` paket aktif; tanpa paket aktif semua beku). Halaman: kartu statistik, tabel desktop 9 kolom + kartu HP (`.mobile-card-table`), modal detail read-only (strip warna channel DANA `#108ee9` / BCA `#005baa`). Hanya nomor tersamar yang keluar; `credential_ciphertext` tidak pernah dipilih. Tanpa migrasi baru (schema tetap 0017). Tes: `TestAccountDisplayStatus`, `TestAccountSortClause`, `TestAccountListWhere` |
| v40b | **Perbaikan cacat tampilan tabel Daftar Rekening (frontend-only; backend tidak berubah, tanpa migrasi baru, schema tetap 0017)**: akar masalah — tabel `width: 100%` + `table-layout: fixed` dengan colgroup persen (20/8/16/11/14/11/8/7/5%) membuat tabel PAS muat di kartu (1190px vs kartu 1232px di 1920px) sehingga `.table-wrap { overflow-x: auto }` tidak pernah aktif (scrollWidth == clientWidth, tidak ada scroll yang bisa dipakai); kolom persen terlalu sempit untuk isinya dan `.table-fixed td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }` memotong isi sel — tombol Detail (±72px) di kolom 5% (±60px) terpotong ("Detai"), header `th` tanpa aturan overflow meluber ("DITAMBAHKANDETAIL"), tanggal terpotong tengah nilai ("10 Nov 2026, 17.3…", "09 Nov 2…"); di ≤1440px tombol bahkan menonjol melewati tepi kanan kartu. Perbaikan: colgroup persen → piksel tetap 188/84/180/152/140/100/112/108/104 (= 1168px, `table.rekening-table { min-width: 1168px }` di scope halaman — aturan global `table { min-width: 640px }` dan template `.app-shell` TIDAK diubah) sehingga di bawah 1168px tabel melebar melewati wrap dan scroll horizontal aktif dengan scrollbar terlihat; header `th` diberi `overflow: hidden; text-overflow: ellipsis`; tanggal di tabel dipendekkan ke tanggal saja ("10 Nov 2026", jam lengkap tetap di modal detail); email member diberi ellipsis rapi via `td.rekening-email` (nama member tampil utuh; override media query ≤640px membatalkan ellipsis agar email membungkus penuh di kartu HP). Verifikasi repro Playwright lokal (data terburuk: email panjang, saldo Rp1.234.567.890): 1920px muat tanpa scroll, semua header/sel utuh, tombol Detail utuh; 1440/1366/1280px scroll berfungsi (scrollLeft 74/148/234) dan Detail utuh setelah digeser; 390px transformasi kartu HP utuh (thead tersembunyi, email membungkus penuh, tidak ada overflow halaman). Backup `/root/backup-mutasi-v40b/`; frontend BUILD_ID `CxrvAUDqfiUtfU-Elf9bR`; chunk rekening baru `page-d963b8844d367eb9.js` = 200 |

---

## 9. Batasan yang masih berlaku

Jujur, dari konteks proyek (bukan tebakan):

- **Gobiz nonaktif** (`gobiz_enabled=0`, `GOBIZ_API_KEY` +
  `GOBIZ_WEBHOOK_SECRET` kosong): `pay-gobiz` → 503, tidak ada order
  dibuat; callback `paid` tidak bisa mengaktifkan langganan karena belum
  ada klien verifikasi status order. Copy landing yang menjanjikan
  "Pembayaran resmi otomatis via QRIS Gobiz" **belum sesuai kenyataan** —
  menunggu keputusan user (ubah copy vs aktifkan Gobiz).
- **Google OAuth kosong** (client ID/secret kosong) → `GET /api/v1/auth/google`
  503. Redirect URI yang harus didaftarkan:
  `https://mutasi.rajacek.com/api/v1/auth/google/callback`.
- **Email via Mailketing API (v38) tapi API key belum diisi** — SMTP
  dibatalkan atas keputusan user (10 Nov ~20:52 WIB); provider aktif
  harus dipilih `mailketing_api` di panel admin + isi API key
  (token dari dashboard Mailketing → Integrasi → Email Application
  API). Selama belum diisi, email verifikasi, reset password,
  tagihan, dan pengingat TIDAK terkirim (fail-open: register/order
  tetap sukses). Yang butuh user: pilih provider Mailketing API, isi
  API key, lalu tekan kirim email tes. Catatan verifikasi: endpoint
  tes mengembalikan 401 tanpa sesi admin (route ada + auth jalan);
  perilaku 400 `mailketing_api_key_not_configured` tanpa key belum
  terbukti live karena butuh sesi admin.
- **OVO ditunda** — tidak ada endpoint, tabel, atau UI OVO.
- **Disburse belum dibangun** (sengaja, lihat §1) — sumber dana belum
  terbukti; tes pembuktian Rp10.000 menunggu keputusan user.
- **Connecta kadang gangguan**: redirect-loop (301 ke URL sendiri),
  `SERVICE_TEMPORARILY_UNAVAILABLE`, `BANK_SERVICE_UNAVAILABLE`,
  `LIMIT_EXCEEDED`. Happy path inquiry 200 terverifikasi live 9 Nov
  ~06:57 WIB (BRI 002, nama pemilik tampil), tapi sejak sore 9 Nov
  Connecta mengembalikan `account_name` generik ("REKENING
  TERVERIFIKASI …") bukan nama pemilik — menunggu jawaban developer
  Connecta; jangan suruh member coba "Cek Nama Pemilik" sampai pulih.
- **Webhook Connecta ditolak 401** (ditemukan 9 Nov ~18:37 WIB): semua
  webhook ke `/webhooks/connecta` dibalas 401 — secret yang dikirim
  Connecta tidak cocok dengan `CONNECTA_WEBHOOK_SECRET` di env server
  (32 karakter, terisi; daftar ulang webhook tidak memperbaiki).
  Backend terverifikasi benar (probe: header `X-Webhook-Secret` dan
  field body `secret` → 200; field `webhook_secret` / tanpa secret →
  401). Akibatnya binding DANA tidak pernah jadi `active`. Langkah
  berikut: tanya developer Connecta secret dikirim di header/field apa;
  bila `webhook_secret`, patch backend terima field itu juga. Setelah
  perbaikan, member wajib otorisasi ulang (webhook yang ditolak tidak
  dikirim ulang). Tes binding DANA nyata end-to-end belum ada member
  yang terbukti menyelesaikan otorisasi sampai `active`.
- **PIN admin tidak ada UI/endpoint ganti** — ganti manual dari server
  (terakhir 8 Nov 2026; nilai PIN tidak dicatat di mana pun).
- **Kuota demo Connecta kedaluwarsa 2026-12-07 10:10 WIB** (5 DANA / 1 BCA).
- **Sisa kecil di luar 23 temuan audit UI/UX:** input email
  `/forgot-password` 14px di desktop, slider kalkulator 14px, URL Base
  Connecta membungkus di tengah kata, label stat dashboard tetap 2 baris.
- **Temuan sampingan (belum diperbaiki):** fallback SettingsProvider ke
  `/api/v1/admin/settings` — 401 dari endpoint admin itu tidak
  dikecualikan dari redirect global ke `/login`.
- **Sisa hit inquiry belum ditampilkan** di tab inquiry Playground member.
