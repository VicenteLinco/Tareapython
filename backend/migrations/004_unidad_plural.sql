-- ============================================================
-- Migración 004: Agregar nombre_plural a unidades_medida
-- ============================================================
ALTER TABLE unidades_medida ADD COLUMN nombre_plural VARCHAR(50) NOT NULL DEFAULT '';

-- Poblar con valores iniciales (plural simple agregando 's')
UPDATE unidades_medida SET nombre_plural = nombre || 's';

ALTER TABLE unidades_medida ALTER COLUMN nombre_plural DROP DEFAULT;
