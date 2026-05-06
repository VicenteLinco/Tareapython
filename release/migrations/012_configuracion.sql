CREATE TABLE IF NOT EXISTS configuracion (
    clave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL DEFAULT ''
);

INSERT INTO configuracion (clave, valor) VALUES
    ('nombre_laboratorio', 'Laboratorio Clínico'),
    ('logo_base64', '')
ON CONFLICT DO NOTHING;
