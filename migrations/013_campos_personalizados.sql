-- Agregar flag a categorias
ALTER TABLE categorias ADD COLUMN admite_campos_personalizados BOOLEAN NOT NULL DEFAULT false;

-- Definicion de campos por categoria
CREATE TABLE campo_personalizado_definicion (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    tipo_dato TEXT NOT NULL CHECK (tipo_dato IN ('entero', 'booleano', 'fecha', 'lista', 'texto')),
    opciones_lista JSONB,
    requerido BOOLEAN DEFAULT false,
    orden INTEGER DEFAULT 0,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE(categoria_id, nombre)
);

-- Valores por producto
CREATE TABLE campo_personalizado_valor (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    definicion_id UUID NOT NULL REFERENCES campo_personalizado_definicion(id) ON DELETE CASCADE,
    valor_entero INTEGER,
    valor_booleano BOOLEAN,
    valor_fecha DATE,
    valor_texto TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE(producto_id, definicion_id)
);

CREATE INDEX idx_cpdef_categoria ON campo_personalizado_definicion(categoria_id);
CREATE INDEX idx_cpval_producto ON campo_personalizado_valor(producto_id);
CREATE INDEX idx_cpval_definicion ON campo_personalizado_valor(definicion_id);
