-- 0011_totp_recovery_codes.sql — recovery code 2FA sekali pakai (P2-17).
-- Plaintext TIDAK PERNAH disimpan: yang disimpan hash SHA-256
-- (code_hash CHAR(64)). Kode ditampilkan SEKALI di respons
-- POST /api/v1/auth/2fa/verify saat enable berhasil; login TOTP
-- menerima recovery code sebagai pengganti kode TOTP dan menandai
-- used_at saat dipakai (consumeRecoveryCode).
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id VARCHAR(36) PRIMARY KEY,
  member_id VARCHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trc_member (member_id),
  INDEX idx_trc_hash (code_hash),
  CONSTRAINT fk_trc_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
