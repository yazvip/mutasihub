-- 0003_plan_inquiry.sql — toggle inquiry rekening per paket.
-- Default: OFF (Trial tetap tanpa inquiry — mencegah probing gratis),
-- ON untuk paket berbayar yang sudah ada; admin bisa ubah per paket.
ALTER TABLE plans ADD COLUMN inquiry_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER callback_enabled;
UPDATE plans SET inquiry_enabled=1 WHERE slug IN ('starter', 'pro', 'enterprise');
