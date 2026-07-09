-- Vencimiento opcional: los productos 'simple' (y lotes que no perecen) no
-- requieren fecha de vencimiento. El SQL de stock/FEFO ya contempla NULL
-- (IS NULL OR >= CURRENT_DATE, ORDER BY ... NULLS LAST, FILTER ... IS NOT NULL),
-- y fn_estado_vencimiento cae en 'ok' cuando la próxima fecha es NULL.

ALTER TABLE public.lotes
    ALTER COLUMN fecha_vencimiento DROP NOT NULL;
