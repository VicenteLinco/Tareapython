-- ============================================================
-- Migración 001: Schema completo del sistema de inventario
-- 16 tablas + vistas + secuencias + funciones + índices
-- ============================================================

-- =========================
-- 1. UNIDADES DE MEDIDA
-- =========================
CREATE TABLE unidades_medida (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    abreviatura VARCHAR(10) NOT NULL UNIQUE
);

-- =========================
-- 2. CATEGORÍAS
-- =========================
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 3. ÁREAS
-- =========================
CREATE TABLE areas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    es_bodega BOOLEAN NOT NULL DEFAULT FALSE,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 4. USUARIOS
-- =========================
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'tecnologo', 'consulta')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 5. USUARIO-ÁREA (muchos a muchos)
-- =========================
CREATE TABLE usuario_area (
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    area_id INT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, area_id)
);

-- =========================
-- 6. PROVEEDORES
-- =========================
CREATE TABLE proveedores (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    contacto VARCHAR(200),
    telefono VARCHAR(50),
    email VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 7. PRODUCTOS (catálogo maestro)
-- =========================
CREATE TABLE productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_interno VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(300) NOT NULL,
    descripcion TEXT,
    categoria_id INT REFERENCES categorias(id),
    unidad_base_id INT NOT NULL REFERENCES unidades_medida(id),
    stock_minimo DECIMAL(12,2) NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_productos_codigo ON productos(codigo_interno);

-- =========================
-- 8. PRESENTACIONES
-- =========================
CREATE TABLE presentaciones (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    factor_conversion DECIMAL(12,2) NOT NULL CHECK (factor_conversion > 0),
    codigo_barras VARCHAR(100),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_presentaciones_producto ON presentaciones(producto_id);
CREATE INDEX idx_presentaciones_codigo_barras ON presentaciones(codigo_barras);

-- =========================
-- 9. PRODUCTO-ÁREA
-- =========================
CREATE TABLE producto_area (
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    area_id INT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    PRIMARY KEY (producto_id, area_id)
);

-- =========================
-- 10. LOTES
-- =========================
CREATE TABLE lotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID NOT NULL REFERENCES productos(id),
    proveedor_id INT REFERENCES proveedores(id),
    numero_lote VARCHAR(100) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    codigo_interno VARCHAR(30) NOT NULL UNIQUE,
    costo_unitario DECIMAL(12,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (producto_id, numero_lote)
);

CREATE INDEX idx_lotes_producto ON lotes(producto_id);
CREATE INDEX idx_lotes_vencimiento ON lotes(fecha_vencimiento);
CREATE INDEX idx_lotes_codigo_interno ON lotes(codigo_interno);

-- =========================
-- 11. STOCK (snapshot por lote+área)
-- =========================
CREATE TABLE stock (
    id SERIAL PRIMARY KEY,
    lote_id UUID NOT NULL REFERENCES lotes(id),
    area_id INT NOT NULL REFERENCES areas(id),
    cantidad DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lote_id, area_id)
);

CREATE INDEX idx_stock_area ON stock(area_id);
CREATE INDEX idx_stock_lote ON stock(lote_id);
CREATE INDEX idx_stock_activo ON stock(lote_id, area_id) WHERE cantidad > 0;

-- =========================
-- 12. SECUENCIAS Y FUNCIONES
-- =========================
CREATE SEQUENCE seq_mov_numero START 1;
CREATE SEQUENCE seq_rec_numero START 1;
CREATE SEQUENCE seq_prd_numero START 1;
CREATE SEQUENCE seq_lot_numero START 1;

CREATE OR REPLACE FUNCTION generar_numero_mov() RETURNS TEXT AS $$
    SELECT 'MOV-' || LPAD(NEXTVAL('seq_mov_numero')::TEXT, 6, '0')
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION generar_numero_rec() RETURNS TEXT AS $$
    SELECT 'REC-' || LPAD(NEXTVAL('seq_rec_numero')::TEXT, 6, '0')
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION generar_codigo_producto() RETURNS TEXT AS $$
    SELECT 'PRD-' || LPAD(NEXTVAL('seq_prd_numero')::TEXT, 5, '0')
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION generar_codigo_lote() RETURNS TEXT AS $$
    SELECT 'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('seq_lot_numero')::TEXT, 5, '0')
$$ LANGUAGE SQL;

-- =========================
-- 13. MOVIMIENTOS (ledger inmutable)
-- =========================
CREATE TABLE movimientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_documento VARCHAR(20) NOT NULL UNIQUE DEFAULT generar_numero_mov(),
    grupo_movimiento UUID,
    lote_id UUID NOT NULL REFERENCES lotes(id),
    area_id INT NOT NULL REFERENCES areas(id),
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
        'INGRESO', 'CARGA_INICIAL', 'CONSUMO',
        'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO',
        'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SALIDA',
        'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO'
    )),
    cantidad DECIMAL(12,2) NOT NULL CHECK (cantidad > 0),
    cantidad_resultante DECIMAL(12,2) NOT NULL,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    origen VARCHAR(30),
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mov_area_tipo_fecha ON movimientos(area_id, tipo, created_at DESC);
CREATE INDEX idx_mov_lote_fecha ON movimientos(lote_id, created_at DESC);
CREATE INDEX idx_movimientos_usuario ON movimientos(usuario_id);
CREATE INDEX idx_movimientos_grupo ON movimientos(grupo_movimiento);

