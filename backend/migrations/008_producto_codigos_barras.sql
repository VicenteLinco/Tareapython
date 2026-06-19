-- Alternative/learned barcodes per product (beyond the primary pres_codigo_barras)
CREATE TABLE producto_codigos_barras (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    codigo TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: same code cannot be active for two different products
CREATE UNIQUE INDEX producto_codigos_barras_codigo_uidx
    ON producto_codigos_barras(codigo) WHERE activo = TRUE;

CREATE INDEX producto_codigos_barras_producto_idx
    ON producto_codigos_barras(producto_id);
