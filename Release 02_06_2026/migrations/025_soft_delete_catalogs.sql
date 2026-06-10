-- Migración 025: Soft Delete Universal para Catálogos
-- Añade columna 'activo' a categorias y unidades_basicas

ALTER TABLE categorias ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE unidades_basicas ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;

-- Crear índices para mejorar el rendimiento de los listados filtrados
CREATE INDEX idx_categorias_activo ON categorias(activo) WHERE activo = true;
CREATE INDEX idx_unidades_basicas_activo ON unidades_basicas(activo) WHERE activo = true;
