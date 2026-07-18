-- 'no_aplica' expiry state for products that don't track expiry.
--
-- Products with control_lote = 'simple' (consumables) carry lotes with
-- fecha_vencimiento NULL and must NOT surface in the expiry axis: they are neither
-- 'ok' (which mixes them with healthy perishables in KPIs/alerts) nor anything to
-- discard. fn_estado_vencimiento gains p_rastrea_vencimiento: when false, it
-- short-circuits to 'no_aplica' before the urgency cascade.
--
-- Replaces the migration 002 signature; the two call sites in stock_service.rs are
-- updated to pass (control_lote <> 'simple') for this argument.

DROP FUNCTION IF EXISTS public.fn_estado_vencimiento(boolean, date, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.fn_estado_vencimiento(boolean, date, boolean, integer, integer, boolean);

CREATE FUNCTION public.fn_estado_vencimiento(
    p_tiene_vencido boolean,
    p_proxima_venc_usable date,
    p_rastrea_vencimiento boolean DEFAULT true,
    p_riesgo_dias integer DEFAULT 30,
    p_proximo_dias integer DEFAULT 90,
    p_recientemente_descartado boolean DEFAULT false
) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE
        WHEN NOT COALESCE(p_rastrea_vencimiento, true)
            THEN 'no_aplica'
        WHEN COALESCE(p_tiene_vencido, false)
            THEN 'vencido'
        WHEN p_proxima_venc_usable IS NOT NULL
             AND p_proxima_venc_usable <= CURRENT_DATE + p_riesgo_dias
            THEN 'riesgo_venc'
        WHEN p_proxima_venc_usable IS NOT NULL
             AND p_proxima_venc_usable <= CURRENT_DATE + p_proximo_dias
            THEN 'por_vencer'
        WHEN COALESCE(p_recientemente_descartado, false)
            THEN 'vencido_descartado'
        ELSE 'ok'
    END;
$$;
