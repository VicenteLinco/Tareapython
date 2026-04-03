-- ============================================================
-- Migración 029: Precio y presentación en detalle de solicitud
-- ============================================================

ALTER TABLE solicitud_compra_detalle
    ADD COLUMN precio_unitario        DECIMAL(14,2),
    ADD COLUMN presentacion_id        INTEGER REFERENCES presentaciones(id),
    ADD COLUMN cantidad_presentaciones DECIMAL(12,2);

COMMENT ON COLUMN solicitud_compra_detalle.precio_unitario
    IS 'Precio neto por unidad de presentación (o base si no hay presentación)';
COMMENT ON COLUMN solicitud_compra_detalle.presentacion_id
    IS 'Presentación usada para expresar la cantidad. NULL = se pide en unidad base';
COMMENT ON COLUMN solicitud_compra_detalle.cantidad_presentaciones
    IS 'Cantidad en unidades de presentación. NULL si no hay presentación definida';
