-- ============================================================
-- Migración 002: Datos iniciales (seed data)
-- Unidades de medida, áreas del laboratorio, usuario admin
-- ============================================================

-- =========================
-- Unidades de medida base
-- =========================
INSERT INTO unidades_medida (nombre, abreviatura) VALUES
    ('unidad', 'u'),
    ('mililitro', 'ml'),
    ('gramo', 'g'),
    ('prueba', 'test'),
    ('litro', 'L'),
    ('kilogramo', 'kg');

-- =========================
-- 12 Áreas del laboratorio
-- =========================
INSERT INTO areas (nombre, es_bodega) VALUES
    ('Microbiología', false),
    ('PCR', false),
    ('Orinas', false),
    ('Recepción', false),
    ('Laboratorio Central', false),
    ('Bodega Insumos', true),
    ('Bodega Reactivos', true),
    ('Serología', false),
    ('Unidad de Medicina Transfusional', false),
    ('Donantes', false),
    ('Sala Entrevista Donantes', false),
    ('Sala de Toma de Muestras', false);

-- =========================
-- Categorías iniciales
-- Tipo de elemento, independiente del área
-- =========================
INSERT INTO categorias (nombre, descripcion) VALUES
    ('Reactivo',            'Compuestos químicos para reacciones diagnósticas'),
    ('Consumible',          'Material de uso único: tubos, puntas, placas, lancetas, etc.'),
    ('Calibrador',          'Materiales de calibración de equipos analíticos'),
    ('Control',             'Sueros y materiales de control de calidad interno'),
    ('Kit diagnóstico',     'Kits completos para pruebas específicas'),
    ('Medio de cultivo',    'Medios sólidos y líquidos para microbiología'),
    ('Material de extracción', 'Tubos vacutainer, agujas, torniquetes'),
    ('Solución / Buffer',   'Diluyentes, soluciones de lavado y fijadores'),
    ('EPP',                 'Equipos de protección personal: guantes, mascarillas, lentes'),
    ('Papelería',           'Etiquetas, formularios y material administrativo');

-- =========================
-- Usuario admin inicial
-- No se crea un usuario admin con credenciales hardcodeadas.
-- Para inicializar un entorno, usar ALLOW_BOOTSTRAP_ADMIN=true junto con
-- SETUP_ADMIN_EMAIL y SETUP_ADMIN_PASSWORD solo durante el primer arranque.
-- =========================
