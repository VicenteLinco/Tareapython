-- =============================================================================
-- MIGRACIÓN 003: REDISEÑO DE PRODUCTOS, ENTIDAD COMERCIAL, LEDGER Y AUDITORÍA
-- =============================================================================

-- 1. Entidad de Auditoría Change Data Capture (ISO 15189 / 21 CFR Part 11)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla_nombre VARCHAR(100) NOT NULL,
    registro_id UUID NOT NULL,
    accion VARCHAR(20) NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    usuario_id UUID,
    ip_address INET,
    motivo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tabla_registro ON audit_logs (tabla_nombre, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

-- Trigger genérico CDC de auditoría
CREATE OR REPLACE FUNCTION fn_audit_log_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_logs (tabla_nombre, registro_id, accion, datos_anteriores)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_logs (tabla_nombre, registro_id, accion, datos_anteriores, datos_nuevos)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_logs (tabla_nombre, registro_id, accion, datos_nuevos)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Entidad Comercial de Proveedores
CREATE TABLE IF NOT EXISTS proveedor_productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
    sku_proveedor VARCHAR(100),
    nombre_comercial_proveedor VARCHAR(300),
    codigo_catalogo_proveedor VARCHAR(100),
    precio_compra_actual NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (precio_compra_actual >= 0),
    moneda_codigo VARCHAR(3) NOT NULL DEFAULT 'USD',
    lead_time_dias INTEGER DEFAULT 7 CHECK (lead_time_dias >= 0),
    cantidad_minima_compra NUMERIC(12, 4) DEFAULT 1.0000 CHECK (cantidad_minima_compra > 0),
    es_preferido BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (producto_id, proveedor_id)
);

CREATE INDEX IF NOT EXISTS idx_proveedor_productos_producto ON proveedor_productos(producto_id);
CREATE INDEX IF NOT EXISTS idx_proveedor_productos_proveedor ON proveedor_productos(proveedor_id);

-- 3. Ubicaciones Jerárquicas de Almacén (WMS)
CREATE TABLE IF NOT EXISTS almacen_ubicaciones (
    id SERIAL PRIMARY KEY,
    almacen_id INTEGER NOT NULL,
    codigo_ubicacion VARCHAR(50) UNIQUE NOT NULL,
    zona VARCHAR(50) NOT NULL,
    pasillo VARCHAR(20),
    estante VARCHAR(20),
    posicion VARCHAR(20),
    temperatura_controlada VARCHAR(30) DEFAULT 'ambiente' CHECK (temperatura_controlada IN ('ambiente', 'refrigerado', 'congelado', 'ultra_frio')),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_almacen_ubicaciones_codigo ON almacen_ubicaciones(codigo_ubicacion);

-- 4. Bill of Materials (Kits / Recetas)
CREATE TABLE IF NOT EXISTS producto_kit_componentes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_padre_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    producto_hijo_id UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad_requerida NUMERIC(12, 4) NOT NULL CHECK (cantidad_requerida > 0),
    unidad_medida_id INTEGER REFERENCES unidades_basicas(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (producto_padre_id, producto_hijo_id)
);

CREATE INDEX IF NOT EXISTS idx_kit_comp_padre ON producto_kit_componentes(producto_padre_id);
CREATE INDEX IF NOT EXISTS idx_kit_comp_hijo ON producto_kit_componentes(producto_hijo_id);

-- 5. Ledger Inmutable de Movimientos de Inventario
CREATE TABLE IF NOT EXISTS inventario_movimientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id UUID REFERENCES lotes(id) ON DELETE RESTRICT,
    presentacion_id INTEGER REFERENCES presentaciones(id) ON DELETE RESTRICT,
    ubicacion_origen_id INTEGER REFERENCES almacen_ubicaciones(id),
    ubicacion_destino_id INTEGER REFERENCES almacen_ubicaciones(id),
    tipo_movimiento VARCHAR(30) NOT NULL CHECK (tipo_movimiento IN (
        'RECEPCION_COMPRA',
        'SALIDA_CONSUMO',
        'TRANSFERENCIA_INTERNA',
        'AJUSTE_INVENTARIO',
        'MERMA_DESCARTE',
        'CUARENTENA_INGRESO',
        'LIBERACION_CUARENTENA'
    )),
    cantidad NUMERIC(14, 4) NOT NULL CHECK (cantidad <> 0),
    costo_unitario NUMERIC(14, 4) DEFAULT 0.0000 CHECK (costo_unitario >= 0),
    documento_tipo VARCHAR(50),
    documento_numero VARCHAR(100),
    usuario_id UUID,
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_lote ON inventario_movimientos(lote_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created_at ON inventario_movimientos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_tipo ON inventario_movimientos(tipo_movimiento);

-- 6. Refactorización de campos LOINC/CPT, GTIN en variantes y Cuarentena en lotes
ALTER TABLE productos ADD COLUMN IF NOT EXISTS loinc_code VARCHAR(50);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS cpt_code VARCHAR(50);
ALTER TABLE producto_codigos_barras ADD COLUMN IF NOT EXISTS presentacion_id INTEGER REFERENCES presentaciones(id) ON DELETE CASCADE;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS estado_cuarentena VARCHAR(30) DEFAULT 'disponible' CHECK (estado_cuarentena IN ('disponible', 'en_cuarentena', 'rechazado', 'liberado'));
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
