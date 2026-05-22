-- Migration 054: Ampliar configuracion_sistema.valor de VARCHAR(500) a TEXT.
-- Un logo en base64 supera los 500 caracteres fácilmente; la columna truncaba silenciosamente.

ALTER TABLE configuracion_sistema
    ALTER COLUMN valor TYPE TEXT;
