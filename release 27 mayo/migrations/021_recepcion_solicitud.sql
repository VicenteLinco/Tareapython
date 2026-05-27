-- ============================================================
-- Migración 021: Vincular Recepciones con Solicitudes
-- ============================================================

ALTER TABLE recepciones 
    ADD COLUMN solicitud_id UUID REFERENCES solicitudes_compra(id);

CREATE INDEX idx_recepciones_solicitud ON recepciones(solicitud_id);

COMMENT ON COLUMN recepciones.solicitud_id IS 'ID de la solicitud de compra que originó esta recepción';
