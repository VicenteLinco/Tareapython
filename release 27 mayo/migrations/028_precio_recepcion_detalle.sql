-- ============================================================
-- Migración 028: Precio unitario en detalle de recepción
-- Permite rastrear el último precio pagado por producto
-- para auto-completar solicitudes de compra.
-- ============================================================

ALTER TABLE recepcion_detalle
    ADD COLUMN precio_unitario DECIMAL(14,2);

COMMENT ON COLUMN recepcion_detalle.precio_unitario
    IS 'Precio neto pagado por unidad (de presentación o base) en esta recepción';
