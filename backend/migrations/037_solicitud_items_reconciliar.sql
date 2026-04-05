-- migration 037: solicitud_items table for reconciliation
-- Each solicitud_compra row is tracked as an "item" for reconciliation with recepciones.
-- Also extends estado to include en_camino.

-- Extend estado check on solicitudes_compra
ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN ('borrador', 'pendiente', 'enviada', 'en_camino', 'completada', 'cancelada', 'recibido'));

-- Add recepcion_id tracking to solicitudes_compra
ALTER TABLE solicitudes_compra
    ADD COLUMN IF NOT EXISTS recepcion_id UUID REFERENCES recepciones(id);

-- solicitud_items: alias table for reconciliation
-- Uses solicitudes_compra.id as the item ID (one item per solicitud)
CREATE TABLE IF NOT EXISTS solicitud_items (
    id UUID PRIMARY KEY REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'en_camino',
    recepcion_id UUID REFERENCES recepciones(id)
);

CREATE INDEX IF NOT EXISTS idx_solicitud_items_estado ON solicitud_items(estado);
