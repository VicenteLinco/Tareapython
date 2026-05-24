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
-- Contraseña: Admin123!
-- Hash Argon2 de "Admin123!"
-- =========================
-- NOTA: Este hash se debe regenerar en producción.
-- El hash de abajo corresponde a "Admin123!" con Argon2id.
-- En el primer login, se debe cambiar la contraseña.
INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
    ('Administrador', 'admin@laboratorio.cl', '$argon2id$v=19$m=19456,t=2,p=1$ohcOafUCERxCN4F0deHevg$hJNh8rweQwOhkhcc6E6KzmAPXdNZOtB34618gb16d40', 'admin');

-- Dar acceso al admin a todas las áreas
INSERT INTO usuario_area (usuario_id, area_id)
SELECT u.id, a.id
FROM usuarios u, areas a
WHERE u.email = 'admin@laboratorio.cl';

