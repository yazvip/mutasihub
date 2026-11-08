-- 0005_must_change_password.sql — flag wajib ganti kata sandi setelah reset oleh admin.
-- Default 0; 1 = member wajib ganti kata sandi sebelum bisa memakai fitur member.
ALTER TABLE members ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
