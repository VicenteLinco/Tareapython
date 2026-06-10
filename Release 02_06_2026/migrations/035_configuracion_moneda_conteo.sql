-- backend/migrations/035_configuracion_moneda_conteo.sql
INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_codigo', 'CLP')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_simbolo', '$')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion (clave, valor_texto) VALUES ('conteo_periodo_dias', '30')
ON CONFLICT (clave) DO NOTHING;
