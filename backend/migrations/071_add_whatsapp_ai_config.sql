-- Migración 071: Configuración de IA para el Agente WhatsApp
-- Up
INSERT INTO configuracion (clave, valor_texto) VALUES
    ('ia_proveedor', 'gemini'),
    ('ia_modelo', 'gemini-1.5-flash'),
    ('ia_api_url', ''),
    ('ia_api_key', '')
ON CONFLICT (clave) DO UPDATE SET 
    valor_texto = EXCLUDED.valor_texto;

-- Down
-- DELETE FROM configuracion WHERE clave IN ('ia_proveedor', 'ia_modelo', 'ia_api_url', 'ia_api_key');
