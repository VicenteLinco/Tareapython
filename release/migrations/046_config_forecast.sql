-- 046_config_forecast.sql
-- Parámetros del nuevo algoritmo de predicción de compra (Periodic Review T,S).

INSERT INTO configuracion (clave, valor_texto)
VALUES ('nivel_servicio_z', '1.65')
ON CONFLICT (clave) DO NOTHING;
-- Z = 1.65 → cobertura del 95%. Otros valores típicos: 1.96 (97.5%), 2.33 (99%).

INSERT INTO configuracion (clave, valor_texto)
VALUES ('ventana_demanda_dias', '60')
ON CONFLICT (clave) DO NOTHING;
-- Días hacia atrás para construir la serie diaria de consumo.

INSERT INTO configuracion (clave, valor_texto)
VALUES ('dias_minimos_historia', '14')
ON CONFLICT (clave) DO NOTHING;
-- Si dias_con_consumo < umbral → confianza = baja, no se auto-sugiere cantidad.
