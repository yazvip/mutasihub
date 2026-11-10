-- 0015_linked_accounts_authorized_at.sql — tanggal otorisasi pertama per rekening (v34).
-- Diisi saat status pertama kali jadi 'active': webhook binding DANA,
-- create BCA (langsung aktif, tanpa OAuth lanjutan), atau self-heal sync
-- (DANA via danaBound, BCA via sync yang berhasil). COALESCE menjaga
-- tanggal pertama bila otorisasi diulang.
-- TIDAK di-backfill dari updated_at (ikut berubah tiap update baris lain,
-- mis. sync saldo) — rekening aktif lama sebelum v34 tetap NULL dan
-- tanggal otorisasinya tidak ditampilkan di UI.
ALTER TABLE linked_accounts ADD COLUMN authorized_at TIMESTAMP NULL AFTER updated_at;
