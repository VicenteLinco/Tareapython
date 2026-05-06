-- Factor usado para estimar demanda de planificacion cuando hay historial corto.
-- 0.35 significa usar 35% del ritmo observado desde el primer consumo reciente.
INSERT INTO configuracion (clave, valor_texto)
VALUES ('factor_historial_corto', '0.35')
ON CONFLICT (clave) DO NOTHING;
