-- Migración 044: Agregar campo lead_time_propio a productos
-- El modelo Rust y el código de handlers ya usaban este campo
-- pero faltaba la columna en la base de datos.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS lead_time_propio INTEGER;

COMMENT ON COLUMN productos.lead_time_propio
    IS 'Tiempo de reposición propio del producto en días (sobreescribe el del proveedor si está definido)';
