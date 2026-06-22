-- Two-axis stock state model.
--
-- Replaces the single-enum cascade of fn_estado_stock (migration 001) with two
-- ORTHOGONAL axes so that "do I need to BUY?" and "do I need to DISCARD?" never
-- overwrite each other:
--
--   * fn_estado_cantidad   -> reorder/quantity state, computed over USABLE stock
--                             (non-expired). Honors a manual reorder point only
--                             as a safety net when there is no consumption
--                             history (the days-of-cover model is blind there).
--   * fn_estado_vencimiento -> expiry/quality state, an internal urgency cascade
--                             (vencido > riesgo_venc > por_vencer > ok).
--
-- Golden rule: cascade WITHIN an axis (sequential actions), NEVER across axes
-- (buying and discarding are simultaneous, independent actions).
--
-- fn_estado_stock is intentionally left in place; filters and dashboard counters
-- still depend on it and migrate in a later step.

--
-- Quantity axis. Operates on usable (non-expired) stock.
--
CREATE FUNCTION public.fn_estado_cantidad(
    p_stock_usable numeric,
    p_consumo_diario double precision,
    p_dias_con_consumo integer,
    p_lead_time integer,
    p_dias_objetivo integer,
    p_inicializado boolean,
    p_stock_minimo_manual numeric DEFAULT NULL,
    p_stock_maximo_manual numeric DEFAULT NULL,
    p_dias_min_historia integer DEFAULT 3
) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE
        -- No usable stock on hand.
        WHEN COALESCE(p_stock_usable, 0) <= 0 AND COALESCE(p_inicializado, false)
            THEN 'agotado'
        WHEN COALESCE(p_stock_usable, 0) <= 0
            THEN 'no_gestionado'

        -- Has usable stock but not enough history to estimate consumption.
        -- The manual reorder point steps in ONLY here, as a safety net.
        WHEN COALESCE(p_dias_con_consumo, 0) < GREATEST(p_dias_min_historia, 1)
             OR COALESCE(p_consumo_diario, 0) <= 0.0001
            THEN CASE
                WHEN p_stock_minimo_manual IS NOT NULL AND p_stock_minimo_manual > 0
                    THEN CASE
                        WHEN p_stock_usable <= p_stock_minimo_manual * 0.5 THEN 'critico'
                        WHEN p_stock_usable <= p_stock_minimo_manual          THEN 'reponer'
                        WHEN p_stock_maximo_manual IS NOT NULL
                             AND p_stock_maximo_manual > 0
                             AND p_stock_usable > p_stock_maximo_manual       THEN 'exceso'
                        ELSE 'normal'
                    END
                ELSE 'sin_datos'
            END

        -- Enough history: days-of-cover model.
        ELSE CASE
            WHEN (p_stock_usable / p_consumo_diario) <= COALESCE(p_lead_time, 7)
                THEN 'critico'
            WHEN (p_stock_usable / p_consumo_diario) <= COALESCE(p_lead_time, 7) + COALESCE(p_dias_objetivo, 30)
                THEN 'reponer'
            -- Overstock is a DELIBERATE signal: only when an explicit manual ceiling
            -- is exceeded. No days-of-cover heuristic — it would flag healthy buffers
            -- as overstock and erode trust in the alerts.
            WHEN p_stock_maximo_manual IS NOT NULL
                 AND p_stock_maximo_manual > 0
                 AND p_stock_usable > p_stock_maximo_manual
                THEN 'exceso'
            ELSE 'normal'
        END
    END;
$$;

--
-- Expiry axis. Internal urgency cascade. `vencido` reflects any expired stock on
-- hand; `riesgo_venc`/`por_vencer` reflect the nearest expiry of USABLE stock.
--
CREATE FUNCTION public.fn_estado_vencimiento(
    p_tiene_vencido boolean,
    p_proxima_venc_usable date,
    p_riesgo_dias integer DEFAULT 30,
    p_proximo_dias integer DEFAULT 90
) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE
        WHEN COALESCE(p_tiene_vencido, false)
            THEN 'vencido'
        WHEN p_proxima_venc_usable IS NOT NULL
             AND p_proxima_venc_usable <= CURRENT_DATE + p_riesgo_dias
            THEN 'riesgo_venc'
        WHEN p_proxima_venc_usable IS NOT NULL
             AND p_proxima_venc_usable <= CURRENT_DATE + p_proximo_dias
            THEN 'por_vencer'
        ELSE 'ok'
    END;
$$;
