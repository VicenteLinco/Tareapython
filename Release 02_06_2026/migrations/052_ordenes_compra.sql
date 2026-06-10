-- ============================================================
-- Migración 028: Órdenes de Compra
-- ============================================================

-- 1. Secuencia y función para número de OC
CREATE SEQUENCE seq_oc_numero START 1;

CREATE OR REPLACE FUNCTION generar_numero_oc() RETURNS TEXT AS $$
    SELECT 'OC-' || LPAD(NEXTVAL('seq_oc_numero')::TEXT, 6, '0')
$$ LANGUAGE SQL;

-- 2. Tabla cabecera de orden de compra
CREATE TABLE ordenes_compra (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_documento VARCHAR(20) NOT NULL UNIQUE DEFAULT generar_numero_oc(),
    solicitud_id UUID REFERENCES solicitudes_compra(id) ON DELETE RESTRICT,
    proveedor_id INT NOT NULL REFERENCES proveedores(id),
    estado VARCHAR(30) NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador', 'enviada', 'recibida_parcial', 'recibida_total', 'cancelada')),
    fecha_emision TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_entrega_esperada DATE,
    nota TEXT,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabla detalle de orden de compra
CREATE TABLE orden_compra_detalle (
    id SERIAL PRIMARY KEY,
    orden_compra_id UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id),
    presentacion_id INT REFERENCES presentaciones(id),
    cantidad_solicitada DECIMAL(12,2) NOT NULL CHECK (cantidad_solicitada > 0),
    cantidad_recibida DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad_solicitada),
    precio_unitario DECIMAL(12,4),
    unidad VARCHAR(50) NOT NULL,
    area_destino_id INT REFERENCES areas(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Vincular recepciones a OC (nullable = compatibilidad hacia atrás)
ALTER TABLE recepciones
    ADD COLUMN orden_compra_id UUID REFERENCES ordenes_compra(id);

-- 5. Vincular recepcion_detalle a ítem de OC (nullable = compatibilidad hacia atrás)
ALTER TABLE recepcion_detalle
    ADD COLUMN orden_compra_detalle_id INT REFERENCES orden_compra_detalle(id);

-- 6. Índices
CREATE INDEX idx_oc_solicitud ON ordenes_compra(solicitud_id);
CREATE INDEX idx_oc_proveedor ON ordenes_compra(proveedor_id);
CREATE INDEX idx_oc_estado ON ordenes_compra(estado);
CREATE INDEX idx_ocd_oc ON orden_compra_detalle(orden_compra_id);
CREATE INDEX idx_ocd_producto ON orden_compra_detalle(producto_id);
CREATE INDEX idx_recepciones_oc ON recepciones(orden_compra_id);
CREATE INDEX idx_recepcion_detalle_ocd ON recepcion_detalle(orden_compra_detalle_id);

COMMENT ON COLUMN recepciones.orden_compra_id IS 'OC que originó esta recepción (nullable para compatibilidad)';
COMMENT ON COLUMN recepcion_detalle.orden_compra_detalle_id IS 'Ítem de OC asociado a este detalle de recepción';
