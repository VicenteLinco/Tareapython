-- 069: Supplier-aware presentations join table + lot packaging traceability
-- Adds producto_proveedor_presentacion table and lotes.presentacion_id column.
-- producto_proveedor.presentacion_id is kept for now (legacy, do not use for reads)

BEGIN;

-- 1. Join table: links a producto_proveedor record to one or more presentations,
--    with a single active default per supplier+product link enforced at DB level.
CREATE TABLE producto_proveedor_presentacion (
    id                     SERIAL PRIMARY KEY,
    producto_proveedor_id  INTEGER NOT NULL
        REFERENCES producto_proveedor(id) ON DELETE CASCADE,
    presentacion_id        INTEGER NOT NULL
        REFERENCES presentaciones(id),
    es_default             BOOLEAN NOT NULL DEFAULT false,
    precio_unidad          NUMERIC(12,4),
    activo                 BOOLEAN NOT NULL DEFAULT true,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (producto_proveedor_id, presentacion_id)
);

-- Exactly one active default per supplier+product link (partial unique index).
-- activo = true ensures soft-deleted rows don't count toward the constraint.
CREATE UNIQUE INDEX uq_ppp_default
    ON producto_proveedor_presentacion (producto_proveedor_id)
    WHERE es_default = true AND activo = true;

-- Performance index for active listing queries.
CREATE INDEX idx_ppp_pp
    ON producto_proveedor_presentacion (producto_proveedor_id)
    WHERE activo = true;

COMMENT ON TABLE producto_proveedor_presentacion IS
    'Supplier+product to presentation link with optional default and per-presentation price. Supersedes producto_proveedor.presentacion_id (deprecated, not dropped).';

-- 2. Migrate existing default links from the legacy column.
INSERT INTO producto_proveedor_presentacion
    (producto_proveedor_id, presentacion_id, es_default, precio_unidad, activo)
SELECT pp.id, pp.presentacion_id, true, pp.precio_unidad, true
FROM producto_proveedor pp
WHERE pp.presentacion_id IS NOT NULL
ON CONFLICT (producto_proveedor_id, presentacion_id) DO NOTHING;

-- 3. Add nullable lot packaging FK (backward-compatible; existing lots get NULL).
ALTER TABLE lotes ADD COLUMN presentacion_id INTEGER REFERENCES presentaciones(id);

COMMENT ON COLUMN lotes.presentacion_id IS
    'Presentation the lot arrived in (reception). NULL for legacy or unmatched lots.';

-- 4. Backfill lotes.presentacion_id from most-recent recepcion_detalle per lot.
--    Uses DISTINCT ON ordered by created_at DESC, id DESC for determinism.
UPDATE lotes l
SET presentacion_id = sub.presentacion_id
FROM (
    SELECT DISTINCT ON (rd.lote_id)
        rd.lote_id,
        rd.presentacion_id
    FROM recepcion_detalle rd
    WHERE rd.presentacion_id IS NOT NULL
    ORDER BY rd.lote_id, rd.created_at DESC, rd.id DESC
) sub
WHERE sub.lote_id = l.id;

-- 5. Deprecation notice on the legacy column (not dropped this cycle).
COMMENT ON COLUMN producto_proveedor.presentacion_id IS
    'DEPRECATED: kept for rollback safety. Use producto_proveedor_presentacion instead. Will be dropped in a future migration.';

COMMIT;
