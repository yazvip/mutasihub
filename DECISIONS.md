# DECISIONS

## 2026-11-09 — Inisialisasi Coding Project Memory (MutasiHub VPS)
- **Status:** accepted [FAKTA-TERVERIFIKASI]
- **Konteks:** Proyek mutasihub di-clone ke VPS (/home/ubuntu/mutasihub) dan perlu memori lintas sesi.
- **Opsi:**
  1. Hanya catatan ad-hoc — konteks mudah hilang.
  2. Sistem dokumentasi terstruktur (PROJECT_MEMORY, ARCHITECTURE, DECISIONS, BUG_HISTORY, SESSION_HANDOFF) — dipilih.
- **Keputusan:** Gunakan skill  dan buat 5 dokumen proyek di root repo.
- **Alasan:** Memastikan kelanjutan kerja tanpa analisis ulang; memisahkan fakta terverifikasi/asumsi/belum selesai.
- **Konsekuensi/Dampak:** Setiap sesi coding wajib baca/update dokumen; detail teknis panjang disimpan di docs, bukan memori global.
- **Tindak lanjut:** Perbarui dokumen setiap perubahan signifikan. [BELUM-SELESAI: berkelanjutan]

## Keputusan Teknis Produk (dari README, baseline)
- **OVO ditunda/tidak dibangun di v1.** [FAKTA-TERVERIFIKASI]
- **Disbursement DANA (transfer-to-balance) tidak dibangun; platform read-only.** [FAKTA-TERVERIFIKASI]
- **Login member:** Email + Google, satu member_id; Google via google_sub; akun tidak dibuat diam-diam. [FAKTA-TERVERIFIKASI]
- **Rekening milik sendiri:** DANA binding (client_ref=member_id), BCA via KlikBCA; kredensial AES-256-GCM; admin hanya mask+status. [FAKTA-TERVERIFIKASI]
- **Brand/paket/GoBiz ON-OFF admin-configurable (bukan hardcode).** [FAKTA-TERVERIFIKASI]
- **Member JSON tidak berisi nama/URL provider asli.** [FAKTA-TERVERIFIKASI]
