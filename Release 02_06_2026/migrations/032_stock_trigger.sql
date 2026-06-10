-- Migración 032: Trigger para actualización automática de stock (V2: BEFORE INSERT)
-- Objetivo: Manejar la integridad del stock y calcular cantidad_resultante automáticamente.

-- 1. Función que actualiza el stock y llena cantidad_resultante
CREATE OR REPLACE FUNCTION fn_procesar_movimiento_stock()
RETURNS TRIGGER AS $$
DECLARE
    v_signo DECIMAL := 1;
    v_stock_actual DECIMAL := 0;
BEGIN
    -- 1. Determinar el signo según el tipo de movimiento
    IF NEW.tipo IN ('CONSUMO', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SALIDA', 'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO') THEN
        v_signo := -1;
    END IF;

    -- 2. Obtener el stock actual del lote en el área (bloqueando la fila para evitar race conditions)
    -- Si no existe, se asume 0.
    SELECT cantidad INTO v_stock_actual
    FROM stock
    WHERE lote_id = NEW.lote_id AND area_id = NEW.area_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_stock_actual := 0;
    END IF;

    -- 3. Calcular la cantidad resultante
    NEW.cantidad_resultante := v_stock_actual + (NEW.cantidad * v_signo);

    -- 4. Validar que el stock no sea negativo (regla de negocio crítica)
    IF NEW.cantidad_resultante < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para el lote % en el área %. Actual: %, Requerido: %', 
            NEW.lote_id, NEW.area_id, v_stock_actual, NEW.cantidad;
    END IF;

    -- 5. Actualizar o Insertar en la tabla stock
    INSERT INTO stock (lote_id, area_id, cantidad, updated_at)
    VALUES (NEW.lote_id, NEW.area_id, NEW.cantidad_resultante, NOW())
    ON CONFLICT (lote_id, area_id) 
    DO UPDATE SET 
        cantidad = EXCLUDED.cantidad,
        updated_at = EXCLUDED.updated_at;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger sobre la tabla movimientos
DROP TRIGGER IF EXISTS trg_actualizar_stock ON movimientos;
CREATE TRIGGER trg_actualizar_stock
BEFORE INSERT ON movimientos
FOR EACH ROW
EXECUTE FUNCTION fn_procesar_movimiento_stock();

-- 3. Sincronización Inicial (Repair)
TRUNCATE TABLE stock;

INSERT INTO stock (lote_id, area_id, cantidad, updated_at)
SELECT 
    lote_id, 
    area_id, 
    SUM(CASE 
        WHEN tipo IN ('CONSUMO', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SALIDA', 'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO') 
        THEN -cantidad 
        ELSE cantidad 
    END) as saldo,
    MAX(created_at)
FROM movimientos
GROUP BY lote_id, area_id;

DELETE FROM stock WHERE cantidad = 0;
