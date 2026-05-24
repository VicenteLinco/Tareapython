-- ============================================================
-- SEED DEMO: 10 productos ficticios para evaluación
-- Limpia datos transaccionales, conserva áreas/categorías/usuarios
-- ============================================================

BEGIN;

-- ============================================================
-- 1. LIMPIAR DATOS TRANSACCIONALES
--    (conservar: areas, categorias, unidades_medida, usuarios)
-- ============================================================

-- Tablas dependientes primero
TRUNCATE TABLE recepcion_detalle CASCADE;
TRUNCATE TABLE recepciones CASCADE;
TRUNCATE TABLE movimientos CASCADE;
TRUNCATE TABLE stock CASCADE;
TRUNCATE TABLE lotes CASCADE;
TRUNCATE TABLE producto_area CASCADE;
TRUNCATE TABLE presentaciones CASCADE;
TRUNCATE TABLE productos CASCADE;
TRUNCATE TABLE proveedores CASCADE;
TRUNCATE TABLE audit_log CASCADE;
TRUNCATE TABLE idempotency_keys CASCADE;

-- Tablas de otros módulos
TRUNCATE TABLE solicitudes_compra CASCADE;
TRUNCATE TABLE sesiones_conteo CASCADE;

-- Reset de secuencias documentales
ALTER SEQUENCE seq_mov_numero RESTART WITH 1;
ALTER SEQUENCE seq_rec_numero RESTART WITH 1;
ALTER SEQUENCE seq_prd_numero RESTART WITH 1;
ALTER SEQUENCE seq_lot_numero RESTART WITH 1;

-- ============================================================
-- 2. PROVEEDORES
-- ============================================================
INSERT INTO proveedores (nombre, contacto, telefono, email, activa) VALUES
    ('Biolab Ltda.',         'Carlos Mendoza',    '+56 2 2345 6789', 'ventas@biolab.cl',       true),
    ('MedSupply S.A.',       'Ana Rojas',         '+56 2 3456 7890', 'contacto@medsupply.cl',  true),
    ('LabChem Chile',        'Pedro Fuentes',     '+56 2 4567 8901', 'pedidos@labchem.cl',     true),
    ('Diagnomed S.A.',       'Sofía Castro',      '+56 2 5678 9012', 'comercial@diagnomed.cl', true),
    ('Global Medical Ltda.', 'Jorge Alvarado',    '+56 2 6789 0123', 'ventas@globalmed.cl',    true);

-- ============================================================
-- 3. PRODUCTOS (10 insumos ficticios de laboratorio clínico)
-- ============================================================
INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo, activo) VALUES
    (gen_random_uuid(), generar_codigo_producto(), 'Guantes de nitrilo talla M',
        'Guantes sin polvo, ambidiestros, caja x100',
        (SELECT id FROM categorias WHERE nombre = 'EPP'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'unidad'), 200, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Puntillas azules 1000 µL',
        'Puntas desechables para micropipetas, gradilla x96',
        (SELECT id FROM categorias WHERE nombre = 'Consumible'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'unidad'), 500, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Kit ELISA VIH Combo Ag/Ac',
        'Kit de detección de VIH antígeno/anticuerpo, 96 determinaciones',
        (SELECT id FROM categorias WHERE nombre = 'Kit diagnóstico'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'prueba'), 20, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Agar sangre Columbia',
        'Medio de cultivo enriquecido para aislamiento de microorganismos, 20 placas',
        (SELECT id FROM categorias WHERE nombre = 'Medio de cultivo'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'unidad'), 40, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Suero control bioquímica nivel 1',
        'Material de control de calidad interno para química clínica',
        (SELECT id FROM categorias WHERE nombre = 'Control'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'mililitro'), 50, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Tubos vacutainer EDTA 4 mL',
        'Tubo tapa lila para hematología, caja x100',
        (SELECT id FROM categorias WHERE nombre = 'Material de extracción'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'unidad'), 100, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Alcohol isopropílico 70%',
        'Solución desinfectante para superficies y equipos, bidón 5L',
        (SELECT id FROM categorias WHERE nombre = 'Solución / Buffer'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'mililitro'), 5000, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Mascarilla respiratoria N95',
        'Protección respiratoria certificada, caja x20',
        (SELECT id FROM categorias WHERE nombre = 'EPP'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'unidad'), 60, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Tiras reactivas para orina Combur-10',
        'Análisis de 10 parámetros en orina, frasco x100 tiras',
        (SELECT id FROM categorias WHERE nombre = 'Reactivo'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'prueba'), 100, true),

    (gen_random_uuid(), generar_codigo_producto(), 'Solución salina estéril 0.9% 500 mL',
        'Suero fisiológico para diluciones y lavados, frasco 500 mL',
        (SELECT id FROM categorias WHERE nombre = 'Solución / Buffer'),
        (SELECT id FROM unidades_basicas WHERE nombre = 'mililitro'), 2000, true);

