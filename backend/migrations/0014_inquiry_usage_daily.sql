-- 0014_inquiry_usage_daily.sql — pemakaian inquiry harian per member (v24).
-- Satu baris per member per tanggal WIB; used hanya naik setelah provider
-- menjawab (sukses atau hasil definitif) — error/timeout provider tidak
-- memotong hit. Tanggal dihitung di Go (Asia/Jakarta), bukan dari jam MySQL.
CREATE TABLE IF NOT EXISTS inquiry_usage_daily (
  member_id VARCHAR(36) NOT NULL,
  usage_date DATE NOT NULL,
  used INT NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, usage_date),
  CONSTRAINT fk_iud_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
