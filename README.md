# MutasiHub — Platform Cek Mutasi DANA & BCA Realtime

Scaffold v1 (bisa jalan) ala xavtools.id: cek mutasi DANA & BCA realtime untuk
bisnis — top-up, deposit, rekonsiliasi pembayaran otomatis. Backend Go +
Frontend Next.js. **OVO ditunda** dan tidak dibangun di v1 ini.

> Status: scaffold lengkap + build terverifikasi (lihat "Verifikasi" di bawah).
> Belum dites live end-to-end — butuh kredensial asli (daftar di bawah).

## Struktur

```
mutasi-platform/
├── README.md            # file ini
├── backend/             # Go 1.27, module mutasi-hub
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── config/      # loader env
│   │   ├── db/          # koneksi MySQL + migrasi otomatis
│   │   ├── auth/        # bcrypt, JWT, TOTP
│   │   ├── crypto/      # AES-256-GCM, masking
│   │   ├── connecta/    # client Connecta B2B (DANA + BCA)
│   │   ├── sync/        # worker polling mutasi + callback Enterprise
│   │   └── http/        # router + handler + middleware
│   ├── migrations/0001_init.sql, 0002_seed.sql
│   ├── .env.example
│   └── README.md
└── frontend/            # Next.js 14 App Router, output standalone
    ├── app/             # / landing, /login, /register, /member/*, /admin/*
    ├── components/ui.tsx
    ├── lib/api.ts, lib/format.ts, lib/settings.tsx
    └── .env.example
```

## Cara jalan lokal

```bash
# 1. Backend (tanpa DB tetap jalan, /healthz 200, endpoint DB -> 503)
source ~/workspace/tools/go1.27.2/env.sh
cd backend
cp .env.example .env   # isi nilai asli, JANGAN commit .env
go run ./cmd/server

# 2. Frontend
cd frontend
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8080
npm run dev                  # http://localhost:3000
```

## Env yang dibutuhkan

Backend (`backend/.env.example`, semua placeholder — tanpa secret asli):

| Var | Keterangan |
|---|---|
| `PORT` | default `8080` |
| `FRONTEND_URL` | default `http://localhost:3000` — redirect balik OAuth Google |
| `MYSQL_DSN` | kosong = mode tanpa-DB |
| `JWT_SECRET` | secret sesi, min 32 karakter acak |
| `ENCRYPTION_KEY` | AES-256-GCM 32 byte (base64/hex) untuk kredensial member |
| `CONNECTA_BASE_URL`, `CONNECTA_API_KEY`, `CONNECTA_WEBHOOK_SECRET` | dari Connecta (DANA + BCA) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL` | OAuth member + admin |
| `ADMIN_GOOGLE_EMAILS` | allowlist email admin, dipisah koma |
| `GOBIZ_API_KEY`, `GOBIZ_WEBHOOK_SECRET` | QRIS langganan |

Frontend (`frontend/.env.example`): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_NAME`.

## Endpoint utama (backend :8080)

- `GET /healthz` — status + `db` true/false
- `GET /api/v1/settings` — brand publik (site_name, tagline, logo, accent, gobiz_enabled)
- `GET /api/v1/plans` — daftar paket (fallback statis bila tanpa DB)
- Auth: `POST /api/v1/auth/register|login|forgot-password|reset-password|logout`,
  `GET /api/v1/auth/google` + `/google/callback`, `GET /api/v1/auth/me`,
  `POST /api/v1/auth/2fa/enable|verify`
- Member: `GET /api/v1/member/dashboard|profile`, `GET|POST|DELETE /api/v1/accounts`,
  `GET /api/v1/mutasi` (filter tanggal/nominal/pengirim/tipe, `?format=csv`),
  `GET|POST|DELETE /api/v1/api-keys`, `GET|POST /api/v1/subscriptions`,
  `POST /api/v1/subscriptions/{id}/pay-gobiz`, `POST /api/v1/gobiz/callback`
