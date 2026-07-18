-- Migration: Reorder fn_estado_vencimiento checks so active warnings (riesgo_venc, por_vencer) take precedence over recently discarded status

CREATE OR REPLACE FUNCTION public.fn_estado_vencimiento(
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
