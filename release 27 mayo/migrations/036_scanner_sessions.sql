-- backend/migrations/036_scanner_sessions.sql
CREATE TABLE scanner_sessions (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id UUID REFERENCES recepciones(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE TABLE scanner_items (
    id BIGSERIAL PRIMARY KEY,
    session_token UUID NOT NULL REFERENCES scanner_sessions(token) ON DELETE CASCADE,
    codigo VARCHAR(200) NOT NULL,
    producto_id UUID REFERENCES productos(id),
    producto_nombre VARCHAR(500),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fetched BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_scanner_items_session ON scanner_items(session_token, fetched);
