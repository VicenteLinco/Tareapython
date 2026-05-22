-- Migration 049: envio granular por proveedor en solicitudes de compra.

CREATE TABLE IF NOT EXISTS solicitud_envios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitud_id UUID NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    estado TEXT NOT NULL DEFAULT 'pendiente',
    metodo_envio TEXT,
    fecha_envio TIMESTAMPTZ,
    usuario_envio_id UUID REFERENCES usuarios(id),
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT solicitud_envios_estado_check
        CHECK (estado IN ('pendiente', 'enviado', 'cancelado')),
    CONSTRAINT solicitud_envios_metodo_check
        CHECK (metodo_envio IS NULL OR metodo_envio IN ('email','telefono','whatsapp','presencial','otro')),
    CONSTRAINT solicitud_envios_fecha_consistente
        CHECK (
            (estado = 'enviado' AND fecha_envio IS NOT NULL AND metodo_envio IS NOT NULL)
            OR estado <> 'enviado'
        ),
    CONSTRAINT solicitud_envios_unique UNIQUE (solicitud_id, proveedor_id)
);

CREATE INDEX IF NOT EXISTS idx_solicitud_envios_solicitud ON solicitud_envios(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_envios_proveedor ON solicitud_envios(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_envios_estado ON solicitud_envios(estado);

CREATE OR REPLACE FUNCTION trg_solicitud_envios_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solicitud_envios_updated ON solicitud_envios;
CREATE TRIGGER solicitud_envios_updated
BEFORE UPDATE ON solicitud_envios
FOR EACH ROW EXECUTE FUNCTION trg_solicitud_envios_updated();

ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN ('borrador', 'guardada', 'parcialmente_enviada', 'enviada', 'completada', 'cancelada'));

INSERT INTO solicitud_envios (solicitud_id, proveedor_id, estado, metodo_envio, fecha_envio, usuario_envio_id)
SELECT DISTINCT
    s.id,
    p.proveedor_id,
    CASE WHEN s.estado IN ('enviada','completada') THEN 'enviado' ELSE 'pendiente' END,
    CASE WHEN s.estado IN ('enviada','completada') THEN COALESCE(s.metodo_envio, 'otro') ELSE NULL END,
    CASE WHEN s.estado IN ('enviada','completada') THEN COALESCE(s.fecha_envio, s.created_at) ELSE NULL END,
    CASE WHEN s.estado IN ('enviada','completada') THEN s.usuario_id ELSE NULL END
FROM solicitudes_compra s
JOIN solicitud_compra_detalle d ON d.solicitud_id = s.id
JOIN productos p ON p.id = d.producto_id
WHERE s.estado <> 'borrador'
  AND p.proveedor_id IS NOT NULL
ON CONFLICT (solicitud_id, proveedor_id) DO NOTHING;