- Admin: `POST /api/v1/admin/login`, CRUD `/api/v1/admin/plans`,
  `GET /api/v1/admin/members`, `GET|PUT /api/v1/admin/settings`,
  `GET /api/v1/admin/connecta/quota`, `POST /api/v1/admin/connecta/test`,
  `GET /api/v1/admin/sync-status`, `POST /api/v1/admin/connecta/dana/account-inquiry`
- `POST /webhooks/connecta` — callback Connecta (verifikasi secret)

## Aturan kunci yang dikunci

- Member login akun sendiri: **Email + Google, keduanya**, satu `member_id`.
  Google dicocokkan via `google_sub` (bukan email saja); Google belum terdaftar
  -> redirect ke `/login?error=not_registered` + banner ajakan daftar, akun
  tidak dibuat diam-diam.
- Member hubungkan rekening **milik sendiri**: DANA via binding
  (`client_ref=member_id`, pending sampai webhook), BCA via User ID + PIN
  KlikBCA sendiri. Kredensial terenkripsi AES-256-GCM; admin hanya lihat
  nomor ter-mask + status.
- Brand (`site_name`, tagline, logo, accent) + semua isi paket + Gobiz ON/OFF
  bisa diubah admin dari panel (tabel `settings` / CRUD paket) — bukan hardcode.
- **Disbursement DANA (`transfer-to-balance`) TIDAK dibangun** — tidak ada
  method client, tidak ada route member. Platform read-only untuk member.
- JSON member tidak pernah berisi nama/URL provider asli.
- Paket default (seed): Trial gratis 1 hari, Starter Rp350.000/bln (2 rekening),
  Pro Rp900.000/bln (5 rekening), Enterprise Rp1.800.000/bln (5 rekening +
  Instant Callback).

## Verifikasi (6 Nov 2026, hasil nyata)

Backend (Go 1.27.2, `GOTOOLCHAIN=local`):

- `gofmt -l .` → kosong
- `go vet ./...` → bersih, exit 0
- `go test ./...` → **21 test PASS, 0 FAIL** (dedup hash, masking, enkripsi
  roundtrip, bcrypt, JWT tamper/expired, TOTP, validasi paket, Connecta header
  + retry 5xx); `go test -race ./...` lolos; `gosec ./...` → 0 issues
