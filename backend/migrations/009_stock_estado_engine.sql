-- ============================================================
-- 009_stock_estado_engine.sql
--
-- Rebuilds the stock/dashboard alert engine around a SINGLE source
-- of truth (fn_estado_stock) and a days-of-cover model.
--
-- Replaces the previous 4 divergent state engines (SQL in /stock,
-- Rust recompute, SQL in /stock/alertas, SQL resumen) with one
-- immutable rule function that every query calls.
--
-- Removes the manual stock_minimo input entirely: the reorder point
-- is now derived from consumo_diario x lead_time, and the target
-- stock from consumo_diario x (lead_time + dias_objetivo_cobertura).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop the dead legacy alert view (referenced productos.stock_minimo,
--    unused by the backend). Part of the cleanup.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.v_alertas_stock;

-- ------------------------------------------------------------
-- 2. Configuration keys for the days-of-cover model.
--    configuracion PK is `clave`; keep existing values untouched.
-- ------------------------------------------------------------
INSERT INTO public.configuracion (clave, valor_texto) VALUES
    ('dias_objetivo_cobertura', '30'),
    ('vencimiento_riesgo_dias', '30'),
    ('vencimiento_proximo_dias', '90')
ON CONFLICT (clave) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Single source of truth: the state cascade lives HERE and only here.
--    Every query (listar, alertas, resumen, dashboard) calls this with
--    its own aggregated inputs and gets the same verdict, so the filter
--    and the badge can never diverge again.
--
--    Returned states:
--      vencido       - a lote with stock is past its expiry date
--      agotado       - product was stocked at some point, now at zero
--      no_gestionado - never had stock (neutral, not an alert)
--      critico       - days of cover <= lead time (won't make it to reorder)
--      reponer       - days of cover <= lead time + target cover days
--      riesgo_venc   - expires within the risk window (default 30d)
--      por_vencer    - expires within the watch window (default 90d)
--      sin_datos     - has stock but not enough consumption history to estimate
--      normal        - everything is fine
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_estado_stock(
    p_stock             numeric,
    p_consumo_diario    double precision,
    p_dias_con_consumo  integer,
    p_lead_time         integer,
    p_dias_objetivo     integer,
    p_proxima_venc      date,
    p_inicializado      boolean,
    p_dias_min_historia integer DEFAULT 3,
    p_riesgo_dias       integer DEFAULT 30,
    p_proximo_dias      integer DEFAULT 90
) RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        -- Expired stock takes absolute priority.
        WHEN p_proxima_venc IS NOT NULL AND p_proxima_venc < CURRENT_DATE
            THEN 'vencido'

        -- No stock on hand.
        WHEN COALESCE(p_stock, 0) <= 0 AND COALESCE(p_inicializado, false)
            THEN 'agotado'
        WHEN COALESCE(p_stock, 0) <= 0
            THEN 'no_gestionado'

        -- Has stock but not enough history to estimate consumption.
        -- Expiry warnings still apply; otherwise it is neutral 'sin_datos'.
        WHEN COALESCE(p_dias_con_consumo, 0) < GREATEST(p_dias_min_historia, 1)
             OR COALESCE(p_consumo_diario, 0) <= 0.0001
            THEN CASE
                WHEN p_proxima_venc IS NOT NULL
                     AND p_proxima_venc <= CURRENT_DATE + p_riesgo_dias  THEN 'riesgo_venc'
                WHEN p_proxima_venc IS NOT NULL
                     AND p_proxima_venc <= CURRENT_DATE + p_proximo_dias THEN 'por_vencer'
                ELSE 'sin_datos'
            END

        -- Enough history: days-of-cover model.
        ELSE CASE
            WHEN (p_stock / p_consumo_diario) <= COALESCE(p_lead_time, 7)
                THEN 'critico'
            WHEN (p_stock / p_consumo_diario) <= COALESCE(p_lead_time, 7) + COALESCE(p_dias_objetivo, 30)
                THEN 'reponer'
            WHEN p_proxima_venc IS NOT NULL
                 AND p_proxima_venc <= CURRENT_DATE + p_riesgo_dias  THEN 'riesgo_venc'
            WHEN p_proxima_venc IS NOT NULL
                 AND p_proxima_venc <= CURRENT_DATE + p_proximo_dias THEN 'por_vencer'
            ELSE 'normal'
        END
    END;
$$;

COMMENT ON FUNCTION public.fn_estado_stock IS
    'Single source of truth for product stock state. Days-of-cover model. Called by all stock/dashboard/alert queries.';

-- ------------------------------------------------------------
-- 4. Drop the manual minimum columns. The model no longer stores a
--    minimum; it derives the reorder point from consumption.
--    par_level_config keeps its own columns (separate auto-consumo system).
-- ------------------------------------------------------------
ALTER TABLE public.productos      DROP COLUMN IF EXISTS stock_minimo;
ALTER TABLE public.producto_area  DROP COLUMN IF EXISTS stock_minimo;