-- =========================
-- 14. IDEMPOTENCY KEYS
-- =========================
CREATE TABLE idempotency_keys (
    key VARCHAR(50) PRIMARY KEY,
    endpoint VARCHAR(100) NOT NULL,
    response_status SMALLINT NOT NULL,
    response_body JSONB NOT NULL,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 15. AUDIT LOG
-- =========================
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    tabla VARCHAR(50) NOT NULL,
    registro_id VARCHAR(50) NOT NULL,
    accion VARCHAR(10) NOT NULL CHECK (accion IN ('CREATE', 'UPDATE', 'DELETE')),
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tabla_registro ON audit_log(tabla, registro_id);
CREATE INDEX idx_audit_fecha ON audit_log(created_at);

-- =========================
-- 16. RECEPCIONES
-- =========================
CREATE TABLE recepciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_documento VARCHAR(20) NOT NULL UNIQUE DEFAULT generar_numero_rec(),
    proveedor_id INT NOT NULL REFERENCES proveedores(id),
    numero_guia VARCHAR(100),
    estado VARCHAR(20) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'completa', 'parcial', 'rechazada')),
    fecha_recepcion TIMESTAMPTZ NOT NULL,
    guia_despacho_archivo VARCHAR(500),
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 17. RECEPCIÓN DETALLE
-- =========================
CREATE TABLE recepcion_detalle (
    id SERIAL PRIMARY KEY,
    recepcion_id UUID NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id),
    lote_id UUID NOT NULL REFERENCES lotes(id),
    presentacion_id INT NOT NULL REFERENCES presentaciones(id),
    area_destino_id INT NOT NULL REFERENCES areas(id),
    cantidad_presentaciones DECIMAL(12,2) NOT NULL,
    factor_conversion_usado DECIMAL(12,2) NOT NULL,
    cantidad_unidades_base DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- VISTA: Stock por producto por área
-- =========================
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
JOIN unidades_medida um ON um.id = p.unidad_base_id
WHERE s.cantidad > 0
GROUP BY p.id, p.codigo_interno, p.nombre, a.id, a.nombre, um.abreviatura;

-- =========================
-- CONFIGURACIÓN DEL SISTEMA
-- =========================
CREATE TABLE configuracion_sistema (
    clave VARCHAR(50) PRIMARY KEY,
    valor VARCHAR(500) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion_sistema (clave, valor) VALUES
    ('setup_finalizado', 'false');
