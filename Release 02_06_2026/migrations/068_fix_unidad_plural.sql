-- Migración 068: Corregir plural de 'unidad' en unidades_basicas
UPDATE unidades_basicas
SET nombre_plural = 'unidades'
WHERE nombre = 'unidad' AND nombre_plural = 'unidads';