-- ============================================================
-- 4. PRESENTACIONES (una por producto)
-- ============================================================

-- Guantes nitrilo → caja x100
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'caja x100', 'cajas x100', 100, true FROM productos WHERE nombre = 'Guantes de nitrilo talla M';

-- Puntillas → gradilla x96
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'gradilla x96', 'gradillas x96', 96, true FROM productos WHERE nombre = 'Puntillas azules 1000 µL';

-- Kit ELISA → kit x96 determinaciones
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'kit x96', 'kits x96', 96, true FROM productos WHERE nombre = 'Kit ELISA VIH Combo Ag/Ac';

-- Agar sangre → bolsa x20 placas
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'bolsa x20', 'bolsas x20', 20, true FROM productos WHERE nombre = 'Agar sangre Columbia';

-- Suero control → vial 5mL
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'vial 5 mL', 'viales 5 mL', 5, true FROM productos WHERE nombre = 'Suero control bioquímica nivel 1';

-- Tubos vacutainer → caja x100
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'caja x100', 'cajas x100', 100, true FROM productos WHERE nombre = 'Tubos vacutainer EDTA 4 mL';

-- Alcohol → bidón 5L = 5000 mL
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'bidón 5 L', 'bidones 5 L', 5000, true FROM productos WHERE nombre = 'Alcohol isopropílico 70%';

-- Mascarilla N95 → caja x20
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'caja x20', 'cajas x20', 20, true FROM productos WHERE nombre = 'Mascarilla respiratoria N95';

-- Tiras reactivas → frasco x100
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'frasco x100', 'frascos x100', 100, true FROM productos WHERE nombre = 'Tiras reactivas para orina Combur-10';

-- Solución salina → frasco 500 mL
INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa)
SELECT id, 'frasco 500 mL', 'frascos 500 mL', 500, true FROM productos WHERE nombre = 'Solución salina estéril 0.9% 500 mL';

-- ============================================================
-- 5. PRODUCTO-ÁREA (asignar a bodega principal + 2 áreas)
-- ============================================================
INSERT INTO producto_area (producto_id, area_id)
SELECT p.id, a.id
FROM productos p, areas a
WHERE a.nombre IN ('Bodega Insumos', 'Laboratorio Central', 'Microbiología');

-- También asignar algunos a áreas específicas
INSERT INTO producto_area (producto_id, area_id)
SELECT p.id, a.id
FROM productos p, areas a
WHERE p.nombre IN ('Kit ELISA VIH Combo Ag/Ac', 'Suero control bioquímica nivel 1')
  AND a.nombre = 'Serología'
ON CONFLICT (producto_id, area_id) DO NOTHING;

INSERT INTO producto_area (producto_id, area_id)
SELECT p.id, a.id
FROM productos p, areas a
WHERE p.nombre = 'Tiras reactivas para orina Combur-10'
  AND a.nombre = 'Orinas'
ON CONFLICT (producto_id, area_id) DO NOTHING;

-- ============================================================
-- 6. LOTES (2 lotes por producto — para simular FEFO)
-- ============================================================

-- Guantes nitrilo — lote A (vence en 18 meses) y lote B (vence en 24 meses)
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Global Medical Ltda.'),
       'GL-2024-A01', '2027-03-01',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00001', 85.00
FROM productos p WHERE p.nombre = 'Guantes de nitrilo talla M';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Global Medical Ltda.'),
       'GL-2024-B02', '2027-09-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00002', 82.00
FROM productos p WHERE p.nombre = 'Guantes de nitrilo talla M';

-- Puntillas
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'MedSupply S.A.'),
       'PP-2024-001', '2028-06-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00003', 12.50
