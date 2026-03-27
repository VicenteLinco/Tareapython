-- Migración 018: Cambiar de Base64 a rutas de archivos para imágenes
-- Renombrar columnas para reflejar el cambio de propósito

ALTER TABLE configuracion RENAME COLUMN valor TO valor_texto; -- Para generalizar la tabla configuracion

-- Nota: No borraremos logo_base64 de inmediato por seguridad, 
-- pero añadiremos la capacidad de manejar rutas.
INSERT INTO configuracion (clave, valor_texto) VALUES ('logo_path', '') ON CONFLICT DO NOTHING;

-- En recepciones ya existía guia_despacho_archivo, aseguramos que se use para rutas.