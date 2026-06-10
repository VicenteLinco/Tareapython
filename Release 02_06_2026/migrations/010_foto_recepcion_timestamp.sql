-- Registra cuándo se adjuntó/actualizó la foto de guía/factura
ALTER TABLE recepciones ADD COLUMN IF NOT EXISTS foto_actualizada_at TIMESTAMPTZ;
