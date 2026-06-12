-- Migración 070: Registro e Historial de Webhooks de WhatsApp
-- Up
CREATE TABLE whatsapp_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(100) UNIQUE NOT NULL,
    sender_phone VARCHAR(50) NOT NULL,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    request_body TEXT NOT NULL,
    command_type VARCHAR(20), -- 'AYUDA', 'STOCK', 'RECIBIR', 'CREAR', 'INVALIDO'
    status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'UNAUTHORIZED', 'SYNTAX_ERROR', 'DB_ERROR'
    response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_logs_phone ON whatsapp_webhook_logs(sender_phone);
CREATE INDEX idx_whatsapp_logs_status ON whatsapp_webhook_logs(status);
CREATE INDEX idx_whatsapp_logs_created ON whatsapp_webhook_logs(created_at);

-- Down
-- DROP TABLE IF EXISTS whatsapp_webhook_logs;