FROM productos p WHERE p.nombre = 'Puntillas azules 1000 µL';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'MedSupply S.A.'),
       'PP-2024-002', '2028-12-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00004', 12.00
FROM productos p WHERE p.nombre = 'Puntillas azules 1000 µL';

-- Kit ELISA VIH
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Diagnomed S.A.'),
       'KE-2024-A10', '2025-12-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00005', 18500.00
FROM productos p WHERE p.nombre = 'Kit ELISA VIH Combo Ag/Ac';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Diagnomed S.A.'),
       'KE-2024-A11', '2026-06-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00006', 18200.00
FROM productos p WHERE p.nombre = 'Kit ELISA VIH Combo Ag/Ac';

-- Agar sangre Columbia
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Biolab Ltda.'),
       'AG-2024-M01', '2025-08-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00007', 320.00
FROM productos p WHERE p.nombre = 'Agar sangre Columbia';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Biolab Ltda.'),
       'AG-2024-M02', '2025-11-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00008', 310.00
FROM productos p WHERE p.nombre = 'Agar sangre Columbia';

-- Suero control bioquímica
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'LabChem Chile'),
       'SC-2024-C01', '2025-10-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00009', 45000.00
FROM productos p WHERE p.nombre = 'Suero control bioquímica nivel 1';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'LabChem Chile'),
       'SC-2024-C02', '2026-04-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00010', 44000.00
FROM productos p WHERE p.nombre = 'Suero control bioquímica nivel 1';

-- Tubos vacutainer EDTA
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Global Medical Ltda.'),
       'TV-2024-E01', '2027-01-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00011', 28.00
FROM productos p WHERE p.nombre = 'Tubos vacutainer EDTA 4 mL';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Global Medical Ltda.'),
       'TV-2024-E02', '2027-07-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00012', 27.00
FROM productos p WHERE p.nombre = 'Tubos vacutainer EDTA 4 mL';

-- Alcohol isopropílico
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'LabChem Chile'),
       'AL-2024-Q01', '2026-09-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00013', 1.80
FROM productos p WHERE p.nombre = 'Alcohol isopropílico 70%';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'LabChem Chile'),
       'AL-2024-Q02', '2027-03-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00014', 1.75
FROM productos p WHERE p.nombre = 'Alcohol isopropílico 70%';

-- Mascarillas N95
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'MedSupply S.A.'),
       'MN-2024-R01', '2028-03-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00015', 3200.00
FROM productos p WHERE p.nombre = 'Mascarilla respiratoria N95';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'MedSupply S.A.'),
       'MN-2024-R02', '2028-09-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00016', 3100.00
FROM productos p WHERE p.nombre = 'Mascarilla respiratoria N95';

-- Tiras reactivas orina
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Biolab Ltda.'),
       'TR-2024-U01', '2025-09-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00017', 120.00
FROM productos p WHERE p.nombre = 'Tiras reactivas para orina Combur-10';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'Biolab Ltda.'),
       'TR-2024-U02', '2026-03-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00018', 115.00
FROM productos p WHERE p.nombre = 'Tiras reactivas para orina Combur-10';

-- Solución salina
INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'LabChem Chile'),
       'SS-2024-F01', '2026-12-31',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00019', 1.20
FROM productos p WHERE p.nombre = 'Solución salina estéril 0.9% 500 mL';

INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
SELECT gen_random_uuid(), p.id,
       (SELECT id FROM proveedores WHERE nombre = 'LabChem Chile'),
       'SS-2024-F02', '2027-06-30',
       'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-00020', 1.15
FROM productos p WHERE p.nombre = 'Solución salina estéril 0.9% 500 mL';

-- ============================================================
-- 7. RECEPCIONES (una por proveedor/grupo de productos)
-- ============================================================
-- Admin user ID
DO $$
DECLARE
    v_admin_id UUID;
    v_area_bodega_id INT;
    v_prov_global INT;
    v_prov_medsupply INT;
    v_prov_labchem INT;
    v_prov_diagnomed INT;
    v_prov_biolab INT;
    v_rec1_id UUID;
    v_rec2_id UUID;
    v_rec3_id UUID;
    v_rec4_id UUID;
    v_rec5_id UUID;
