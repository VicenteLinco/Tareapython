-- Añadir columna de versión para Optimistic Locking en Usuarios
ALTER TABLE usuarios ADD COLUMN version INT NOT NULL DEFAULT 1;
