-- Migración 045: UNIQUE parcial para borradores por usuario en solicitudes_compra
-- Garantiza que cada usuario tenga como máximo un borrador de solicitud de compra.
-- UNIQUE parcial: solo aplica a filas donde estado = 'borrador'.
-- Filas con estado 'guardada' no están restringidas.

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitudes_compra_borrador_por_usuario
    ON solicitudes_compra (usuario_id)
    WHERE estado = 'borrador';
