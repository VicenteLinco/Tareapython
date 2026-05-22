-- Migration 050: reconciliacion entre solicitudes de compra y recepciones.

ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN (
        'borrador',
        'guardada',
        'parcialmente_enviada',
        'enviada',
        'parcialmente_recibida',
        'completada',
        'cancelada'
    ));

CREATE TABLE IF NOT EXISTS recepcion_reconciliacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id UUID NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
    solicitud_id UUID NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id),
    estado TEXT NOT NULL,
    cantidad_solicitada DECIMAL(12,2) NOT NULL DEFAULT 0,
    cantidad_recibida DECIMAL(12,2) NOT NULL DEFAULT 0,
    diferencia DECIMAL(12,2) NOT NULL DEFAULT 0,
    unidad TEXT,
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT recepcion_reconciliacion_estado_check
        CHECK (estado IN ('ok', 'faltante', 'no_recibido', 'sobrante', 'extra'))
);

CREATE INDEX IF NOT EXISTS idx_rec_reconciliacion_recepcion
    ON recepcion_reconciliacion(recepcion_id);

CREATE INDEX IF NOT EXISTS idx_rec_reconciliacion_solicitud
    ON recepcion_reconciliacion(solicitud_id);

CREATE INDEX IF NOT EXISTS idx_rec_reconciliacion_estado
    ON recepcion_reconciliacion(estado);
