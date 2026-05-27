-- Agrega frecuencia de conteo programado a las áreas
-- 0 = sin programación, 7 = semanal, 14 = quincenal, 30 = mensual, 90 = trimestral
ALTER TABLE areas ADD COLUMN IF NOT EXISTS conteo_frecuencia_dias INTEGER NOT NULL DEFAULT 0;
