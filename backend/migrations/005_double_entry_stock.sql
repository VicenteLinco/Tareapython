-- C2.1: Add es_virtual column to areas
ALTER TABLE public.areas
    ADD COLUMN IF NOT EXISTS es_virtual BOOLEAN NOT NULL DEFAULT false;

-- C2.2: Insert virtual sink areas
INSERT INTO public.areas (nombre, es_virtual)
VALUES
    ('VIRTUAL_CONSUMED',  true),
    ('VIRTUAL_DISCARDED', true),
    ('VIRTUAL_ADJUSTED',  true),
    ('VIRTUAL_INITIAL',   true)
ON CONFLICT (nombre) DO UPDATE SET es_virtual = true;

-- C2.3: Add destino_area_id to movimientos
ALTER TABLE public.movimientos
    ADD COLUMN IF NOT EXISTS destino_area_id INTEGER REFERENCES public.areas(id);

COMMENT ON COLUMN public.movimientos.destino_area_id IS
    'Área de destino explícita del movimiento. CONSUMO → VIRTUAL_CONSUMED, DESCARTE → VIRTUAL_DISCARDED, TRANSFERENCIA → área real de destino, INGRESO → área real (origen=VIRTUAL_INITIAL).';

-- C2.4: Backfill destino_area_id for existing movements
UPDATE public.movimientos m
SET destino_area_id = a.id
FROM public.areas a
WHERE a.nombre = 'VIRTUAL_CONSUMED'
  AND m.tipo IN ('CONSUMO')
  AND m.destino_area_id IS NULL;

UPDATE public.movimientos m
SET destino_area_id = a.id
FROM public.areas a
WHERE a.nombre = 'VIRTUAL_DISCARDED'
  AND m.tipo IN ('DESCARTE_VENCIDO', 'DESCARTE_DAÑADO')
  AND m.destino_area_id IS NULL;

UPDATE public.movimientos m
SET destino_area_id = a.id
FROM public.areas a
WHERE a.nombre = 'VIRTUAL_ADJUSTED'
  AND m.tipo IN ('AJUSTE_NEGATIVO', 'AJUSTE_POSITIVO')
  AND m.destino_area_id IS NULL;

-- C2.5: Balance check view
CREATE OR REPLACE VIEW public.v_stock_balance_check AS
WITH movs AS (
    SELECT
        lote_id,
        area_id,
        tipo,
        cantidad,
        CASE
            WHEN tipo IN ('CONSUMO', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SALIDA',
                          'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO')
            THEN -cantidad
            ELSE cantidad
        END AS cantidad_con_signo
    FROM public.movimientos
    WHERE area_id NOT IN (SELECT id FROM public.areas WHERE es_virtual = true)
),
calc AS (
    SELECT lote_id, area_id, SUM(cantidad_con_signo) AS stock_calculado
    FROM movs
    GROUP BY lote_id, area_id
)
SELECT
    c.lote_id,
    c.area_id,
    c.stock_calculado,
    COALESCE(s.cantidad, 0) AS stock_materializado,
    ABS(c.stock_calculado - COALESCE(s.cantidad, 0)) AS discrepancia
FROM calc c
LEFT JOIN public.stock s ON s.lote_id = c.lote_id AND s.area_id = c.area_id
WHERE ABS(c.stock_calculado - COALESCE(s.cantidad, 0)) > 0.001;
