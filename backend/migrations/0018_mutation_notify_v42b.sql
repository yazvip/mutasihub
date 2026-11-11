-- 0018_mutation_notify_v42b.sql — notifikasi mutasi email per interval paket (v42b).
-- Kolom preferensi member (default ON, kanal email) + watermark pengiriman
-- per member + seed template digest (ringkasan: jumlah + total masuk/keluar
-- + tautan dashboard — bukan rincian per transaksi, lihat Q4 plan v42).
-- Watermark = mutations.id (auto-increment, tiap baris unik berkat dedup).
-- sent_day memakai CURDATE() server agar hitungan harian (cap 200/hari)
-- reset saat hari berganti, konsisten antara baca dan tulis.
ALTER TABLE members ADD COLUMN notif_enabled TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE members ADD COLUMN notif_channel VARCHAR(16) NOT NULL DEFAULT 'email';
CREATE TABLE IF NOT EXISTS mutation_notify_state (
  member_id VARCHAR(36) PRIMARY KEY,
  last_notified_at TIMESTAMP NULL,
  last_mutation_id BIGINT UNSIGNED NULL,
  sent_today INT NOT NULL DEFAULT 0,
  sent_day DATE NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mns_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO email_templates (`key`, subject, body_html) VALUES
('mutation_digest', 'Ada {{jumlah}} mutasi baru — MutasiHub', '<p>Halo, {{nama}},</p><p>Ada {{jumlah}} mutasi baru di rekening Anda sejak pemberitahuan terakhir.</p><p><strong>Total masuk:</strong> {{masuk}}<br><strong>Total keluar:</strong> {{keluar}}</p><p>Lihat rincian lengkapnya di dashboard MutasiHub.</p><p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Lihat di Dashboard</a></p><p>Salam,<br>Tim MutasiHub</p>');
