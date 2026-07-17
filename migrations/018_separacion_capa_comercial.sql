-- Migration: Separate commercial layer from presentation

CREATE TABLE ofertas_proveedor (
    id SERIAL PRIMARY KEY,
    presentacion_id INTEGER NOT NULL REFERENCES presentaciones(id) ON DELETE CASCADE,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    precio_adquisicion NUMERIC(15, 2),
    sku_proveedor VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(presentacion_id, proveedor_id)
);

-- Migrate existing data from presentaciones if needed
INSERT INTO ofertas_proveedor (presentacion_id, proveedor_id, precio_adquisicion)
SELECT id, proveedor_id, precio_adquisicion
FROM presentaciones
WHERE proveedor_id IS NOT NULL;

-- Remove the fields from presentaciones
ALTER TABLE presentaciones DROP COLUMN proveedor_id;
ALTER TABLE presentaciones DROP COLUMN precio_adquisicion;

CREATE OR REPLACE FUNCTION get_proveedor_id_from_presentacion(p_id INTEGER)
RETURNS INTEGER AS $$
    SELECT proveedor_id FROM ofertas_proveedor WHERE presentacion_id = p_id LIMIT 1;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_precio_from_presentacion(p_id INTEGER)
RETURNS NUMERIC AS $$
    SELECT precio_adquisicion FROM ofertas_proveedor WHERE presentacion_id = p_id LIMIT 1;
$$ LANGUAGE SQL STABLE;
