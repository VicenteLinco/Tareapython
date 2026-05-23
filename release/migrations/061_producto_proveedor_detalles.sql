ALTER TABLE producto_proveedor
    ADD COLUMN codigo_maestro VARCHAR(100),
    ADD COLUMN presentacion_id INT REFERENCES presentaciones(id),
    ADD COLUMN imagen_url TEXT;

UPDATE producto_proveedor pp
SET
    codigo_maestro = p.codigo_maestro,
    imagen_url = p.imagen_url
FROM productos p
WHERE p.id = pp.producto_id
  AND pp.es_principal = TRUE;
