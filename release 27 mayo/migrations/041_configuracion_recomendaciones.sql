-- Agregar claves de configuración para el algoritmo de recomendaciones de compra
INSERT INTO configuracion (clave, valor_texto)
VALUES ('ventana_consumo_dias', '30')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion (clave, valor_texto)
VALUES ('periodo_revision_dias', '30')
ON CONFLICT (clave) DO NOTHING;
