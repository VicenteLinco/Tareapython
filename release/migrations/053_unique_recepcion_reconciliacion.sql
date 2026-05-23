-- Migration 053: Agregar constraint UNIQUE a recepcion_reconciliacion.
-- Sin este constraint, múltiples ejecuciones del proceso de reconciliación
-- pueden insertar filas duplicadas para la misma combinación.

-- Eliminar filas duplicadas conservando la más reciente de cada grupo
DELETE FROM recepcion_reconciliacion
WHERE id NOT IN (
    SELECT DISTINCT ON (recepcion_id, solicitud_id, producto_id) id
    FROM recepcion_reconciliacion
    ORDER BY recepcion_id, solicitud_id, producto_id, created_at DESC
);

ALTER TABLE recepcion_reconciliacion
    ADD CONSTRAINT uq_rec_reconciliacion
    UNIQUE (recepcion_id, solicitud_id, producto_id);
