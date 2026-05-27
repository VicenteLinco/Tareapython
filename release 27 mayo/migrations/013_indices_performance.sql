-- Performance indexes for high-frequency queries
-- Nota: no usar CONCURRENTLY (no es compatible con transacciones de SQLx)

-- FK de alta frecuencia en recepcion_detalle
CREATE INDEX IF NOT EXISTS idx_recepcion_detalle_recepcion_id
    ON recepcion_detalle(recepcion_id);

-- Stock por área (queries de stock_por_area y alertas)
CREATE INDEX IF NOT EXISTS idx_stock_area_cantidad
    ON stock(area_id, cantidad) WHERE cantidad > 0;

-- Movimientos por fecha (historial paginado)
CREATE INDEX IF NOT EXISTS idx_movimientos_created_at
    ON movimientos(created_at DESC);

-- Lotes por vencimiento (alertas)
CREATE INDEX IF NOT EXISTS idx_lotes_fecha_vencimiento
    ON lotes(fecha_vencimiento) WHERE fecha_vencimiento IS NOT NULL;

-- Audit log por tabla+registro (búsqueda de auditoría)
CREATE INDEX IF NOT EXISTS idx_audit_log_tabla_registro
    ON audit_log(tabla, registro_id);
