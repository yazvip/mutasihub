-- 0008_gobiz_order_expiry.sql — order Gobiz pending diberi masa berlaku (P1-5).
-- Order pending lama yang tidak pernah dibayar harus kedaluwarsa, bukan
-- menggantung selamanya. Nilai diisi backend saat order dibuat (+24 jam).
ALTER TABLE gobiz_orders ADD COLUMN expires_at TIMESTAMP NULL;
