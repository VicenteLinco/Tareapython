-- ============================================================
-- C3-A: GTIN enforcement on presentaciones
-- ============================================================

-- Ensure VARCHAR(14) for gtin (already VARCHAR(14) from 001, but enforce)
ALTER TABLE public.presentaciones
    ALTER COLUMN gtin TYPE VARCHAR(14);

-- Ensure the partial unique index exists
DROP INDEX IF EXISTS public.idx_presentaciones_gtin_active;
CREATE UNIQUE INDEX idx_presentaciones_gtin_active
    ON public.presentaciones (gtin)
    WHERE gtin IS NOT NULL AND activa = true AND deleted_at IS NULL;

-- ============================================================
-- C3-A: GTIN configuration keys
-- configuracion(clave, valor_texto) confirmed from 001_initial_schema.sql
-- ============================================================

INSERT INTO public.configuracion (clave, valor_texto)
VALUES
    ('gtin_company_prefix', '200000'),
    ('gtin_next_sequence',  '1')
ON CONFLICT (clave) DO NOTHING;

-- ============================================================
-- C3-A: Function to generate internal GTIN
-- Generates a GS1-compliant GTIN-14 using the company prefix
-- stored in configuracion and an auto-incrementing sequence.
-- ============================================================

CREATE OR REPLACE FUNCTION public.generar_gtin_interno()
RETURNS VARCHAR(14)
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix  VARCHAR(9);
    v_seq     BIGINT;
    v_item    VARCHAR(6);
    v_raw13   VARCHAR(13);
    v_sum     INTEGER := 0;
    v_check   INTEGER;
    i         INTEGER;
BEGIN
    SELECT valor_texto INTO v_prefix
    FROM public.configuracion WHERE clave = 'gtin_company_prefix';

    SELECT valor_texto::BIGINT INTO v_seq
    FROM public.configuracion WHERE clave = 'gtin_next_sequence';

    UPDATE public.configuracion
    SET valor_texto = (v_seq + 1)::TEXT
    WHERE clave = 'gtin_next_sequence';

    v_item  := LPAD(v_seq::TEXT, 6, '0');
    v_raw13 := v_prefix || v_item;  -- 12 chars total (6 prefix + 6 item)

    -- GS1 check digit calculation (alternating weights 1 and 3)
    FOR i IN 1..12 LOOP
        IF i % 2 = 0 THEN
            v_sum := v_sum + (SUBSTRING(v_raw13, i, 1)::INTEGER * 3);
        ELSE
            v_sum := v_sum + SUBSTRING(v_raw13, i, 1)::INTEGER;
        END IF;
    END LOOP;
    v_check := (10 - (v_sum % 10)) % 10;

    RETURN LPAD(v_raw13 || v_check::TEXT, 14, '0');
END;
$$;

-- ============================================================
-- C3-B: Par level config table
-- Stores min/max/safety stock per product, optionally per area.
-- area_id NULL = global default for the product.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.par_level_config (
    id                      SERIAL PRIMARY KEY,
    producto_id             UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    area_id                 INTEGER REFERENCES public.areas(id) ON DELETE CASCADE,
    stock_minimo            NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock_maximo            NUMERIC(12,2),
    safety_stock            NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo                  VARCHAR(20) NOT NULL DEFAULT 'manual'
        CONSTRAINT chk_par_level_metodo CHECK (metodo IN ('manual', 'auto_consumo')),
    horizonte_calculo_dias  INTEGER DEFAULT 90,
    lead_time_dias          INTEGER,
    version                 INTEGER NOT NULL DEFAULT 1,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by              UUID REFERENCES public.usuarios(id),
    UNIQUE (producto_id, area_id)
);

CREATE INDEX IF NOT EXISTS idx_par_level_producto
    ON public.par_level_config (producto_id);

COMMENT ON TABLE public.par_level_config IS
    'Par level (min/max/safety stock) per product. area_id NULL = global default.';

-- Migrate existing stock_minimo values from productos
INSERT INTO public.par_level_config (producto_id, stock_minimo, metodo)
SELECT id, stock_minimo, 'manual'
FROM public.productos
WHERE stock_minimo > 0
ON CONFLICT (producto_id, area_id) DO NOTHING;

-- Deprecate productos.stock_minimo (kept for rollback safety)
COMMENT ON COLUMN public.productos.stock_minimo IS
    'DEPRECATED: use par_level_config. Kept for rollback safety.';

-- ============================================================
-- C3-B: Alertas view using par_level_config
-- Provides a simple stock alert classification per product
-- (global, not area-scoped) using the new par_level_config.
-- ============================================================

CREATE OR REPLACE VIEW public.v_alertas_stock AS
SELECT
    p.id                                                AS producto_id,
    p.nombre                                            AS producto_nombre,
    COALESCE(SUM(s.cantidad), 0)                        AS stock_actual,
    COALESCE(plc.stock_minimo, p.stock_minimo, 0)       AS stock_minimo,
    plc.stock_maximo,
    COALESCE(plc.safety_stock, 0)                       AS safety_stock,
    CASE
        WHEN COALESCE(SUM(s.cantidad), 0) <= COALESCE(plc.safety_stock, 0)
             AND COALESCE(plc.safety_stock, 0) > 0      THEN 'critico'
        WHEN COALESCE(SUM(s.cantidad), 0) <=
             COALESCE(plc.stock_minimo, p.stock_minimo, 0) THEN 'bajo'
        ELSE 'normal'
    END                                                 AS estado_alerta
FROM public.productos p
LEFT JOIN public.par_level_config plc
       ON plc.producto_id = p.id AND plc.area_id IS NULL
LEFT JOIN public.lotes l    ON l.producto_id = p.id
LEFT JOIN public.stock s    ON s.lote_id = l.id
LEFT JOIN public.areas a    ON a.id = s.area_id AND a.es_virtual = false
WHERE p.deleted_at IS NULL
  AND p.activo = true
GROUP BY p.id, p.nombre, plc.stock_minimo, plc.stock_maximo,
         plc.safety_stock, p.stock_minimo;