- Build Linux: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath
  -ldflags='-s -w' -o /tmp/mutasi-hub-linux-amd64 ./cmd/server` →
  **sha256 `164c15b733ab3bc01685f3eaca39fdf0d9ef3b3dea0029db5f5b32693575dc13`**,
  7.999.648 byte
- Smoke test binary (tanpa DB): `GET /healthz` → 200 `{"db":false,"status":"ok"}`;
  `GET /api/v1/settings` → 200 (default MutasiHub); `GET /api/v1/plans` → 200
  (4 paket); `GET /api/v1/mutasi` tanpa auth → 401

Frontend:

- `npm install` → sukses; `npm run build` → **sukses, 15/15 halaman static**
  (First Load JS ~98–101 kB), `npm ci` + build ulang → sukses.

Perbaikan integrasi oleh koordinator setelah build awal (lalu di-build ulang
+ smoke test ulang): callback Google kini redirect ke frontend
(`/member/dashboard` bila sukses, `/login?error=not_registered` bila akun
belum terdaftar) — sebelumnya mengembalikan JSON mentah yang membuat user
terdampar di halaman JSON; ditambah endpoint publik `GET /api/v1/settings`
dan env `FRONTEND_URL`.

## Target deploy (TERKUNCI — deploy BELUM dilakukan)

- **Domain:** `mutasi.rajacek.com`
- **VPS:** 43.157.205.163 (Ubuntu, user `ubuntu`, wrapper
  `~/workspace/tools/vps157-ssh.sh`). RAM 1,9 GB (tersedia 1,3 GB),
  disk sisa 24 GB.
- **Port (keduanya kosong saat dicek):** Go backend `127.0.0.1:8093`,
  Next.js `127.0.0.1:13001`. **JANGAN sentuh** yang sudah terpakai:
  `8092` marketplace, `5433` Postgres, `3306` MySQL (+ stack lama .163).
- **DB:** MySQL `43.157.205.163:3306`, database baru **`mutasi_hub`**
  (buat baru khusus proyek ini, jangan pakai/timpa database marketplace).
- **Nginx vhost (nanti):** `mutasi.rajacek.com` → `/api/*` ke `127.0.0.1:8093`,
  `/` + `/_next/*` ke `127.0.0.1:13001`, sertifikat Let's Encrypt.
- **Cookie sesi:** `COOKIE_DOMAIN=.rajacek.com` (pelajaran Rajacek:
  cookie host-only bikin login mental antar-subdomain).
- **DNS — BELUM TERVERIFIKASI:** cek 2026-11-07 00:40 WIB, `dig`
  @1.1.1.1/@8.8.8.8 kosong dan `curl https://mutasi.rajacek.com/`
  masih mengembalikan landing Rajacek (kemungkinan wildcard/propagasi
  belum ke .163). **Jangan klaim DNS sudah benar** — verifikasi ulang
  saat deploy (`dig` + vhost + sertifikat) sebelum mengumumkan live.
- **Env deploy:** `PORT=8093`, `FRONTEND_URL=https://mutasi.rajacek.com`,
  `GOOGLE_REDIRECT_URL=https://mutasi.rajacek.com/api/v1/auth/google/callback`,
  `NEXT_PUBLIC_API_URL=https://mutasi.rajacek.com`.

## Yang BELUM dites live (butuh user)

- **Connecta — TERVERIFIKASI live 2026-11-07 00:46 WIB (key user, dipakai sekali untuk tes, TIDAK disimpan di repo/file):** base URL asli `https://connecta-crm.digitcodestudio.com/api/v1` (host saja = halaman CRM 404; API di bawah `/api/v1`). `GET /api/v1/b2b/docs` 200, `/b2b/quota` 200, `/b2b/dana/accounts`, `/b2b/bca/accounts`, `/b2b/clients` 200 (semua masih kosong). Kuota partner: `is_demo=true`, status ACTIVE, kedaluwarsa **2026-12-06**, maks **5 akun DANA** dan **1 akun BCA** (BCA itu limit partner, bukan per member — perlu dipikirkan saat paket dijual), webhook URL masih kosong. Binding DANA di docs butuh `redirect_url` — sudah diperbaiki di kode (kirim `FRONTEND_URL/member/accounts?dana=callback`). Yang BELUM dites: binding DANA nyata, saldo/transaksi (belum ada akun terhubung), mutasi BCA, webhook masuk.
- **MySQL live**: migrasi 0001/0002 + semua handler DB (register/login,
  akun, mutasi, langganan). Tanpa DB, endpoint tersebut menjawab 503
  `db_unavailable` — by design.
- **Google OAuth client**: Client ID/Secret + redirect URI terdaftar.
  Alur redirect `not_registered` baru dites logikanya, belum end-to-end.
- **Gobiz**: key + spesifikasi resmi endpoint/signature QRIS — saat ini order
  dicatat `pending` di `gobiz_orders` dan callback `paid` mengaktifkan
  langganan; pembuatan QRIS penuh menunggu spesifikasi resmi Gobiz.
- **Domain**: belum ada — deploy VPS ditunda sesuai perintah. Target
  terkunci: `mutasi.rajacek.com` di VPS 43.157.205.163 (lihat "Target
  deploy" di atas). **DNS belum terverifikasi** (cek 2026-11-07 00:40 WIB:
  dig kosong, curl masih landing Rajacek) — verifikasi ulang saat deploy.

## Catatan keamanan

- `govulncheck`: GO-2026-6809 (crypto/x509, fixed di Go 1.27.3) — toolchain
  dipatok 1.27.2 sesuai instruksi, belum ditutup; trace-nya spurious
  (via `fmt.Fprintf`). Kerentanan lain yang dilaporkan hanya di modul yang
  tidak dipanggil kode ini.
- Tidak ada secret yang di-commit: hanya `.env.example` berisi placeholder;
  tidak ada file `.env` di repo. `transfer-to-balance` hanya disebut di
  `backend/README.md` sebagai yang sengaja tidak dibangun — tidak ada di kode.
