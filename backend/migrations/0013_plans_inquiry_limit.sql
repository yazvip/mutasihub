-- 0013_plans_inquiry_limit.sql — batas hit inquiry rekening per hari per paket (v24).
-- NULL = tanpa batas; 0 = tidak ada hit diizinkan; N>0 = maks N hit/hari (tanggal WIB).
-- Seed tidak diubah: Trial inquiry_enabled=0; Starter/Pro/Enterprise
-- inquiry_enabled=1 dengan inquiry_limit NULL (tanpa batas, seperti sebelumnya).
ALTER TABLE plans ADD COLUMN inquiry_limit INT NULL AFTER inquiry_enabled;
