-- Migration 056: Agregar deleted_at a todas las tablas con soft-delete.
-- Permite saber cuándo fue desactivado un registro, no solo si está activo.
-- La columna se rellena retroactivamente con NOW() para registros ya inactivos.

ALTER TABLE categorias
    ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE unidades_basicas
    ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE areas
    ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE productos
    ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE presentaciones
    ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE proveedores
    ADD COLUMN deleted_at TIMESTAMPTZ;

-- Rellenar deleted_at para registros ya desactivados
UPDATE categorias      SET deleted_at = NOW() WHERE activo  = FALSE;
UPDATE unidades_basicas SET deleted_at = NOW() WHERE activo  = FALSE;
UPDATE areas           SET deleted_at = NOW() WHERE activa  = FALSE;
UPDATE productos       SET deleted_at = NOW() WHERE activo  = FALSE;
UPDATE presentaciones  SET deleted_at = NOW() WHERE activa  = FALSE;
UPDATE proveedores     SET deleted_at = NOW() WHERE activa  = FALSE;

-- Índices parciales para listar desactivados por período
CREATE INDEX idx_categorias_deleted    ON categorias(deleted_at)      WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_unidades_deleted      ON unidades_basicas(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_areas_deleted         ON areas(deleted_at)            WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_productos_deleted     ON productos(deleted_at)        WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_presentaciones_deleted ON presentaciones(deleted_at)  WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_proveedores_deleted   ON proveedores(deleted_at)      WHERE deleted_at IS NOT NULL;
