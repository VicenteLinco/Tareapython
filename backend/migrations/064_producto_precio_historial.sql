CREATE TABLE producto_precio_historial (
    id BIGSERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    proveedor_id INT REFERENCES proveedores(id),
    precio_unidad DECIMAL(12,4) NOT NULL,
    presentacion_id INT REFERENCES presentaciones(id),
    precio_presentacion DECIMAL(12,4),
    vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario_id UUID REFERENCES usuarios(id),
    nota TEXT,
    fuente VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (fuente IN ('manual','recepcion','solicitud')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_precio_hist_producto
    ON producto_precio_historial(producto_id, vigente_desde DESC, created_at DESC);

CREATE INDEX idx_precio_hist_proveedor
    ON producto_precio_historial(proveedor_id, vigente_desde DESC)
    WHERE proveedor_id IS NOT NULL;
