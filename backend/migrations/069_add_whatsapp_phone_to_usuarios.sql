-- Migración 069: Agregar whatsapp_phone a usuarios

-- Up
ALTER TABLE usuarios ADD COLUMN whatsapp_phone VARCHAR(50) UNIQUE;
CREATE INDEX idx_usuarios_whatsapp_phone ON usuarios (whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;

-- Down
-- DROP INDEX IF EXISTS idx_usuarios_whatsapp_phone;
-- ALTER TABLE usuarios DROP COLUMN IF EXISTS whatsapp_phone;
