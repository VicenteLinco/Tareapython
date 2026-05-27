CREATE TABLE refresh_sessions (
    id UUID PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    replaced_by UUID NULL REFERENCES refresh_sessions(id) ON DELETE SET NULL,
    created_ip TEXT NULL
);

CREATE INDEX idx_refresh_sessions_usuario ON refresh_sessions(usuario_id);
CREATE INDEX idx_refresh_sessions_active ON refresh_sessions(usuario_id, expires_at)
    WHERE revoked_at IS NULL;
