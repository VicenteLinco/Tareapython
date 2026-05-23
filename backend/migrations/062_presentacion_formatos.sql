CREATE TABLE presentacion_formatos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    nombre_plural VARCHAR(100) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    es_predefinido BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO presentacion_formatos (nombre, nombre_plural, es_predefinido) VALUES
    ('Ampolla', 'Ampollas', TRUE),
    ('Blister', 'Blisters', TRUE),
    ('Bolsa', 'Bolsas', TRUE),
    ('Botella', 'Botellas', TRUE),
    ('Caja', 'Cajas', TRUE),
    ('Frasco', 'Frascos', TRUE),
    ('Jeringa', 'Jeringas', TRUE),
    ('Kit', 'Kits', TRUE),
    ('Lata', 'Latas', TRUE),
    ('Paquete', 'Paquetes', TRUE),
    ('Rollo', 'Rollos', TRUE),
    ('Sobre', 'Sobres', TRUE),
    ('Tubo', 'Tubos', TRUE),
    ('Unidad', 'Unidades', TRUE)
ON CONFLICT (nombre) DO NOTHING;
