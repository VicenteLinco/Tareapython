-- Migración 048: Reintroducir estados de cierre para solicitudes_compra
-- Flujo: borrador → guardada → enviada → completada
--                                       ↘ cancelada (desde guardada o enviada)

ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN ('borrador', 'guardada', 'enviada', 'completada', 'cancelada'));

ALTER TABLE solicitudes_compra
    ADD COLUMN IF NOT EXISTS fecha_envio TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS motivo_cierre TEXT,
    ADD COLUMN IF NOT EXISTS metodo_envio TEXT;

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes_compra(estado);
