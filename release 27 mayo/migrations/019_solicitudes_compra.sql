-- ============================================================
-- Migración 019: Solicitudes de Compra
-- ============================================================

CREATE TABLE solicitudes_compra (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_documento VARCHAR(20) NOT NULL UNIQUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviada', 'completada', 'cancelada')),
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE solicitud_compra_detalle (
    id SERIAL PRIMARY KEY,
    solicitud_id UUID NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id),
    cantidad_sugerida DECIMAL(12,2) NOT NULL,
    unidad VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE seq_sol_numero START 1;

CREATE OR REPLACE FUNCTION generar_numero_sol() RETURNS TEXT AS $$
    SELECT 'SOL-' || LPAD(NEXTVAL('seq_sol_numero')::TEXT, 6, '0')
$$ LANGUAGE SQL;

ALTER TABLE solicitudes_compra ALTER COLUMN numero_documento SET DEFAULT generar_numero_sol();

CREATE INDEX idx_solicitudes_usuario ON solicitudes_compra(usuario_id);
CREATE INDEX idx_solicitud_detalle_solicitud ON solicitud_compra_detalle(solicitud_id);
