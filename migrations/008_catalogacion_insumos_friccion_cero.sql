-- Migration 008: Catalogacion de Insumos con Friccion Cero (Base)
-- Add columns `estado_catalogo` and `origen_registro` to `productos`
-- Update v_stock_por_producto_area view to exclude quarantined products

ALTER TABLE public.productos 
    ADD COLUMN estado_catalogo TEXT NOT NULL DEFAULT 'aprobado',
    ADD COLUMN origen_registro TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.productos
    ADD CONSTRAINT chk_productos_estado_catalogo 
    CHECK (estado_catalogo IN ('pendiente_aprobacion', 'aprobado'));

ALTER TABLE public.productos
    ADD CONSTRAINT chk_productos_origen_registro 
    CHECK (origen_registro IN ('manual', 'api_regulatoria', 'guia_pdf'));

-- Indices for performance
CREATE INDEX idx_productos_estado_catalogo ON public.productos(estado_catalogo);
CREATE INDEX idx_productos_origen_registro ON public.productos(origen_registro);

-- Drop and recreate the view v_stock_por_producto_area to exclude quarantined products
DROP VIEW IF EXISTS public.v_stock_por_producto_area;

CREATE VIEW public.v_stock_por_producto_area AS
 SELECT p.id AS producto_id,
    p.codigo_interno,
    p.nombre AS producto_nombre,
    a.id AS area_id,
    a.nombre AS area_nombre,
    sum(s.cantidad) AS stock_total,
    um.nombre AS unidad_nombre,
    um.nombre_plural AS unidad_nombre_plural,
    um.nombre AS unidad,
    min(l.fecha_vencimiento) FILTER (WHERE (s.cantidad > (0)::numeric)) AS proximo_vencimiento
   FROM ((((public.stock s
     JOIN public.lotes l ON ((l.id = s.lote_id)))
     JOIN public.productos p ON ((p.id = l.producto_id)))
     JOIN public.areas a ON ((a.id = s.area_id)))
     JOIN public.unidades_basicas um ON ((um.id = p.unidad_base_id)))
  WHERE ((s.cantidad > (0)::numeric) AND (p.activo = true) AND (p.estado_catalogo = 'aprobado'))
  GROUP BY p.id, p.codigo_interno, p.nombre, a.id, a.nombre, um.nombre, um.nombre_plural;
