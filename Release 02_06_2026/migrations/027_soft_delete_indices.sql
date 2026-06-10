-- Migration 027: índices de soft delete para tablas sin ellos
-- No renombrar columnas (breaking change), solo agregar índices filtrados

CREATE INDEX IF NOT EXISTS idx_productos_activo
    ON productos(activo) WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_presentaciones_activa
    ON presentaciones(activa) WHERE activa = true;

CREATE INDEX IF NOT EXISTS idx_areas_activa
    ON areas(activa) WHERE activa = true;

CREATE INDEX IF NOT EXISTS idx_proveedores_activo
    ON proveedores(activo) WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_usuarios_activo
    ON usuarios(activo) WHERE activo = true;
