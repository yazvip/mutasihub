-- 0009_members_callback_secret.sql — secret HMAC callback per member (P2-8).
-- Secret dipakai menandatangani callback mutasi (header
-- X-MutasiHub-Signature = "sha256=" + hex(HMAC-SHA256(secret, body))).
-- Di-generate saat callback pertama diaktifkan/dikirim (sync:
-- ensureCallbackSecret) dan bisa dibaca member sendiri lewat
-- GET /api/v1/member/profile (callback_secret). NULL = belum pernah
-- ada callback terkirim.
ALTER TABLE members ADD COLUMN callback_secret VARCHAR(128) NULL;
