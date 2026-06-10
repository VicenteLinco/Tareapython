-- Migración 039: renombrar columna activo → activa en proveedores
-- para alinear con el modelo Rust y las queries del servicio

ALTER TABLE proveedores RENAME COLUMN activo TO activa;

-- Recrear índice con el nuevo nombre de columna
DROP INDEX IF EXISTS idx_proveedores_activo;
CREATE INDEX idx_proveedores_activa ON proveedores(activa) WHERE activa = true;
