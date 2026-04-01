-- Añadir columna de versión para Optimistic Locking en tablas de catálogo restantes
ALTER TABLE categorias ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE areas ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE unidades_basicas ADD COLUMN version INT NOT NULL DEFAULT 1;
