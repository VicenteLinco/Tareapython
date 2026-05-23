-- Migration 055: Mejorar v_stock_por_producto_area con nombres de unidad.
-- La columna abreviatura fue eliminada en la migration 006; la vista expone
-- nombre singular y plural para evitar JOINs extra en consultas de stock.

DROP VIEW IF EXISTS v_stock_por_producto_area;

CREATE VIEW v_stock_por_producto_area AS
SELECT
    p.id              AS producto_id,
    p.codigo_interno,
    p.nombre          AS producto_nombre,
    a.id              AS area_id,
    a.nombre          AS area_nombre,
    SUM(s.cantidad)   AS stock_total,
    um.nombre         AS unidad_nombre,
    um.nombre_plural  AS unidad_nombre_plural,
    um.nombre         AS unidad,
    MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proximo_vencimiento
FROM stock s
JOIN lotes l    ON l.id = s.lote_id
JOIN productos p ON p.id = l.producto_id
JOIN areas a    ON a.id = s.area_id
JOIN unidades_basicas um ON um.id = p.unidad_base_id
WHERE s.cantidad > 0
  AND p.activo = TRUE
GROUP BY p.id, p.codigo_interno, p.nombre, a.id, a.nombre,
         um.nombre, um.nombre_plural;
