-- backend/migrations/058_producto_proveedor.sql
-- Catálogo multi-proveedor por producto. Reemplaza la relación 1:1
-- de productos.proveedor_id por una relación N:M con datos adicionales.

CREATE TABLE producto_proveedor (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    proveedor_id INT NOT NULL REFERENCES proveedores(id),
    es_principal BOOLEAN NOT NULL DEFAULT FALSE,
    codigo_proveedor VARCHAR(100),
    precio_unidad DECIMAL(12,4),
    lead_time_dias INT,
    unidad_minima_pedido DECIMAL(12,2),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_producto_proveedor UNIQUE (producto_id, proveedor_id)
);

CREATE UNIQUE INDEX idx_pp_principal
    ON producto_proveedor(producto_id)
    WHERE es_principal = TRUE;

CREATE INDEX idx_pp_producto ON producto_proveedor(producto_id);
CREATE INDEX idx_pp_proveedor ON producto_proveedor(proveedor_id);

-- Migrar datos existentes de productos
INSERT INTO producto_proveedor
    (producto_id, proveedor_id, es_principal, codigo_proveedor, precio_unidad, lead_time_dias)
SELECT
    id,
    proveedor_id,
    TRUE,
    codigo_proveedor,
    precio_unidad,
    lead_time_propio
FROM productos
WHERE proveedor_id IS NOT NULL;
