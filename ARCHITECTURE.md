# ARCHITECTURE

## Gambaran Umum
Platform cek mutasi DANA & BCA realtime untuk bisnis (top-up, deposit, rekonsiliasi pembayaran otomatis). Backend Go + Frontend Next.js. OVO ditunda. [FAKTA-TERVERIFIKASI: README.md]

## Komponen Utama
- **Backend (Go 1.27):**
  - cmd/server/main.go — entrypoint.
  - internal/config — loader env.
  - internal/db — koneksi MySQL + migrasi otomatis.
  - internal/auth — bcrypt, JWT, TOTP.
  - internal/crypto — AES-256-GCM, masking.
  - internal/connecta — client Connecta B2B (DANA + BCA).
  - internal/sync — worker polling mutasi + callback Enterprise.
  - internal/http — router + handler + middleware.
  - internal/domain — model/domain. [FAKTA-TERVERIFIKASI: README + ls]
- **Frontend (Next.js 14 App Router):**
  - app/ — landing, login, register, member/*, admin/*.
  - components/ui.tsx, lib/api.ts, lib/format.ts, lib/settings.tsx.
  - Output standalone (next.config.js). [FAKTA-TERVERIFIKASI: README]

## Alur Data / Alur Eksekusi (ringkas)
1. Member daftar/login (Email + Google; Google dicocokkan via google_sub).
2. Member hubungkan rekening milik sendiri (DANA binding client_ref=member_id; BCA via KlikBCA).
3. Worker polling mutasi (Connecta B2B) + callback Enterprise.
4. Member melihat mutasi, filter, export CSV; API key untuk integrasi.
5. Admin kelola brand, paket, member, settings, kuota Connecta, sync status.
[FAKTA-TERVERIFIKASI: README aturan kunci]

## Integrasi Eksternal
- Connecta B2B (DANA + BCA) — base URL, API key, webhook secret (env). [FAKTA-TERVERIFIKASI]
- Google OAuth (member + admin). [FAKTA-TERVERIFIKASI]
- GoBiz (QRIS langganan). [FAKTA-TERVERIFIKASI]

## Batasan & Keputusan Desain
- Google belum terdaftar -> redirect /login?error=not_registered; akun tidak dibuat diam-diam. [FAKTA-TERVERIFIKASI]
- Kredensial member terenkripsi AES-256-GCM; admin hanya lihat nomor ter-mask + status. [FAKTA-TERVERIFIKASI]
- Brand/paket/GoBiz ON/OFF dapat diubah admin (bukan hardcode). [FAKTA-TERVERIFIKASI]
- Disbursement DANA (transfer-to-balance) tidak dibangun; platform read-only. [FAKTA-TERVERIFIKASI]
- JSON member tidak pernah berisi nama/URL provider asli. [FAKTA-TERVERIFIKASI]
- OVO ditunda. [FAKTA-TERVERIFIKASI]

## Risiko Teknis
- Kredensial asli diperlukan untuk verifikasi live end-to-end. [FAKTA-TERVERIFIKASI]
- Mode tanpa-DB: endpoint DB -> 503. [FAKTA-TERVERIFIKASI]

## Detail Belum Diverifikasi
- Detail implementasi sync/callback (internal/sync, internal/http). [BELUM-SELESAI]
