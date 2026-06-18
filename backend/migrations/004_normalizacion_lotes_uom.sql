-- C1.1: Remove codigo_interno from lotes
DROP INDEX IF EXISTS public.idx_lotes_codigo_interno;
ALTER TABLE public.lotes DROP CONSTRAINT IF EXISTS lotes_codigo_interno_key;
ALTER TABLE public.lotes ALTER COLUMN codigo_interno DROP DEFAULT;
ALTER TABLE public.lotes DROP COLUMN IF EXISTS codigo_interno;

-- C1.2: Add recepcion_id FK (nullable — existing lotes won't have it)
ALTER TABLE public.lotes
    ADD COLUMN IF NOT EXISTS recepcion_id UUID REFERENCES public.recepciones(id) ON DELETE SET NULL;

-- Backfill recepcion_id from recepcion_detalle (recepcion_detalle has both recepcion_id and lote_id)
UPDATE public.lotes l
SET recepcion_id = sub.recepcion_id
FROM (
    SELECT DISTINCT ON (rd.lote_id)
        rd.lote_id,
        rd.recepcion_id
    FROM public.recepcion_detalle rd
    ORDER BY rd.lote_id, rd.recepcion_id
) sub
WHERE sub.lote_id = l.id AND l.recepcion_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_lotes_recepcion
    ON public.lotes (recepcion_id) WHERE recepcion_id IS NOT NULL;

-- C1.3: Add fecha_fabricacion (nullable — not all supplies report it)
ALTER TABLE public.lotes
    ADD COLUMN IF NOT EXISTS fecha_fabricacion DATE;

COMMENT ON COLUMN public.lotes.fecha_fabricacion IS
    'Fecha de fabricacion del lote segun el fabricante. Nullable: no todos los insumos la informan.';

-- C1.4: Add categoria to unidades_basicas
ALTER TABLE public.unidades_basicas
    ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'count'
    CONSTRAINT chk_unidades_basicas_categoria
    CHECK (categoria IN ('count', 'volume', 'weight', 'length', 'area', 'time', 'custom'));

COMMENT ON COLUMN public.unidades_basicas.categoria IS
    'Categoria fisica. Previene comparar unidades incompatibles.';

-- Best-effort backfill by unit name
UPDATE public.unidades_basicas
SET categoria = CASE
    WHEN LOWER(nombre) ~ '(ml|mili|litro|litros|\bl\b|µl|ul|cc\b)' THEN 'volume'
    WHEN LOWER(nombre) ~ '(mg|gramo|gramos|kg|µg|ug\b)' THEN 'weight'
    ELSE 'count'
END;
