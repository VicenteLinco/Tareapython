-- Migración 015: Agregar nombre_plural a presentaciones
ALTER TABLE presentaciones ADD COLUMN nombre_plural VARCHAR(100) NOT NULL DEFAULT '';

-- Inicializar con el mismo valor que nombre (admin puede corregir desde catálogos)
UPDATE presentaciones SET nombre_plural = nombre WHERE nombre_plural = '';

-- Eliminar default para que inserciones futuras sin el campo fallen explícitamente
ALTER TABLE presentaciones ALTER COLUMN nombre_plural DROP DEFAULT;
