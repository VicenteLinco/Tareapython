BEGIN;
-- Limpiar tablas transaccionales
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
TRUNCATE TABLE solicitudes_compra CASCADE;
TRUNCATE TABLE sesiones_conteo CASCADE;
ALTER SEQUENCE seq_mov_numero RESTART WITH 1;
ALTER SEQUENCE seq_rec_numero RESTART WITH 1;
ALTER SEQUENCE seq_prd_numero RESTART WITH 1;
ALTER SEQUENCE seq_lot_numero RESTART WITH 1;
-- Seed base metadata

INSERT INTO unidades_basicas (id, nombre, nombre_plural, categoria) VALUES
    (1, 'unidad', 'unidades', 'count'),
    (2, 'mililitro', 'mililitros', 'volume'),
    (3, 'gramo', 'gramos', 'weight'),
    (4, 'prueba', 'pruebas', 'count')
ON CONFLICT (id) DO NOTHING;

INSERT INTO areas (id, nombre, es_bodega) VALUES
    (1, 'Microbiología', false),
    (2, 'PCR', false),
    (3, 'Orinas', false),
    (4, 'Recepción', false),
    (5, 'Laboratorio Central', false),
    (6, 'Bodega Insumos', true),
    (7, 'Bodega Reactivos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorias (id, nombre, descripcion) VALUES
    (1, 'Reactivo', 'Compuestos químicos para reacciones diagnósticas'),
    (2, 'Consumible', 'Material de uso único: tubos, puntas, placas, lancetas'),
    (3, 'Calibrador', 'Materiales de calibración de equipos analíticos'),
    (4, 'Control', 'Sueros y materiales de control de calidad interno'),
    (5, 'Kit diagnóstico', 'Kits completos para pruebas específicas'),
    (6, 'Medio de cultivo', 'Medios sólidos y líquidos para microbiología'),
    (7, 'Material de extracción', 'Tubos vacutainer, agujas, torniquetes'),
    (8, 'Solución / Buffer', 'Diluyentes, soluciones de lavado y fijadores'),
    (9, 'EPP', 'Equipos de protección personal: guantes, mascarillas, lentes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO proveedores (id, nombre, contacto, telefono, email, activa) VALUES (1, 'Global Lab Supplies', 'Ana Rojas', '+56223456789', 'ventas@globallab.cl', true);
DO $$
DECLARE
    v_user_id uuid;
BEGIN
    SELECT id INTO v_user_id FROM usuarios WHERE email = 'admin@lab.cl' LIMIT 1;
    -- Producto: Guantes de Nitrilo [Alerta: Agotado]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('cce119de-0e11-4fb0-9919-09612f5fb451', generar_codigo_producto(), 'Guantes de Nitrilo [Alerta: Agotado]', 'Guantes descartables sin polvo talla M', 9, 1, 50.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('cce119de-0e11-4fb0-9919-09612f5fb451', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('cce119de-0e11-4fb0-9919-09612f5fb451', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('cce119de-0e11-4fb0-9919-09612f5fb451', 1); -- Microbiologia / Lab
    -- Producto: Tubos al Vacío EDTA [Alerta: Stock Crítico]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('b63ec01d-f533-4f82-86a3-492ded235a0b', generar_codigo_producto(), 'Tubos al Vacío EDTA [Alerta: Stock Crítico]', 'Tubos de extracción de tapa lila 4 mL', 7, 1, 100.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('b63ec01d-f533-4f82-86a3-492ded235a0b', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('b63ec01d-f533-4f82-86a3-492ded235a0b', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('b63ec01d-f533-4f82-86a3-492ded235a0b', 1); -- Microbiologia / Lab
    -- Producto: Reactivo PCR Ampli-Kit [Alerta: Stock Bajo / Reponer]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('e00cd17d-9bda-44e4-806a-e5f88f802905', generar_codigo_producto(), 'Reactivo PCR Ampli-Kit [Alerta: Stock Bajo / Reponer]', 'Reactivo de PCR multiplex para patógenos respiratorios', 5, 4, 100.0, 'trazable', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('e00cd17d-9bda-44e4-806a-e5f88f802905', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('e00cd17d-9bda-44e4-806a-e5f88f802905', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('e00cd17d-9bda-44e4-806a-e5f88f802905', 1); -- Microbiologia / Lab
    -- Producto: Placas de Agar Sangre Columbia [Alerta: Vencido]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('b7d5833a-5d60-4508-ba9c-78a8c2b30812', generar_codigo_producto(), 'Placas de Agar Sangre Columbia [Alerta: Vencido]', 'Placas preparadas para microbiología', 6, 1, 20.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('b7d5833a-5d60-4508-ba9c-78a8c2b30812', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('b7d5833a-5d60-4508-ba9c-78a8c2b30812', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('b7d5833a-5d60-4508-ba9c-78a8c2b30812', 1); -- Microbiologia / Lab
    -- Producto: Suero Fisiológico 500 mL [Alerta: Por Vencer]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('0340f901-6915-473f-a624-6a3a4f27b4f9', generar_codigo_producto(), 'Suero Fisiológico 500 mL [Alerta: Por Vencer]', 'Solución fisiológica estéril', 8, 1, 50.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('0340f901-6915-473f-a624-6a3a4f27b4f9', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('0340f901-6915-473f-a624-6a3a4f27b4f9', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('0340f901-6915-473f-a624-6a3a4f27b4f9', 1); -- Microbiologia / Lab
    -- Producto: Puntas de Pipeta 1000uL [Alerta: Riesgo Vencimiento]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('3ec4bef2-1bff-4f14-8728-eb7af4508953', generar_codigo_producto(), 'Puntas de Pipeta 1000uL [Alerta: Riesgo Vencimiento]', 'Puntas desechables con filtro en gradilla', 2, 1, 100.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('3ec4bef2-1bff-4f14-8728-eb7af4508953', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('3ec4bef2-1bff-4f14-8728-eb7af4508953', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('3ec4bef2-1bff-4f14-8728-eb7af4508953', 1); -- Microbiologia / Lab
    -- Producto: Alcohol Isopropílico 70% [Alerta: Crítico + Por Vencer]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('548022cb-b0cd-4e93-b647-2950e7065bfd', generar_codigo_producto(), 'Alcohol Isopropílico 70% [Alerta: Crítico + Por Vencer]', 'Solución desinfectante en bidón de 5L', 8, 1, 200.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('548022cb-b0cd-4e93-b647-2950e7065bfd', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('548022cb-b0cd-4e93-b647-2950e7065bfd', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('548022cb-b0cd-4e93-b647-2950e7065bfd', 1); -- Microbiologia / Lab
    -- Producto: Puntas Amarillas 200uL [Sin Alerta: Normal]
    INSERT INTO productos (id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo_global, control_lote, activo)
    VALUES ('4c0f3b83-34c3-40d8-9d2d-add62858b1b5', generar_codigo_producto(), 'Puntas Amarillas 200uL [Sin Alerta: Normal]', 'Puntas de micropipeta estándar', 2, 1, 10.0, 'con_vto', true);
    INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion)
    VALUES ('4c0f3b83-34c3-40d8-9d2d-add62858b1b5', 'Unidad', 'Unidades', 1.0);
    INSERT INTO producto_area (producto_id, area_id) VALUES ('4c0f3b83-34c3-40d8-9d2d-add62858b1b5', 6); -- Bodega Insumos
    INSERT INTO producto_area (producto_id, area_id) VALUES ('4c0f3b83-34c3-40d8-9d2d-add62858b1b5', 1); -- Microbiologia / Lab
    -- Lote para Guantes de Nitrilo [Alerta: Agotado]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 'cce119de-0e11-4fb0-9919-09612f5fb451', 1, 'LOT-93810', '2027-11-30', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CARGA_INICIAL', 500, 500, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 492, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 484, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 476, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 468, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 460, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 452, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 444, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 436, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 428, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 420, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'INGRESO', 200, 620, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 612, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 604, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 596, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 588, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 580, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 572, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 564, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 556, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 548, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 540, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'INGRESO', 200, 740, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 732, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 724, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 716, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 708, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 700, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 692, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 684, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 676, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 668, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 660, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'INGRESO', 200, 860, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 852, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 844, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 836, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 828, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 820, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 812, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 804, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 796, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 788, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 780, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'INGRESO', 200, 980, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 972, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 964, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 956, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 948, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 940, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 932, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 924, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 916, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 908, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 900, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'INGRESO', 200, 1100, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1092, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1084, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1076, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1068, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1060, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1052, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1044, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1036, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'CONSUMO', 8, 1028, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('5d06a713-3272-4454-9b4b-4c14ccace5ae', 6, 'AJUSTE_NEGATIVO', 1028, 0, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Tubos al Vacío EDTA [Alerta: Stock Crítico]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 'b63ec01d-f533-4f82-86a3-492ded235a0b', 1, 'LOT-24592', '2027-11-30', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CARGA_INICIAL', 500, 500, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 488, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 476, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 464, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 452, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 440, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 428, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 416, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 404, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 392, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 380, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'INGRESO', 200, 580, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 568, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 556, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 544, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 532, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 520, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 508, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 496, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 484, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 472, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 460, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'INGRESO', 200, 660, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 648, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 636, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 624, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 612, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 600, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 588, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 576, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 564, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 552, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 540, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'INGRESO', 200, 740, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 728, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 716, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 704, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 692, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 680, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 668, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 656, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 644, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 632, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 620, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'INGRESO', 200, 820, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 808, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 796, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 784, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 772, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 760, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 748, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 736, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 724, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 712, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 700, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'INGRESO', 200, 900, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 888, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 876, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 864, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 852, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 840, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 828, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 816, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 804, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'CONSUMO', 12, 792, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('c191216b-1b6c-471e-b49b-40d2dc42a134', 6, 'AJUSTE_NEGATIVO', 782, 10, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Reactivo PCR Ampli-Kit [Alerta: Stock Bajo / Reponer]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 'e00cd17d-9bda-44e4-806a-e5f88f802905', 1, 'LOT-13278', '2027-11-30', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CARGA_INICIAL', 500, 500, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 494, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 488, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 482, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 476, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 470, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 464, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 458, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 452, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 446, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 440, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'INGRESO', 200, 640, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 634, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 628, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 622, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 616, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 610, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 604, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 598, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 592, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 586, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 580, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'INGRESO', 200, 780, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 774, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 768, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 762, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 756, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 750, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 744, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 738, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 732, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 726, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 720, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'INGRESO', 200, 920, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 914, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 908, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 902, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 896, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 890, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 884, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 878, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 872, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 866, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 860, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'INGRESO', 200, 1060, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1054, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1048, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1042, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1036, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1030, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1024, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1018, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1012, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1006, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1000, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'INGRESO', 200, 1200, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1194, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1188, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1182, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1176, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1170, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1164, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1158, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1152, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'CONSUMO', 6, 1146, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('f5106af6-8f1c-4834-9e78-95dee3a56948', 6, 'AJUSTE_NEGATIVO', 996, 150, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Placas de Agar Sangre Columbia [Alerta: Vencido]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 'b7d5833a-5d60-4508-ba9c-78a8c2b30812', 1, 'LOT-46048', '2026-07-04', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CARGA_INICIAL', 100, 100, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 94, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 88, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 82, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 76, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 70, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 64, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 58, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 52, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 46, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 40, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 34, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 28, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 22, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 16, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 10, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'CONSUMO', 6, 4, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('2eb66a90-f8b0-4f48-8f52-c7c0a388c750', 6, 'AJUSTE_POSITIVO', 11, 15, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Suero Fisiológico 500 mL [Alerta: Por Vencer]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', '0340f901-6915-473f-a624-6a3a4f27b4f9', 1, 'LOT-42098', '2026-09-01', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CARGA_INICIAL', 500, 500, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 494, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 488, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 482, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 476, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 470, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 464, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 458, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 452, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 446, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 440, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'INGRESO', 200, 640, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 634, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 628, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 622, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 616, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 610, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 604, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 598, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 592, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 586, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 580, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'INGRESO', 200, 780, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 774, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 768, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 762, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 756, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 750, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 744, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 738, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 732, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 726, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 720, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'INGRESO', 200, 920, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 914, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 908, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 902, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 896, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 890, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 884, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 878, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 872, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 866, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 860, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'INGRESO', 200, 1060, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1054, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1048, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1042, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1036, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1030, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1024, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1018, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1012, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1006, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1000, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'INGRESO', 200, 1200, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1194, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1188, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1182, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1176, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1170, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1164, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1158, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1152, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'CONSUMO', 6, 1146, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('b4277f7b-39ce-46f9-8083-83a4a6da5bbb', 6, 'AJUSTE_NEGATIVO', 1046, 100, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Puntas de Pipeta 1000uL [Alerta: Riesgo Vencimiento]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', '3ec4bef2-1bff-4f14-8728-eb7af4508953', 1, 'LOT-39256', '2026-08-02', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CARGA_INICIAL', 500, 500, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 494, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 488, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 482, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 476, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 470, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 464, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 458, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 452, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 446, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 440, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'INGRESO', 200, 640, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 634, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 628, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 622, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 616, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 610, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 604, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 598, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 592, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 586, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 580, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'INGRESO', 200, 780, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 774, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 768, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 762, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 756, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 750, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 744, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 738, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 732, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 726, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 720, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'INGRESO', 200, 920, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 914, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 908, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 902, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 896, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 890, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 884, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 878, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 872, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 866, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 860, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'INGRESO', 200, 1060, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1054, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1048, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1042, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1036, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1030, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1024, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1018, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1012, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1006, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1000, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'INGRESO', 200, 1200, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1194, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1188, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1182, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1176, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1170, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1164, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1158, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1152, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'CONSUMO', 6, 1146, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('bcbb0e81-b364-4846-bea3-80474b91d65d', 6, 'AJUSTE_NEGATIVO', 946, 200, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Alcohol Isopropílico 70% [Alerta: Crítico + Por Vencer]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', '548022cb-b0cd-4e93-b647-2950e7065bfd', 1, 'LOT-28289', '2026-09-01', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CARGA_INICIAL', 500, 500, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 488, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 476, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 464, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 452, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 440, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 428, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 416, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 404, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 392, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 380, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'INGRESO', 200, 580, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 568, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 556, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 544, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 532, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 520, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 508, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 496, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 484, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 472, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 460, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'INGRESO', 200, 660, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 648, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 636, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 624, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 612, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 600, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 588, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 576, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 564, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 552, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 540, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'INGRESO', 200, 740, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 728, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 716, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 704, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 692, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 680, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 668, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 656, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 644, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 632, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 620, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'INGRESO', 200, 820, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 808, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 796, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 784, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 772, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 760, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 748, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 736, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 724, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 712, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 700, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'INGRESO', 200, 900, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 888, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 876, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 864, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 852, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 840, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 828, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 816, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 804, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'CONSUMO', 12, 792, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('9a4eef01-e822-4f3c-bcf4-6d3b346efb56', 6, 'AJUSTE_NEGATIVO', 777, 15, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
    -- Lote para Puntas Amarillas 200uL [Sin Alerta: Normal]
    INSERT INTO lotes (id, producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario)
    VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', '4c0f3b83-34c3-40d8-9d2d-add62858b1b5', 1, 'LOT-23434', '2027-11-30', 10.0);
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
    VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CARGA_INICIAL', 200, 200, v_user_id, '2026-01-19 00:00:00Z', 'Carga inicial del sistema');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 198, v_user_id, '2026-01-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 196, v_user_id, '2026-01-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 194, v_user_id, '2026-01-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 192, v_user_id, '2026-01-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 190, v_user_id, '2026-02-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 188, v_user_id, '2026-02-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 186, v_user_id, '2026-02-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 184, v_user_id, '2026-02-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 182, v_user_id, '2026-02-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 180, v_user_id, '2026-02-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'INGRESO', 50, 230, v_user_id, '2026-02-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 228, v_user_id, '2026-02-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 226, v_user_id, '2026-02-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 224, v_user_id, '2026-02-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 222, v_user_id, '2026-03-02 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 220, v_user_id, '2026-03-05 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 218, v_user_id, '2026-03-08 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 216, v_user_id, '2026-03-11 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 214, v_user_id, '2026-03-14 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 212, v_user_id, '2026-03-17 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 210, v_user_id, '2026-03-20 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'INGRESO', 50, 260, v_user_id, '2026-03-20 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 258, v_user_id, '2026-03-23 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 256, v_user_id, '2026-03-26 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 254, v_user_id, '2026-03-29 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 252, v_user_id, '2026-04-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 250, v_user_id, '2026-04-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 248, v_user_id, '2026-04-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 246, v_user_id, '2026-04-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 244, v_user_id, '2026-04-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 242, v_user_id, '2026-04-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 240, v_user_id, '2026-04-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'INGRESO', 50, 290, v_user_id, '2026-04-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 288, v_user_id, '2026-04-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 286, v_user_id, '2026-04-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 284, v_user_id, '2026-04-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 282, v_user_id, '2026-05-01 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 280, v_user_id, '2026-05-04 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 278, v_user_id, '2026-05-07 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 276, v_user_id, '2026-05-10 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 274, v_user_id, '2026-05-13 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 272, v_user_id, '2026-05-16 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 270, v_user_id, '2026-05-19 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'INGRESO', 50, 320, v_user_id, '2026-05-19 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 318, v_user_id, '2026-05-22 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 316, v_user_id, '2026-05-25 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 314, v_user_id, '2026-05-28 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 312, v_user_id, '2026-05-31 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 310, v_user_id, '2026-06-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 308, v_user_id, '2026-06-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 306, v_user_id, '2026-06-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 304, v_user_id, '2026-06-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 302, v_user_id, '2026-06-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 300, v_user_id, '2026-06-18 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'INGRESO', 50, 350, v_user_id, '2026-06-18 00:00:00Z', 'Reabastecimiento mensual');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 348, v_user_id, '2026-06-21 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 346, v_user_id, '2026-06-24 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 344, v_user_id, '2026-06-27 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 342, v_user_id, '2026-06-30 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 340, v_user_id, '2026-07-03 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 338, v_user_id, '2026-07-06 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 336, v_user_id, '2026-07-09 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 334, v_user_id, '2026-07-12 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
                VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'CONSUMO', 2, 332, v_user_id, '2026-07-15 00:00:00Z', 'Consumo rutinario');
    INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at, nota)
        VALUES ('4c41b17a-6a63-451b-812a-fe1e5186dfef', 6, 'AJUSTE_NEGATIVO', 182, 150, v_user_id, '2026-07-17 00:00:00Z', 'Ajuste de inventario final');
END $$;
COMMIT;
