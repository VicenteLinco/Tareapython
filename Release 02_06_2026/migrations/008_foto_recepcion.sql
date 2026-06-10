-- Almacena la foto de factura/guía como data URL base64
ALTER TABLE recepciones ADD COLUMN IF NOT EXISTS foto_documento TEXT;
