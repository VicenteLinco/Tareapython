-- Inicializa la opción de conteo ciego como desactivada por defecto
INSERT INTO configuracion (clave, valor_texto) 
VALUES ('conteo_ciego', 'false') 
ON CONFLICT (clave) DO NOTHING;
