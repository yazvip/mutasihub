-- 0006_session_version.sql — revokasi sesi (P1-2).
-- session_version dimasukkan ke klaim JWT dan dicek saat auth; dinaikkan
-- saat logout, ganti kata sandi, dan reset sandi admin sehingga semua sesi
-- lama anggota itu mati. Berlaku untuk members dan admin_users.
ALTER TABLE members ADD COLUMN session_version INT NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN session_version INT NOT NULL DEFAULT 0;
