-- 2026-09-27: Preserve inventory for products that were already managed before
-- the per-product opt-in flag existed. New products keep the schema default OFF.
UPDATE `menu`
SET `inventory_enabled` = 1
WHERE `stock_quantity` > 0;
