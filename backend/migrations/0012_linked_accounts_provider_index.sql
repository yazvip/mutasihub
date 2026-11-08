-- 0012_linked_accounts_provider_index.sql — index provider (P2-16).
-- Dibutuhkan agar SELECT ... FOR UPDATE pada linked_accounts
-- WHERE provider='BCA' mengambil range lock di index (menahan insert
-- BCA bersamaan) saat create account mengecek ulang slot BCA di dalam
-- transaksi. Tanpa index ini, lock pada empty set tidak menahan
-- phantom insert.
ALTER TABLE linked_accounts ADD INDEX idx_la_provider (provider);
