-- ============================================================
-- 014: Reemplazar EAV por categoría por campos global del lab
-- ============================================================

-- 1. Eliminar tablas y columna del EAV por categoría
DROP TABLE IF EXISTS campo_personalizado_valor;
DROP TABLE IF EXISTS campo_personalizado_definicion;
ALTER TABLE categorias DROP COLUMN IF EXISTS admite_campos_personalizados;

-- 2. Tabla de definición de campos personalizados del laboratorio
CREATE TABLE lab_campo_definicion (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    tipo_dato TEXT NOT NULL CHECK (tipo_dato IN ('entero', 'booleano', 'fecha', 'lista', 'texto')),
    opciones_lista JSONB,
    requerido BOOLEAN DEFAULT false,
    considerar_filtro BOOLEAN DEFAULT false,
    orden INTEGER DEFAULT 0,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. Tabla de valores de campos del laboratorio (key-value, 1 row per field)
CREATE TABLE lab_campo_valor (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    definicion_id UUID NOT NULL UNIQUE REFERENCES lab_campo_definicion(id) ON DELETE CASCADE,
    valor_entero INTEGER,
    valor_booleano BOOLEAN,
    valor_fecha DATE,
    valor_texto TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_lcpdef_orden ON lab_campo_definicion(orden);
