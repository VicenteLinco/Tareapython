-- Migration 054: Asegurar que configuracion.valor_texto sea TEXT.
-- Un logo en base64 supera los 500 caracteres facilmente; la columna no debe truncar.

ALTER TABLE configuracion
    ALTER COLUMN valor_texto TYPE TEXT;
