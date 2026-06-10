-- backend/migrations/031_precio_unidad.sql
-- ============================================================
-- Migración 031: Precio de referencia en productos
-- Permite tener un precio base para cálculos rápidos
-- y autocompletado en solicitudes.
-- ============================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_unidad DECIMAL(12,4);

COMMENT ON COLUMN productos.precio_unidad
    IS 'Precio de referencia neto por unidad base';