BEGIN
    SELECT id INTO v_admin_id FROM usuarios WHERE rol = 'admin' AND activo = true ORDER BY created_at LIMIT 1;
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'seed_demo requiere un usuario admin activo. Ejecuta el bootstrap admin antes de cargar datos demo.';
    END IF;
    SELECT id INTO v_area_bodega_id FROM areas WHERE nombre = 'Bodega Insumos';
    SELECT id INTO v_prov_global FROM proveedores WHERE nombre = 'Global Medical Ltda.';
    SELECT id INTO v_prov_medsupply FROM proveedores WHERE nombre = 'MedSupply S.A.';
    SELECT id INTO v_prov_labchem FROM proveedores WHERE nombre = 'LabChem Chile';
    SELECT id INTO v_prov_diagnomed FROM proveedores WHERE nombre = 'Diagnomed S.A.';
    SELECT id INTO v_prov_biolab FROM proveedores WHERE nombre = 'Biolab Ltda.';

    -- -------------------------------------------------------
    -- Recepción 1: Global Medical (Guantes + Tubos vacutainer)
    -- -------------------------------------------------------
    v_rec1_id := gen_random_uuid();
    INSERT INTO recepciones (id, proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
    VALUES (v_rec1_id, v_prov_global, 'GDM-2024-0891', 'completa', NOW() - INTERVAL '20 days', v_admin_id,
            'Recepción de EPP y material de extracción. Sin observaciones.');

    -- Lote A de guantes — 5 cajas x100 = 500 unidades
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec1_id, p.id, l.id, pr.id, v_area_bodega_id,
           5, pr.factor_conversion, 5 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'GL-2024-A01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Guantes de nitrilo talla M';

    -- Lote B de guantes — 3 cajas x100 = 300 unidades
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec1_id, p.id, l.id, pr.id, v_area_bodega_id,
           3, pr.factor_conversion, 3 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'GL-2024-B02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Guantes de nitrilo talla M';

    -- Tubos vacutainer lote E01 — 8 cajas x100 = 800 unidades
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec1_id, p.id, l.id, pr.id, v_area_bodega_id,
           8, pr.factor_conversion, 8 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'TV-2024-E01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Tubos vacutainer EDTA 4 mL';

    -- Tubos vacutainer lote E02 — 4 cajas x100 = 400 unidades
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec1_id, p.id, l.id, pr.id, v_area_bodega_id,
           4, pr.factor_conversion, 4 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'TV-2024-E02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Tubos vacutainer EDTA 4 mL';

    -- Movimientos INGRESO para Recepción 1
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 500, 0, v_admin_id,
           'Recepción REC-000001 — Guantes nitrilo lote A', NOW() - INTERVAL '20 days'
    FROM lotes l WHERE l.numero_lote = 'GL-2024-A01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 300, 0, v_admin_id,
           'Recepción REC-000001 — Guantes nitrilo lote B', NOW() - INTERVAL '20 days'
    FROM lotes l WHERE l.numero_lote = 'GL-2024-B02';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 800, 0, v_admin_id,
           'Recepción REC-000001 — Tubos EDTA lote E01', NOW() - INTERVAL '20 days'
    FROM lotes l WHERE l.numero_lote = 'TV-2024-E01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 400, 0, v_admin_id,
           'Recepción REC-000001 — Tubos EDTA lote E02', NOW() - INTERVAL '20 days'
    FROM lotes l WHERE l.numero_lote = 'TV-2024-E02';

    -- -------------------------------------------------------
    -- Recepción 2: MedSupply (Puntillas + Mascarillas)
    -- -------------------------------------------------------
    v_rec2_id := gen_random_uuid();
    INSERT INTO recepciones (id, proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
    VALUES (v_rec2_id, v_prov_medsupply, 'MSP-2024-1205', 'completa', NOW() - INTERVAL '15 days', v_admin_id,
            'Recepción puntillas y mascarillas. Guía correcta.');

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec2_id, p.id, l.id, pr.id, v_area_bodega_id,
           10, pr.factor_conversion, 10 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'PP-2024-001'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Puntillas azules 1000 µL';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec2_id, p.id, l.id, pr.id, v_area_bodega_id,
           6, pr.factor_conversion, 6 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'PP-2024-002'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Puntillas azules 1000 µL';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec2_id, p.id, l.id, pr.id, v_area_bodega_id,
           5, pr.factor_conversion, 5 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'MN-2024-R01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Mascarilla respiratoria N95';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec2_id, p.id, l.id, pr.id, v_area_bodega_id,
           3, pr.factor_conversion, 3 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'MN-2024-R02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Mascarilla respiratoria N95';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 960, 0, v_admin_id,
           'Recepción REC-000002 — Puntillas lote 001', NOW() - INTERVAL '15 days'
    FROM lotes l WHERE l.numero_lote = 'PP-2024-001';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 576, 0, v_admin_id,
           'Recepción REC-000002 — Puntillas lote 002', NOW() - INTERVAL '15 days'
    FROM lotes l WHERE l.numero_lote = 'PP-2024-002';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 100, 0, v_admin_id,
           'Recepción REC-000002 — Mascarillas N95 lote R01', NOW() - INTERVAL '15 days'
    FROM lotes l WHERE l.numero_lote = 'MN-2024-R01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 60, 0, v_admin_id,
           'Recepción REC-000002 — Mascarillas N95 lote R02', NOW() - INTERVAL '15 days'
    FROM lotes l WHERE l.numero_lote = 'MN-2024-R02';

    -- -------------------------------------------------------
    -- Recepción 3: LabChem (Alcohol + Suero control + Solución salina)
    -- -------------------------------------------------------
    v_rec3_id := gen_random_uuid();
    INSERT INTO recepciones (id, proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
    VALUES (v_rec3_id, v_prov_labchem, 'LCH-2024-3309', 'completa', NOW() - INTERVAL '10 days', v_admin_id,
            'Reactivos y soluciones. Todo en orden.');

    -- Alcohol lote Q01 — 4 bidones = 20000 mL
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec3_id, p.id, l.id, pr.id, v_area_bodega_id,
           4, pr.factor_conversion, 4 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'AL-2024-Q01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Alcohol isopropílico 70%';

    -- Alcohol lote Q02 — 2 bidones = 10000 mL
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec3_id, p.id, l.id, pr.id, v_area_bodega_id,
           2, pr.factor_conversion, 2 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'AL-2024-Q02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Alcohol isopropílico 70%';

    -- Suero control lote C01 — 10 viales = 50 mL
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec3_id, p.id, l.id, pr.id, v_area_bodega_id,
           10, pr.factor_conversion, 10 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'SC-2024-C01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Suero control bioquímica nivel 1';

    -- Suero control lote C02 — 6 viales = 30 mL
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec3_id, p.id, l.id, pr.id, v_area_bodega_id,
           6, pr.factor_conversion, 6 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'SC-2024-C02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Suero control bioquímica nivel 1';

    -- Solución salina lote F01 — 20 frascos = 10000 mL
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec3_id, p.id, l.id, pr.id, v_area_bodega_id,
           20, pr.factor_conversion, 20 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'SS-2024-F01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Solución salina estéril 0.9% 500 mL';

    -- Solución salina lote F02 — 10 frascos = 5000 mL
    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec3_id, p.id, l.id, pr.id, v_area_bodega_id,
           10, pr.factor_conversion, 10 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'SS-2024-F02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Solución salina estéril 0.9% 500 mL';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 20000, 0, v_admin_id,
           'Recepción REC-000003 — Alcohol isopropílico lote Q01', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'AL-2024-Q01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 10000, 0, v_admin_id,
           'Recepción REC-000003 — Alcohol isopropílico lote Q02', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'AL-2024-Q02';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 50, 0, v_admin_id,
           'Recepción REC-000003 — Suero control lote C01', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'SC-2024-C01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 30, 0, v_admin_id,
           'Recepción REC-000003 — Suero control lote C02', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'SC-2024-C02';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 10000, 0, v_admin_id,
           'Recepción REC-000003 — Solución salina lote F01', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'SS-2024-F01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 5000, 0, v_admin_id,
           'Recepción REC-000003 — Solución salina lote F02', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'SS-2024-F02';

    -- -------------------------------------------------------
    -- Recepción 4: Diagnomed (Kit ELISA VIH)
    -- -------------------------------------------------------
    v_rec4_id := gen_random_uuid();
    INSERT INTO recepciones (id, proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
    VALUES (v_rec4_id, v_prov_diagnomed, 'DGM-2024-0078', 'completa', NOW() - INTERVAL '7 days', v_admin_id,
            'Kits diagnósticos cadena de frío verificada. Temperatura correcta.');

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec4_id, p.id, l.id, pr.id, v_area_bodega_id,
           4, pr.factor_conversion, 4 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'KE-2024-A10'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Kit ELISA VIH Combo Ag/Ac';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec4_id, p.id, l.id, pr.id, v_area_bodega_id,
           4, pr.factor_conversion, 4 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'KE-2024-A11'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Kit ELISA VIH Combo Ag/Ac';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 384, 0, v_admin_id,
           'Recepción REC-000004 — Kit ELISA VIH lote A10', NOW() - INTERVAL '7 days'
    FROM lotes l WHERE l.numero_lote = 'KE-2024-A10';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 384, 0, v_admin_id,
           'Recepción REC-000004 — Kit ELISA VIH lote A11', NOW() - INTERVAL '7 days'
    FROM lotes l WHERE l.numero_lote = 'KE-2024-A11';

    -- -------------------------------------------------------
    -- Recepción 5: Biolab (Agar sangre + Tiras reactivas orina)
    -- -------------------------------------------------------
    v_rec5_id := gen_random_uuid();
    INSERT INTO recepciones (id, proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
    VALUES (v_rec5_id, v_prov_biolab, 'BLB-2024-2231', 'completa', NOW() - INTERVAL '5 days', v_admin_id,
            'Medios de cultivo y reactivos de uroanálisis.');

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec5_id, p.id, l.id, pr.id, v_area_bodega_id,
           6, pr.factor_conversion, 6 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'AG-2024-M01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Agar sangre Columbia';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec5_id, p.id, l.id, pr.id, v_area_bodega_id,
           4, pr.factor_conversion, 4 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'AG-2024-M02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Agar sangre Columbia';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec5_id, p.id, l.id, pr.id, v_area_bodega_id,
           8, pr.factor_conversion, 8 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'TR-2024-U01'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Tiras reactivas para orina Combur-10';

    INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
        cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
    SELECT v_rec5_id, p.id, l.id, pr.id, v_area_bodega_id,
           5, pr.factor_conversion, 5 * pr.factor_conversion, l.costo_unitario
    FROM productos p
    JOIN lotes l ON l.producto_id = p.id AND l.numero_lote = 'TR-2024-U02'
    JOIN presentaciones pr ON pr.producto_id = p.id
    WHERE p.nombre = 'Tiras reactivas para orina Combur-10';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 120, 0, v_admin_id,
           'Recepción REC-000005 — Agar sangre lote M01', NOW() - INTERVAL '5 days'
    FROM lotes l WHERE l.numero_lote = 'AG-2024-M01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 80, 0, v_admin_id,
           'Recepción REC-000005 — Agar sangre lote M02', NOW() - INTERVAL '5 days'
    FROM lotes l WHERE l.numero_lote = 'AG-2024-M02';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 800, 0, v_admin_id,
           'Recepción REC-000005 — Tiras orina lote U01', NOW() - INTERVAL '5 days'
    FROM lotes l WHERE l.numero_lote = 'TR-2024-U01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'INGRESO', 500, 0, v_admin_id,
           'Recepción REC-000005 — Tiras orina lote U02', NOW() - INTERVAL '5 days'
    FROM lotes l WHERE l.numero_lote = 'TR-2024-U02';

    -- ============================================================
    -- 8. CONSUMOS (egresos de los últimos días)
    --    FEFO: siempre consume el lote con vencimiento más próximo
    -- ============================================================

    -- Guantes nitrilo — consumo desde Bodega hacia Lab Central
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 150, 0, v_admin_id,
           'Consumo semanal EPP — Bodega Insumos', NOW() - INTERVAL '14 days'
    FROM lotes l WHERE l.numero_lote = 'GL-2024-A01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 80, 0, v_admin_id,
           'Consumo semanal EPP — semana 2', NOW() - INTERVAL '7 days'
    FROM lotes l WHERE l.numero_lote = 'GL-2024-A01';

    -- Puntillas — consumo Lab Central
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 288, 0, v_admin_id,
           'Consumo puntillas — Lab Central semana 1', NOW() - INTERVAL '12 days'
    FROM lotes l WHERE l.numero_lote = 'PP-2024-001';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 192, 0, v_admin_id,
           'Consumo puntillas — Lab Central semana 2', NOW() - INTERVAL '5 days'
    FROM lotes l WHERE l.numero_lote = 'PP-2024-001';

    -- Kit ELISA VIH — consumo Serología (FEFO: lote A10 primero)
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 96, 0, v_admin_id,
           'Tamizaje VIH — corrida semana anterior', NOW() - INTERVAL '6 days'
    FROM lotes l WHERE l.numero_lote = 'KE-2024-A10';

    -- Agar sangre — consumo Microbiología (FEFO: lote M01 primero)
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 60, 0, v_admin_id,
           'Cultivos rutinarios microbiología', NOW() - INTERVAL '4 days'
    FROM lotes l WHERE l.numero_lote = 'AG-2024-M01';

    -- Suero control — consumo diario Lab Central
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 15, 0, v_admin_id,
           'Control calidad diario — semana 1', NOW() - INTERVAL '10 days'
    FROM lotes l WHERE l.numero_lote = 'SC-2024-C01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 10, 0, v_admin_id,
           'Control calidad diario — semana 2', NOW() - INTERVAL '3 days'
    FROM lotes l WHERE l.numero_lote = 'SC-2024-C01';

    -- Tubos vacutainer — consumo Recepción
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 300, 0, v_admin_id,
           'Tubos hematología — semana 1', NOW() - INTERVAL '18 days'
    FROM lotes l WHERE l.numero_lote = 'TV-2024-E01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 250, 0, v_admin_id,
           'Tubos hematología — semana 2', NOW() - INTERVAL '11 days'
    FROM lotes l WHERE l.numero_lote = 'TV-2024-E01';

    -- Alcohol isopropílico — consumo general
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 5000, 0, v_admin_id,
           'Desinfección superficies — semana 1', NOW() - INTERVAL '9 days'
    FROM lotes l WHERE l.numero_lote = 'AL-2024-Q01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 3000, 0, v_admin_id,
           'Desinfección superficies — semana 2', NOW() - INTERVAL '2 days'
    FROM lotes l WHERE l.numero_lote = 'AL-2024-Q01';

    -- Mascarillas N95 — consumo EPP
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 40, 0, v_admin_id,
           'Entrega EPP — personal laboratorio', NOW() - INTERVAL '13 days'
    FROM lotes l WHERE l.numero_lote = 'MN-2024-R01';

    -- Tiras reactivas orina — consumo Orinas
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 250, 0, v_admin_id,
           'Uroanálisis rutinario — semana 1', NOW() - INTERVAL '4 days'
    FROM lotes l WHERE l.numero_lote = 'TR-2024-U01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 150, 0, v_admin_id,
           'Uroanálisis rutinario — semana 2', NOW() - INTERVAL '1 day'
    FROM lotes l WHERE l.numero_lote = 'TR-2024-U01';

    -- Solución salina — consumo Lab Central
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 2500, 0, v_admin_id,
           'Diluciones y lavados — semana 1', NOW() - INTERVAL '8 days'
    FROM lotes l WHERE l.numero_lote = 'SS-2024-F01';

    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, nota, created_at)
    SELECT l.id, v_area_bodega_id, 'CONSUMO', 1500, 0, v_admin_id,
           'Diluciones y lavados — semana 2', NOW() - INTERVAL '1 day'
    FROM lotes l WHERE l.numero_lote = 'SS-2024-F01';

END $$;

COMMIT;

-- ============================================================
-- RESUMEN FINAL
-- ============================================================
SELECT
    'Proveedores'   AS tabla, COUNT(*) AS total FROM proveedores
UNION ALL SELECT 'Productos',     COUNT(*) FROM productos
UNION ALL SELECT 'Presentaciones',COUNT(*) FROM presentaciones
UNION ALL SELECT 'Lotes',         COUNT(*) FROM lotes
UNION ALL SELECT 'Recepciones',   COUNT(*) FROM recepciones
UNION ALL SELECT 'Movimientos',   COUNT(*) FROM movimientos
UNION ALL SELECT 'Stock (filas)', COUNT(*) FROM stock
ORDER BY tabla;
