-- 0007_mutation_dedup_key.sql — kunci dedup mutasi per rekening (P1-8).
-- Sebelumnya dedup_hash UNIQUE global: dua member dengan transaksi yang
-- sama persis saling membuang mutasi. Sekarang unik per linked_account.
-- Baris lama dibiarkan (hash lama tetap valid karena format hash baru
-- berbeda domain inputnya sehingga tidak bisa bentrok dengan yang lama).
ALTER TABLE mutations DROP INDEX dedup_hash;
ALTER TABLE mutations ADD UNIQUE KEY uq_mut_account_dedup (linked_account_id, dedup_hash);
