-- Add whatsapp_phone to usuarios
ALTER TABLE public.usuarios
    ADD COLUMN IF NOT EXISTS whatsapp_phone character varying(50);

-- Create whatsapp_webhook_logs table
CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id character varying(100) NOT NULL,
    sender_phone character varying(50) NOT NULL,
    usuario_id uuid,
    request_body text NOT NULL,
    command_type character varying(20),
    status character varying(20) NOT NULL,
    response_body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Primary key and unique constraints
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_webhook_logs_pkey'
    ) THEN
        ALTER TABLE ONLY public.whatsapp_webhook_logs ADD CONSTRAINT whatsapp_webhook_logs_pkey PRIMARY KEY (id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_webhook_logs_message_id_key'
    ) THEN
        ALTER TABLE ONLY public.whatsapp_webhook_logs ADD CONSTRAINT whatsapp_webhook_logs_message_id_key UNIQUE (message_id);
    END IF;
END $$;

-- Foreign key
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_webhook_logs_usuario_id_fkey'
    ) THEN
        ALTER TABLE ONLY public.whatsapp_webhook_logs
            ADD CONSTRAINT whatsapp_webhook_logs_usuario_id_fkey
            FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Drop old non-partial unique constraint if it exists, replace with partial index
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_whatsapp_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_whatsapp_phone_active
    ON public.usuarios (whatsapp_phone)
    WHERE deleted_at IS NULL AND whatsapp_phone IS NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_usuarios_whatsapp_phone
    ON public.usuarios (whatsapp_phone)
    WHERE whatsapp_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created
    ON public.whatsapp_webhook_logs (created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_phone
    ON public.whatsapp_webhook_logs (sender_phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status
    ON public.whatsapp_webhook_logs (status);

-- Config entries for whatsapp integration
INSERT INTO public.configuracion (clave, valor)
VALUES
    ('whatsapp_api_url', ''),
    ('whatsapp_api_key', ''),
    ('whatsapp_webhook_secret', ''),
    ('whatsapp_bot_phone', '')
ON CONFLICT (clave) DO NOTHING;
