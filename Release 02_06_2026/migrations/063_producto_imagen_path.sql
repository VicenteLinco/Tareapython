ALTER TABLE productos RENAME COLUMN imagen_url TO imagen_path;

UPDATE productos
SET imagen_path = NULL
WHERE imagen_path LIKE 'data:%';
