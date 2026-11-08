-- 0002_seed.sql — default plans + brand settings (admin-editable later).
-- Prices are in cents (Rp x 100): 350000 Rp = 35000000 cents.

INSERT IGNORE INTO plans (slug, name, price_cents, duration_days, max_accounts, api_delay_minutes, notif_interval_minutes, max_devices, callback_enabled, is_active) VALUES
  ('trial', 'Trial', 0, 1, 2, 10, 5, 1, 0, 1),
  ('starter', 'Starter', 35000000, 30, 2, 5, 3, 3, 0, 1),
  ('pro', 'Pro', 90000000, 30, 5, 3, 2, 5, 0, 1),
  ('enterprise', 'Enterprise', 180000000, 30, 5, 0, 1, 8, 1, 1);

INSERT IGNORE INTO settings (setting_key, value) VALUES
  ('site_name', 'MutasiHub'),
  ('tagline', 'Cek Mutasi DANA & BCA Realtime untuk Bisnis Modern'),
  ('logo_url', ''),
  ('accent_color', '#0B6B4F'),
  ('gobiz_enabled', '1');
