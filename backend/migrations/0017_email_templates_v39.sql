-- 0017_email_templates_v39.sql — template email yang bisa dicustom admin (v39).
-- email_templates menyimpan subjek + isi HTML per jenis email; admin
-- mengeditnya dari /admin/email-templates. Isi di-seed dengan default
-- premium (sama dengan fallback di kode backend/internal/http/
-- email_templates.go); baris yang hilang/kosong selalu jatuh kembali
-- ke default kode, jadi email tidak pernah gagal hanya karena
-- template belum diisi.
-- key = nilai `kind` yang dipakai sendMail (email_verification,
-- password_reset, order_pending, order_paid, expiry_reminder_h3,
-- expiry_reminder_h1, subscription_expired).
CREATE TABLE IF NOT EXISTS email_templates (
  `key` VARCHAR(64) PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO email_templates (`key`, subject, body_html) VALUES
('email_verification', 'Verifikasi email Anda — MutasiHub', '<p>Halo, {{nama}},</p><p>Terima kasih sudah mendaftar di MutasiHub — platform cek mutasi rekening dan rekening bank secara realtime.</p><p>Untuk mengaktifkan akun Anda, silakan verifikasi alamat email ini dengan menekan tombol di bawah. Tautan verifikasi berlaku 24 jam.</p><p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verifikasi Email</a></p><p style="font-size:13px;color:#64748b">Bila tombol di atas tidak berfungsi, salin tautan berikut ke peramban Anda:<br>{{tautan}}</p><p>Bila Anda tidak merasa mendaftar di MutasiHub, abaikan email ini — tidak ada tindakan yang perlu dilakukan.</p><p>Salam,<br>Tim MutasiHub</p>'),
('password_reset', 'Reset password MutasiHub', '<p>Halo, {{nama}},</p><p>Kami menerima permintaan untuk mereset password akun MutasiHub Anda. Tekan tombol di bawah ini untuk membuat password baru. Tautan ini berlaku 1 jam.</p><p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Reset Password</a></p><p style="font-size:13px;color:#64748b">Bila tombol di atas tidak berfungsi, salin tautan berikut ke peramban Anda:<br>{{tautan}}</p><p>Bila Anda tidak meminta reset password, abaikan email ini — password Anda tetap aman dan tidak berubah.</p><p>Salam,<br>Tim MutasiHub</p>'),
('order_pending', 'Tagihan paket {{paket}} — menunggu pembayaran', '<p>Halo, {{nama}},</p><p>Tagihan langganan MutasiHub Anda sudah dibuat. Berikut rinciannya:</p><p><strong>Paket:</strong> {{paket}}<br><strong>Jumlah:</strong> {{jumlah}}<br><strong>ID order:</strong> {{order_id}}</p><p>Tagihan ini berlaku 24 jam. Segera selesaikan pembayaran agar paket langsung aktif dan layanan tidak tertunda.</p><p><a href="{{tautan}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Lihat Tagihan &amp; Bayar</a></p><p>Salam,<br>Tim MutasiHub</p>'),
('order_paid', 'Pembayaran berhasil — paket {{paket}} aktif', '<p>Halo, {{nama}},</p><p>Pembayaran Anda sudah kami terima. Paket <strong>{{paket}}</strong> kini aktif sampai <strong>{{berlaku_sampai}}</strong>.</p><p>Seluruh layanan MutasiHub — sinkronisasi mutasi dan cek rekening — sudah dapat Anda gunakan.</p><p>Terima kasih sudah berlangganan MutasiHub.</p><p>Salam,<br>Tim MutasiHub</p>'),
('expiry_reminder_h3', 'Paket {{paket}} berakhir 3 hari lagi — MutasiHub', '<p>Halo, {{nama}},</p><p>Paket <strong>{{paket}}</strong> Anda berakhir pada <strong>{{berlaku_sampai}}</strong> ({{sisa_hari}} hari lagi).</p><p>Perpanjang langganan sekarang agar sinkronisasi mutasi dan cek rekening tetap berjalan tanpa terputus.</p><p>Salam,<br>Tim MutasiHub</p>'),
('expiry_reminder_h1', 'Paket {{paket}} berakhir besok — MutasiHub', '<p>Halo, {{nama}},</p><p>Paket <strong>{{paket}}</strong> Anda berakhir <strong>besok, {{berlaku_sampai}}</strong>.</p><p>Perpanjang sekarang agar layanan tidak terputus.</p><p>Salam,<br>Tim MutasiHub</p>'),
('subscription_expired', 'Paket {{paket}} telah berakhir — MutasiHub', '<p>Halo, {{nama}},</p><p>Paket <strong>{{paket}}</strong> Anda telah berakhir pada <strong>{{berlaku_sampai}}</strong>.</p><p>Perpanjang langganan Anda agar sinkronisasi mutasi dan cek rekening kembali berjalan.</p><p>Salam,<br>Tim MutasiHub</p>');
