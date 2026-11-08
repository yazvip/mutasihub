-- 0004_member_status.sql — status akun member untuk nonaktifkan/aktifkan oleh admin.
-- Default 'active'; 'disabled' menolak login (email + Google), sesi member,
-- dan API key. Admin panel: detail + edit member (v19).
ALTER TABLE members ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active';
