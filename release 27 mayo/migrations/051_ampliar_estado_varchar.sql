-- Migration 051: Ampliar columna estado de VARCHAR(20) a TEXT en tablas de solicitudes.
-- "parcialmente_recibida" tiene 22 caracteres y excede el límite anterior de VARCHAR(20).

ALTER TABLE solicitudes_compra
    ALTER COLUMN estado TYPE TEXT;
