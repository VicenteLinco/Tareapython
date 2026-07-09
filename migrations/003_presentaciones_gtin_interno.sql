-- Track whether a presentation's GTIN was generated internally (using the
-- company prefix) or supplied by the manufacturer/supplier. This lets the UI
-- distinguish a real trade GTIN from one we minted ourselves.
ALTER TABLE presentaciones
    ADD COLUMN gtin_interno boolean NOT NULL DEFAULT false;

-- Best-effort one-time backfill: existing GTINs that start with the configured
-- company prefix are very likely internally generated. Runs only when the
-- prefix is configured; otherwise every existing GTIN stays marked as external.
UPDATE presentaciones p
SET gtin_interno = true
WHERE p.gtin IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM configuracion c
      WHERE c.clave = 'gtin_company_prefix'
        AND c.valor_texto IS NOT NULL
        AND c.valor_texto <> ''
        AND p.gtin LIKE c.valor_texto || '%'
  );
