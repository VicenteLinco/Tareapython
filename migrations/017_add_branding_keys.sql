-- Agrega claves de personalización de branding: favicon y color de fondo del login.
-- Idempotent: seguro de re-ejecutar.

INSERT INTO configuracion (clave, valor_texto)
VALUES ('favicon_base64', ''), ('login_bg_color', '')
ON CONFLICT (clave) DO NOTHING;
