-- Permite que un detalle de recepción no tenga presentación asociada
-- (producto sin presentaciones — se usa factor de conversión 1, unidad base directa)
ALTER TABLE recepcion_detalle
    ALTER COLUMN presentacion_id DROP NOT NULL;
