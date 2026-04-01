-- ============================================================
-- Migración 020: Flujo de Aprobación de Solicitudes
-- ============================================================

-- 1. Eliminar el check constraint anterior
ALTER TABLE solicitudes_compra DROP CONSTRAINT solicitudes_compra_estado_check;

-- 2. Agregar los nuevos estados y la columna nota_revision
ALTER TABLE solicitudes_compra 
    ADD COLUMN nota_revision TEXT,
    ADD COLUMN fecha_revision TIMESTAMPTZ,
    ADD COLUMN revisado_por UUID REFERENCES usuarios(id);

-- 3. Re-agregar el check constraint con los nuevos estados
ALTER TABLE solicitudes_compra 
    ADD CONSTRAINT solicitudes_compra_estado_check 
    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'enviada', 'completada', 'cancelada'));

-- 4. Comentario para auditoría
COMMENT ON COLUMN solicitudes_compra.revisado_por IS 'Usuario (admin) que aprobó o rechazó la solicitud';
