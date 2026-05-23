ALTER TABLE presentaciones
    ADD COLUMN gtin VARCHAR(14),
    ADD COLUMN gs1_habilitado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX idx_presentaciones_gtin
    ON presentaciones(gtin)
    WHERE gtin IS NOT NULL;
