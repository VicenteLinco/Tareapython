-- backend/migrations/014_sesiones_conteo.sql

CREATE TABLE sesiones_conteo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id INT NOT NULL REFERENCES areas(id),
    estado VARCHAR(20) NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador', 'en_progreso', 'confirmado', 'cancelado')),
    usuario_creador_id UUID NOT NULL REFERENCES usuarios(id),
    usuario_confirmador_id UUID REFERENCES usuarios(id),
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);

CREATE TABLE conteo_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sesion_id UUID NOT NULL REFERENCES sesiones_conteo(id) ON DELETE CASCADE,
    lote_id UUID NOT NULL REFERENCES lotes(id),
    stock_sistema DECIMAL(12,2) NOT NULL,
    cantidad_contada DECIMAL(12,2),
    estado_item VARCHAR(15) NOT NULL DEFAULT 'pendiente'
        CHECK (estado_item IN ('pendiente', 'contado', 'no_contado')),
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(sesion_id, lote_id)
);

CREATE INDEX idx_sesiones_conteo_area ON sesiones_conteo(area_id);
CREATE INDEX idx_sesiones_conteo_estado ON sesiones_conteo(estado);
CREATE INDEX idx_conteo_items_sesion ON conteo_items(sesion_id);
