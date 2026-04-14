-- Migración 042: Eliminar tabla solicitud_items y columna recepcion_id
-- Estos fueron agregados en migration 037 para un workflow de reconciliación
-- que fue descartado en el rediseño.

DROP TABLE IF EXISTS solicitud_items;

ALTER TABLE solicitudes_compra
    DROP COLUMN IF EXISTS recepcion_id;
