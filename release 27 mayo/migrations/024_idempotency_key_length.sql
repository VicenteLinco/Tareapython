-- ============================================================
-- Migración 024: Aumentar longitud de clave de idempotencia
-- ============================================================

ALTER TABLE idempotency_keys ALTER COLUMN key TYPE VARCHAR(256);
