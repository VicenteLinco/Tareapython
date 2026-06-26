-- Migración 011: Actualización del trigger de stock para soportar stock_snapshot (CQRS)

CREATE OR REPLACE FUNCTION public.fn_procesar_movimiento_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_signo DECIMAL := 1;
    v_stock_actual DECIMAL := 0;
    v_producto_id uuid;
BEGIN
    -- Bloquear el lote en la tabla public.lotes para serializar inserciones/actualizaciones concurrentes de stock
    SELECT producto_id INTO v_producto_id FROM public.lotes WHERE id = NEW.lote_id FOR UPDATE;

    -- Determinar el signo según el tipo de movimiento
    IF NEW.tipo IN ('CONSUMO', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SALIDA', 'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO') THEN
        v_signo := -1;
    END IF;

    -- Obtener el stock actual del lote en el área (bloqueando la fila del stock)
    SELECT cantidad INTO v_stock_actual
    FROM public.stock
    WHERE lote_id = NEW.lote_id AND area_id = NEW.area_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_stock_actual := 0;
    END IF;

    -- Calcular la cantidad resultante
    NEW.cantidad_resultante := v_stock_actual + (NEW.cantidad * v_signo);

    -- Validar que el stock no sea negativo
    IF NEW.cantidad_resultante < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para el lote % en el área %. Actual: %, Requerido: %', 
            NEW.lote_id, NEW.area_id, v_stock_actual, NEW.cantidad;
    END IF;

    -- Actualizar o Insertar en la tabla stock (granularidad por área)
    INSERT INTO public.stock (lote_id, area_id, cantidad, updated_at)
    VALUES (NEW.lote_id, NEW.area_id, NEW.cantidad_resultante, NOW())
    ON CONFLICT (lote_id, area_id) 
    DO UPDATE SET 
        cantidad = EXCLUDED.cantidad,
        updated_at = EXCLUDED.updated_at;

    -- Actualizar o Insertar en la tabla stock_snapshot (granularidad por lote global - CQRS)
    INSERT INTO public.stock_snapshot (lote_id, producto_id, stock_actual, ultima_actualizacion)
    VALUES (NEW.lote_id, v_producto_id, (NEW.cantidad * v_signo), NOW())
    ON CONFLICT (lote_id) 
    DO UPDATE SET 
        stock_actual = stock_snapshot.stock_actual + EXCLUDED.stock_actual,
        ultima_actualizacion = EXCLUDED.ultima_actualizacion;

    RETURN NEW;
END;
$$;

-- Poblar la tabla stock_snapshot con el estado actual del inventario
INSERT INTO public.stock_snapshot (lote_id, producto_id, stock_actual, ultima_actualizacion)
SELECT s.lote_id, l.producto_id, SUM(s.cantidad), MAX(s.updated_at)
FROM public.stock s
JOIN public.lotes l ON l.id = s.lote_id
GROUP BY s.lote_id, l.producto_id
ON CONFLICT (lote_id) 
DO UPDATE SET 
    stock_actual = EXCLUDED.stock_actual,
    ultima_actualizacion = EXCLUDED.ultima_actualizacion;
