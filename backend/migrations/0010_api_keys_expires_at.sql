-- 0010_api_keys_expires_at.sql — tanggal kedaluwarsa opsional API key (P2-22).
-- NULL = tidak pernah kedaluwarsa (perilaku lama). Key kedaluwarsa
-- ditolak middleware dengan 401 api_key_expired.
ALTER TABLE api_keys ADD COLUMN expires_at TIMESTAMP NULL;
