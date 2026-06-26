-- Migración 010: Rediseño Arquitectónico del Modelo de Inventario
-- Implementación de Especificaciones de Alta Gama (Fase 1 y Fase 3)

-- ==============================================================================
-- 1. LIMPIEZA DEL MODELO CORE (IDENTIDAD CLÍNICA)
-- Eliminación de columnas comerciales y logísticas incrustadas erróneamente en productos.
-- ==============================================================================
ALTER TABLE public.productos
    DROP COLUMN IF EXISTS proveedor_id,
    DROP COLUMN IF EXISTS precio_unidad,
    DROP COLUMN IF EXISTS sku,
    DROP COLUMN IF EXISTS pres_nombre,
    DROP COLUMN IF EXISTS pres_nombre_plural,
    DROP COLUMN IF EXISTS pres_factor,
    DROP COLUMN IF EXISTS pres_codigo_barras,
    DROP COLUMN IF EXISTS pres_gtin,
    DROP COLUMN IF EXISTS pres_gs1_habilitado;


-- ==============================================================================
-- 2. ENRIQUECIMIENTO CLÍNICO (PRODUCTOS)
-- Adición de atributos vitales médicos aprobados en las especificaciones.
-- (Atributos como temperatura_almacenamiento, dias_estabilidad_abierto y 
-- clase_riesgo ya existían y se mantienen).
-- ==============================================================================
ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS fabricante character varying(200),
    ADD COLUMN IF NOT EXISTS mpn character varying(100), -- Manufacturer Part Number
    ADD COLUMN IF NOT EXISTS alias_unidad_clinica character varying(50), -- Ej: "Determinaciones"
    ADD COLUMN IF NOT EXISTS es_kit boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS stock_minimo_global numeric(12,4) DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS codigo_loinc_cpt character varying(100);


-- ==============================================================================
-- 3. CAPA COMERCIAL EXCLUSIVA (PRESENTACIONES)
-- Centralización de la información del proveedor y costo en la tabla de presentaciones.
-- ==============================================================================
ALTER TABLE public.presentaciones
    ADD COLUMN IF NOT EXISTS proveedor_id integer REFERENCES public.proveedores(id),
    ADD COLUMN IF NOT EXISTS precio_adquisicion numeric(12,4);


-- ==============================================================================
-- 4. ARQUITECTURA DE ALTO RENDIMIENTO (CQRS & RACE CONDITIONS)
-- Tabla de Snapshot en Vivo. El stock exacto se mantiene aquí, protegiendo 
-- con constraints matemáticos que nunca caiga a negativo.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.stock_snapshot (
    lote_id uuid PRIMARY KEY REFERENCES public.lotes(id) ON DELETE CASCADE,
    producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    stock_actual numeric(12,4) NOT NULL DEFAULT 0,
    ultima_actualizacion timestamp with time zone DEFAULT now() NOT NULL,
    -- Seguro matemático anti-choques (Race Condition Prevention)
    CONSTRAINT stock_snapshot_no_negativo CHECK (stock_actual >= 0)
);


-- ==============================================================================
-- 5. INDEXACIÓN QUIRÚRGICA 
-- Estrategias avanzadas para el Buscador, el Auto-Descarte y Escáneres de BD
-- ==============================================================================
-- A. GIN Index para Full-Text Search ultrarrápido (Requiere pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm 
    ON public.productos USING gin (nombre gin_trgm_ops);

-- B. Hash Index para garantizar que el Escáner GTIN tome milisegundos O(1)
CREATE INDEX IF NOT EXISTS idx_presentaciones_gtin_hash 
    ON public.presentaciones USING hash (gtin);

-- C. B-Tree Compuesto para que el Job de Vencimientos opere sin barrer la tabla entera
CREATE INDEX IF NOT EXISTS idx_lotes_vencimiento_btree 
    ON public.lotes USING btree (producto_id, fecha_vencimiento);
