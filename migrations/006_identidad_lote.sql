-- Identidad del lote = (producto_id, numero_lote).
-- El proveedor sale de la clave: el numero_lote lo pone el fabricante y el mismo
-- lote físico puede llegar por distintos distribuidores. Recibir el mismo
-- (producto, numero_lote) por otro proveedor ahora reconoce el MISMO lote.
--
-- Antes de apretar la clave hay que fusionar los duplicados existentes que sólo
-- difieren en proveedor_id. El stock se mantiene por trigger BEFORE INSERT sobre
-- movimientos, por lo que un UPDATE de lote_id NO recalcula stock: la fusión suma
-- las filas de `stock` a mano. Si hay duplicados con vencimiento distinto, aborta
-- (no se fusiona a ciegas).

CREATE FUNCTION public.fn_fusionar_lotes_duplicados() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_fusionados integer := 0;
BEGIN
    -- 1. Abortar si hay duplicados (producto, numero_lote) con vencimiento distinto
    --    (incluye el caso mezcla de NULL y no-NULL).
    IF EXISTS (
        SELECT 1
        FROM public.lotes
        GROUP BY producto_id, numero_lote
        HAVING COUNT(DISTINCT fecha_vencimiento) > 1
            OR (COUNT(*) FILTER (WHERE fecha_vencimiento IS NULL) > 0
                AND COUNT(*) FILTER (WHERE fecha_vencimiento IS NOT NULL) > 0)
    ) THEN
        RAISE EXCEPTION 'Lotes duplicados (producto, numero_lote) con fecha_vencimiento distinta: resolver manualmente antes de migrar.';
    END IF;

    -- 2. Mapa duplicado -> superviviente (el más antiguo; id como desempate).
    CREATE TEMP TABLE _fusion ON COMMIT DROP AS
    SELECT l.id AS dup_id, s.superviviente
    FROM public.lotes l
    JOIN (
        SELECT producto_id, numero_lote,
               (array_agg(id ORDER BY created_at, id))[1] AS superviviente
        FROM public.lotes
        GROUP BY producto_id, numero_lote
        HAVING COUNT(*) > 1
    ) s ON s.producto_id = l.producto_id AND s.numero_lote = l.numero_lote
    WHERE l.id <> s.superviviente;

    -- 3. Stock: sumar el del duplicado al superviviente, luego borrar el del duplicado.
    INSERT INTO public.stock (lote_id, area_id, cantidad, updated_at)
    SELECT f.superviviente, st.area_id, st.cantidad, NOW()
    FROM public.stock st
    JOIN _fusion f ON f.dup_id = st.lote_id
    ON CONFLICT (lote_id, area_id)
    DO UPDATE SET cantidad = public.stock.cantidad + EXCLUDED.cantidad, updated_at = NOW();
    DELETE FROM public.stock WHERE lote_id IN (SELECT dup_id FROM _fusion);

    -- 4. Repuntar referencias históricas al superviviente.
    UPDATE public.movimientos m SET lote_id = f.superviviente
    FROM _fusion f WHERE m.lote_id = f.dup_id;

    UPDATE public.recepcion_detalle rd SET lote_id = f.superviviente
    FROM _fusion f WHERE rd.lote_id = f.dup_id;

    -- conteo_items tiene UNIQUE (sesion_id, lote_id): borrar el del duplicado si el
    -- superviviente ya está contado en la misma sesión, repuntar el resto.
    DELETE FROM public.conteo_items ci USING _fusion f
    WHERE ci.lote_id = f.dup_id
      AND EXISTS (
          SELECT 1 FROM public.conteo_items ci2
          WHERE ci2.sesion_id = ci.sesion_id AND ci2.lote_id = f.superviviente
      );
    UPDATE public.conteo_items ci SET lote_id = f.superviviente
    FROM _fusion f WHERE ci.lote_id = f.dup_id;

    -- 5. Borrar los lotes duplicados.
    DELETE FROM public.lotes WHERE id IN (SELECT dup_id FROM _fusion);
    GET DIAGNOSTICS v_fusionados = ROW_COUNT;

    RETURN v_fusionados;
END;
$$;

-- Ejecutar la fusión sobre los datos existentes (aborta la migración si hay conflicto).
SELECT public.fn_fusionar_lotes_duplicados();

-- Apretar la identidad del lote.
ALTER TABLE public.lotes
    DROP CONSTRAINT lotes_producto_proveedor_lote_key;

ALTER TABLE public.lotes
    ADD CONSTRAINT lotes_producto_numero_lote_key UNIQUE (producto_id, numero_lote);
