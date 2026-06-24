-- Migration 009: Catalogacion GTIN Mejoras
-- Add `fabricante` column to `productos` and update search trigger

ALTER TABLE public.productos 
    ADD COLUMN fabricante VARCHAR(300) NULL;

-- Update the search vector update function to include fabricante
CREATE OR REPLACE FUNCTION public.productos_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.nombre, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_interno, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.sku, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.descripcion, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.fabricante, '')), 'C');
    RETURN NEW;
END;
$$;

-- Drop and recreate the search vector trigger to fire on updates to fabricante
DROP TRIGGER IF EXISTS trg_productos_search_vector ON public.productos;

CREATE TRIGGER trg_productos_search_vector
    BEFORE INSERT OR UPDATE OF nombre, codigo_interno, sku, descripcion, fabricante
    ON public.productos
    FOR EACH ROW
    EXECUTE FUNCTION public.productos_search_vector_update();
