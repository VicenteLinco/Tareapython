-- ============================================================
-- Migración 005: Proveedor extras + rename unidades_medida → unidades_basicas
-- ============================================================

-- ── Proveedores: icono y tiempos de despacho ──
ALTER TABLE proveedores
    ADD COLUMN icono              TEXT,
    ADD COLUMN dias_despacho_aereo  INT,
    ADD COLUMN dias_despacho_tierra INT;

-- ── Renombrar tabla ──
ALTER TABLE unidades_medida RENAME TO unidades_basicas;

-- ── Recrear la vista que referenciaba la tabla vieja ──
DROP VIEW IF EXISTS v_stock_por_producto_area;

CREATE VIEW v_stock_por_producto_area AS
SELECT
    p.id AS producto_id,
    p.codigo_interno,
    p.nombre AS producto_nombre,
    a.id AS area_id,
    a.nombre AS area_nombre,
    SUM(s.cantidad) AS stock_total,
    um.abreviatura AS unidad,
    MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proximo_vencimiento
FROM stock s
JOIN lotes l ON l.id = s.lote_id
JOIN productos p ON p.id = l.producto_id
JOIN areas a ON a.id = s.area_id
JOIN unidades_basicas um ON um.id = p.unidad_base_id
WHERE s.cantidad > 0
GROUP BY p.id, p.codigo_interno, p.nombre, a.id, a.nombre, um.abreviatura;
