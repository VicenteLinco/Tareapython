-- Migration 007: Flatten producto_proveedor into productos
--
-- Design decisions:
--   1. 1 product = 1 supplier (no multi-supplier)
--   2. sku = supplier catalog code (replaces codigo_proveedor, drops codigo_maestro)
--   3. Presentation fields flattened into productos: pres_* columns
--   4. producto_proveedor table → DROPPED (with cascade)
--   5. producto_proveedor_presentacion table → DROPPED (no longer needed)
--   6. presentaciones table → KEPT (has FKs from recepcion_detalle, producto_precio_historial, etc.)
--   7. imagen_url migrated to productos directly

-- ─── Step 1: Add new columns to productos ────────────────────────────────────

ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS sku                 VARCHAR(100),
    ADD COLUMN IF NOT EXISTS imagen_url          TEXT,
    ADD COLUMN IF NOT EXISTS pres_nombre         VARCHAR(300),
    ADD COLUMN IF NOT EXISTS pres_nombre_plural  VARCHAR(300),
    ADD COLUMN IF NOT EXISTS pres_factor         NUMERIC(12,4) DEFAULT 1,
    ADD COLUMN IF NOT EXISTS pres_codigo_barras  VARCHAR(200),
    ADD COLUMN IF NOT EXISTS pres_gtin           VARCHAR(20),
    ADD COLUMN IF NOT EXISTS pres_gs1_habilitado BOOLEAN NOT NULL DEFAULT false;

-- ─── Step 2: Migrate data from producto_proveedor (principal rows) ────────────
-- Uses EXECUTE (dynamic SQL) so the UPDATE is only analyzed at runtime, after the
-- IF EXISTS check confirms the table exists. Static SQL inside DO blocks is
-- compiled eagerly by PostgreSQL and would fail if the table doesn't exist.

DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'producto_proveedor'
    ) THEN
        EXECUTE '
            UPDATE productos p
            SET
                proveedor_id  = pp.proveedor_id,
                sku           = COALESCE(pp.codigo_proveedor, p.sku),
                precio_unidad = COALESCE(pp.precio_unidad, p.precio_unidad),
                imagen_url    = pp.imagen_url
            FROM producto_proveedor pp
            WHERE pp.producto_id = p.id
              AND pp.es_principal = true
              AND pp.activo = true
        ';

        EXECUTE '
            UPDATE productos p
            SET
                proveedor_id  = pp.proveedor_id,
                sku           = COALESCE(pp.codigo_proveedor, p.sku),
                precio_unidad = COALESCE(pp.precio_unidad, p.precio_unidad),
                imagen_url    = COALESCE(p.imagen_url, pp.imagen_url)
            FROM producto_proveedor pp
            WHERE pp.producto_id = p.id
              AND p.proveedor_id IS NULL
              AND pp.activo = true
        ';
    END IF;
END $$;

-- ─── Step 3: Migrate sku fallback from codigo_proveedor if still empty ────────
-- Uses EXECUTE (dynamic SQL) so the column reference is only resolved at runtime.

DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'productos'
          AND column_name  = 'codigo_proveedor'
    ) THEN
        EXECUTE '
            UPDATE productos
            SET sku = codigo_proveedor
            WHERE sku IS NULL AND codigo_proveedor IS NOT NULL
        ';
    END IF;
END $$;

-- ─── Step 4: Migrate presentation fields from presentaciones (active, not deleted) ─

UPDATE productos p
SET
    pres_nombre        = pr.nombre,
    pres_nombre_plural = pr.nombre_plural,
    pres_factor        = pr.factor_conversion,
    pres_codigo_barras = pr.codigo_barras,
    pres_gtin          = pr.gtin,
    pres_gs1_habilitado = pr.gs1_habilitado
FROM (
    SELECT DISTINCT ON (producto_id)
        producto_id, nombre, nombre_plural, factor_conversion,
        codigo_barras, gtin, gs1_habilitado
    FROM presentaciones
    WHERE activa = true AND deleted_at IS NULL
    ORDER BY producto_id, factor_conversion DESC, id ASC
) pr
WHERE pr.producto_id = p.id
  AND p.pres_nombre IS NULL;

-- ─── Step 5: Update trigger function to use sku instead of codigo_proveedor/maestro ─

CREATE OR REPLACE FUNCTION public.productos_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.nombre, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_interno, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.sku, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.descripcion, '')), 'C');
    RETURN NEW;
END;
$$;

-- Refresh all search vectors now that sku is populated
UPDATE productos SET search_vector =
    setweight(to_tsvector('simple', COALESCE(nombre, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(codigo_interno, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(sku, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(descripcion, '')), 'C');

-- ─── Step 6: Drop producto_proveedor_presentacion first (FK dependency) ──────

DROP TABLE IF EXISTS producto_proveedor_presentacion;

-- ─── Step 7: Drop producto_proveedor ─────────────────────────────────────────

DROP TABLE IF EXISTS producto_proveedor CASCADE;

-- ─── Step 8: Drop now-redundant columns from productos ───────────────────────
-- codigo_proveedor and codigo_maestro are superseded by sku.
-- The trigger must be dropped first because it references these columns in its
-- UPDATE OF clause, which prevents DROP COLUMN from succeeding.

DROP TRIGGER IF EXISTS trg_productos_search_vector ON productos;

ALTER TABLE productos
    DROP COLUMN IF EXISTS codigo_proveedor,
    DROP COLUMN IF EXISTS codigo_maestro;

-- Recreate trigger with updated column list (sku replaces codigo_proveedor/maestro)
CREATE TRIGGER trg_productos_search_vector
    BEFORE INSERT OR UPDATE OF nombre, codigo_interno, sku, descripcion
    ON productos
    FOR EACH ROW EXECUTE FUNCTION public.productos_search_vector_update();
