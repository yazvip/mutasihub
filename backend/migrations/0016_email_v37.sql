-- 0016_email_v37.sql — log pengiriman email + pengumuman admin (v37).
-- email_logs mencatat SEMUA pengiriman (transaksional, tagihan,
-- pengingat, pengumuman, tes): status sent/failed + error bila gagal.
-- Dipakai juga sebagai anti-duplikat pengingat (kind + ref_id yang
-- sudah 'sent' tidak dikirim ulang).
-- admin_announcements: pengumuman ("berita") yang ditulis admin dan
-- dikirim manual ke semua member aktif; status draft -> sent.
CREATE TABLE IF NOT EXISTS email_logs (
  id VARCHAR(36) PRIMARY KEY,
  member_id VARCHAR(36) NULL,
  kind VARCHAR(64) NOT NULL,
  ref_id VARCHAR(64) NULL,
  subject VARCHAR(255) NOT NULL,
  to_email VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_el_kind_ref (kind, ref_id),
  INDEX idx_el_member (member_id),
  INDEX idx_el_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_announcements (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_by VARCHAR(36) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL,
  INDEX idx_aa_status (status),
  INDEX idx_aa_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
