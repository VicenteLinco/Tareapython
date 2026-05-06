-- ============================================================
-- Migración 030: Agregar estado 'borrador' a solicitudes_compra
-- ============================================================

ALTER TABLE solicitudes_compra DROP CONSTRAINT solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN (
        'borrador', 'pendiente', 'aprobada', 'rechazada',
        'enviada', 'completada', 'cancelada'
    ));

-- Cambiar default: nuevas solicitudes nacen como borrador
ALTER TABLE solicitudes_compra
    ALTER COLUMN estado SET DEFAULT 'borrador';
