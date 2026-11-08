# MutasiHub — Backend

Backend Go untuk platform cek mutasi DANA & BCA realtime untuk bisnis
(terinspirasi xavtools.id). OVO **tidak** dibangun (ditunda). Provider
pihak-3: **Connecta B2B Partner API** (DANA + BCA saja). Platform ini
read-only untuk member — disbursement DANA (`transfer-to-balance`)
sengaja tidak diimplementasikan di mana pun.

## Stack

- Go 1.27.2 (`source ~/workspace/tools/go1.27.2/env.sh`)
- Stdlib `net/http` router (tanpa framework berat)
- MySQL via `database/sql` + `go-sql-driver/mysql`
- Bcrypt (password + PIN admin), JWT HMAC-SHA256 (cookie HttpOnly),
  TOTP RFC 6238 (stdlib), AES-256-GCM (stdlib) untuk kredensial member

## Menjalankan

```bash
source ~/workspace/tools/go1.27.2/env.sh
cp .env.example .env   # isi nilai asli
go run ./cmd/server
# atau build:
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /tmp/mutasi-hub-linux-amd64 ./cmd/server
```

Tanpa `MYSQL_DSN`, server tetap jalan (mode tanpa-DB): `GET /healthz`
menjawab 200, endpoint yang butuh DB menjawab 503 yang jelas.

## Migrasi

`migrations/0001_init.sql` (skema) dan `0002_seed.sql` (4 paket +
settings brand default) dijalankan otomatis saat start bila DB tersedia,
dilacak di tabel `schema_migrations` (idempotent).

Paket seed: Trial gratis 1 hari; Starter Rp350.000/bln; Pro Rp900.000/bln;
Enterprise Rp1.800.000/bln. Semua field paket bisa diubah admin via
`PUT /api/v1/admin/plans/{id}`.

## Endpoint utama

| Route | Keterangan |
|---|---|
| `GET /healthz` | health check |
| `POST /api/v1/auth/register` `login` `logout` | email+password |
| `GET /api/v1/auth/google` + `/google/callback` | Google OAuth (cocok `google_sub`; tak dikenal → `not_registered`) |
| `POST /api/v1/auth/forgot-password` `reset-password` | token reset (di-log, belum ada SMTP) |
| `POST /api/v1/auth/2fa/enable` `verify` | TOTP opsional |
| `GET /api/v1/member/dashboard` `profile` | member |
| `GET/POST /api/v1/accounts`, `DELETE /api/v1/accounts/{id}` | hubungkan DANA (binding, `client_ref=member_id`) / BCA |
| `GET /api/v1/mutasi` (+ `?format=csv`) | filter tanggal/nominal/pengirim/tipe, pagination; sesi atau `X-API-Key` |
| `GET/POST/DELETE /api/v1/api-keys` | key member (IP whitelist, scope) |
| `GET /api/v1/plans` | publik |
| `GET/POST /api/v1/subscriptions`, `POST .../pay-gobiz` | Gobiz QRIS; bila `gobiz_enabled=0` → 409 `gobiz_disabled` |
| `POST /api/v1/gobiz/callback` | verifikasi `GOBIZ_WEBHOOK_SECRET` |
| `GET/POST/PUT/DELETE /api/v1/admin/plans` | CRUD paket |
| `GET /api/v1/admin/members`, `GET/PUT /api/v1/admin/settings` | admin |
| `GET /api/v1/admin/connecta/quota`, `POST /api/v1/admin/connecta/test` | cek Connecta |
| `GET /api/v1/admin/sync-status` | status worker polling |
| `POST /webhooks/connecta` | webhook Connecta (verifikasi secret) |

JSON member tidak pernah berisi nama/URL provider asli — hanya label
generik `DANA` / `BCA`.

## Verifikasi

```bash
source ~/workspace/tools/go1.27.2/env.sh
gofmt -l .          # harus kosong
go vet ./...
go test ./...
```

## Target deploy (TERKUNCI — deploy BELUM dilakukan)

- **Domain:** `mutasi.rajacek.com`
- **VPS:** 43.157.205.163 (Ubuntu, user `ubuntu`, wrapper
  `~/workspace/tools/vps157-ssh.sh`). RAM 1,9 GB (tersedia 1,3 GB),
  disk sisa 24 GB.
- **Port (keduanya kosong saat dicek):** Go backend `127.0.0.1:8093`
  (`PORT=8093`), Next.js `127.0.0.1:13001`. **JANGAN sentuh** yang sudah
  terpakai: `8092` marketplace, `5433` Postgres, `3306` MySQL (+ stack
  lama .163).
- **DB:** MySQL `43.157.205.163:3306`, database baru **`mutasi_hub`**
  (buat baru khusus proyek ini, jangan pakai/timpa database marketplace).
- **Nginx vhost (nanti):** `mutasi.rajacek.com` → `/api/*` ke `127.0.0.1:8093`,
  `/` + `/_next/*` ke `127.0.0.1:13001`, sertifikat Let's Encrypt.
- **Cookie sesi:** `COOKIE_DOMAIN=.rajacek.com` (pelajaran Rajacek:
  cookie host-only bikin login mental antar-subdomain). Lokal:
  `COOKIE_DOMAIN` kosong (host-only).
- **DNS — BELUM TERVERIFIKASI:** cek 2026-11-07 00:40 WIB, `dig`
  @1.1.1.1/@8.8.8.8 kosong dan `curl https://mutasi.rajacek.com/`
  masih mengembalikan landing Rajacek (kemungkinan wildcard/propagasi
  belum ke .163). **Jangan klaim DNS sudah benar** — verifikasi ulang
  saat deploy (`dig` + vhost + sertifikat) sebelum mengumumkan live.
- **Env deploy:** `FRONTEND_URL=https://mutasi.rajacek.com`,
  `GOOGLE_REDIRECT_URL=https://mutasi.rajacek.com/api/v1/auth/google/callback`
  (daftarkan redirect URI ini di Google Cloud Console),
  `NEXT_PUBLIC_API_URL=https://mutasi.rajacek.com`.

## Belum dites live

Butuh kredensial asli: `CONNECTA_BASE_URL` + `CONNECTA_API_KEY`,
Google OAuth client, Gobiz key, dan MySQL live. Integrasi charge QRIS
Gobiz penuh menunggu spesifikasi resmi endpoint + signature Gobiz —
saat ini order dicatat (`gobiz_orders`, status `pending`) dan callback
`paid` sudah mengaktifkan langganan.
