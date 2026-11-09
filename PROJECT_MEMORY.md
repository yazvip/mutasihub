# PROJECT MEMORY

## Ringkasan Proyek
- **Nama:** MutasiHub — Platform Cek Mutasi DANA & BCA Realtime `[FAKTA-TERVERIFIKASI: README.md]`
- **Tujuan:** Cek mutasi DANA & BCA realtime untuk bisnis (top-up, deposit, rekonsiliasi pembayaran otomatis). `[FAKTA-TERVERIFIKASI: README.md]`
- **Status:** Scaffold v1; build terverifikasi, belum dites live end-to-end (butuh kredensial asli). `[FAKTA-TERVERIFIKASI: README.md]`
- **Root/Repo (VPS):** `/home/ubuntu/mutasihub` `[FAKTA-TERVERIFIKASI]`
- **Remote:** `git@github.com:yazvip/mutasihub.git` (deploy key SSH, write access). `[FAKTA-TERVERIFIKASI]`
- **Branch/Commit:** `main` @ `7f5b371` (tracking `origin/main`, 2026-11-09). `[FAKTA-TERVERIFIKASI]`

## Stack Teknologi
- **Backend:** Go `1.27` (module `mutasi-hub`), deps: `github.com/go-sql-driver/mysql`, `golang.org/x/crypto`. `[FAKTA-TERVERIFIKASI: backend/go.mod]`
- **Frontend:** Next.js `14.2.18` (App Router), React `18.3.1`, TypeScript `5.7.2`, Tailwind CSS `3.4.x`. `[FAKTA-TERVERIFIKASI: frontend/package.json]`
- **Database:** MySQL (migrasi 0001–0014). Mode tanpa-DB: `/healthz` tetap 200, endpoint DB -> 503. `[FAKTA-TERVERIFIKASI: README, migrations]`
- **Integrasi (konfigurasi env):** Connecta B2B (DANA+BCA), Google OAuth, GoBiz (QRIS langganan). `[FAKTA-TERVERIFIKASI: README/.env.example]`
- **Keamanan (per README):** bcrypt, JWT, TOTP, AES-256-GCM untuk kredensial member. `[FAKTA-TERVERIFIKASI: README]`

## Struktur Folder Kunci
- `backend/cmd/server/` — entrypoint server. `[FAKTA-TERVERIFIKASI]`
- `backend/internal/` — `auth`, `config`, `connecta`, `crypto`, `db`, `domain`, `http`, `sync`. `[FAKTA-TERVERIFIKASI]`
- `backend/migrations/` — `0001_init.sql` s.d. `0014_inquiry_usage_daily.sql`. `[FAKTA-TERVERIFIKASI]`
- `frontend/app/` — routes (`/`, `/login`, `/register`, `/member/*`, `/admin/*`). `[FAKTA-TERVERIFIKASI: README]`
- `frontend/components/`, `frontend/lib/` — UI dan util API/format/settings. `[FAKTA-TERVERIFIKASI: README]`
- Dokumen audit: `audit-full-2026-11-07.md`, `audit-premium-2026-11-07.md`, `audit-uiux-2026-11-08.md`, `FLOW.md`. `[FAKTA-TERVERIFIKASI]`

## API / Interface Penting (ringkas, dari README)
- Health/settings/plans: `GET /healthz`, `GET /api/v1/settings`, `GET /api/v1/plans`. `[FAKTA-TERVERIFIKASI]`
- Auth: register/login/logout/forgot/reset, Google OAuth, 2FA enable/verify, `/me`. `[FAKTA-TERVERIFIKASI]`
- Member: dashboard/profile, accounts, mutasi (filter + CSV), api-keys, subscriptions (+ GoBiz pay/callback). `[FAKTA-TERVERIFIKASI]`
- Admin: login, plans CRUD, members, settings, Connecta quota/test/sync-status/account-inquiry. `[FAKTA-TERVERIFIKASI]`
- Webhook: `POST /webhooks/connecta`. `[FAKTA-TERVERIFIKASI]`

## Database / Data Penting
- Migrasi: init, seed, plan inquiry, member status, must change password, session version, mutation dedup key, gobiz order expiry, members callback secret, api keys expires, totp recovery codes, linked accounts provider index, plans inquiry limit, inquiry usage daily. `[FAKTA-TERVERIFIKASI: migrations dir]`
- Detail schema per tabel: `[BELUM-SELESAI]` (perlu baca SQL migrasi bila relevan).

## Cara Menjalankan & Menguji (dari README)
- Backend: `cd backend && cp .env.example .env && go run ./cmd/server` (butuh env/secret asli untuk live). `[FAKTA-TERVERIFIKASI]`
- Frontend: `cd frontend && npm install && cp .env.example .env.local && npm run dev`. `[FAKTA-TERVERIFIKASI]`
- Test backend (tercatat di README, 6 Nov 2026): `gofmt -l .`, `go vet ./...`, `go test ./...` (21 PASS), `go test -race ./...`, `gosec ./...` (0 issues). `[FAKTA-TERVERIFIKASI: README]` (hasil lokal VPS belum dijalankan ulang sesi ini `[BELUM-SELESAI]`).

## Fakta Penting
- OVO ditunda/tidak dibangun di v1. `[FAKTA-TERVERIFIKASI]`
- Disbursement DANA (`transfer-to-balance`) **tidak dibangun**; platform read-only untuk member. `[FAKTA-TERVERIFIKASI]`
- JSON member tidak pernah berisi nama/URL provider asli. `[FAKTA-TERVERIFIKASI]`
- Google login dicocokkan via `google_sub`; akun tidak dibuat diam-diam jika belum terdaftar. `[FAKTA-TERVERIFIKASI]`
- Kredensial member terenkripsi AES-256-GCM; admin hanya lihat nomor ter-mask + status. `[FAKTA-TERVERIFIKASI]`

## Asumsi Terbuka
- Environment/toolchain Go & Node.js di VPS mendukung build/run proyek. `[ASUMSI]`
- `.env`/secrets produksi/dev akan diisi manual dan tidak disimpan di repo/dokumentasi. `[ASUMSI]`

## Pekerjaan Belum Selesai
- Verifikasi live end-to-end (butuh kredensial asli). `[BELUM-SELESAI]`
- Jalankan ulang tes/build di VPS untuk baseline aktual. `[BELUM-SELESAI]`
- Isi detail schema DB dan arsitektur alur sync/callback dari kode bila ada perubahan. `[BELUM-SELESAI]`
