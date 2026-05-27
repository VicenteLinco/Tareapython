-- Migración 040: Simplificar estados de solicitudes_compra a borrador | guardada
-- Elimina workflow de aprobación — el sistema solo guarda registros históricos.

-- 1. Eliminar constraint existente primero para permitir el UPDATE
ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

-- 2. Normalizar registros existentes
UPDATE solicitudes_compra
SET estado = 'guardada'
WHERE estado NOT IN ('borrador', 'guardada');

-- 3. Agregar el nuevo constraint simplificado
ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN ('borrador', 'guardada'));

-- 3. Limpiar columnas de revisión que ya no tienen sentido
ALTER TABLE solicitudes_compra
    DROP COLUMN IF EXISTS nota_revision,
    DROP COLUMN IF EXISTS fecha_revision,
    DROP COLUMN IF EXISTS revisado_por;
