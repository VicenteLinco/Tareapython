ALTER TABLE productos
    ADD COLUMN search_vector TSVECTOR;

CREATE FUNCTION productos_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.nombre, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_interno, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_proveedor, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_maestro, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.descripcion, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE productos
SET search_vector =
    setweight(to_tsvector('simple', COALESCE(nombre, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(codigo_interno, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(codigo_proveedor, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(codigo_maestro, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(descripcion, '')), 'C');

CREATE TRIGGER trg_productos_search_vector
BEFORE INSERT OR UPDATE OF nombre, codigo_interno, codigo_proveedor, codigo_maestro, descripcion
ON productos
FOR EACH ROW EXECUTE FUNCTION productos_search_vector_update();

CREATE INDEX idx_productos_search_vector
    ON productos USING GIN(search_vector);
