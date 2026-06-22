-- Política de control de lote por producto.
-- Perfiles:
--   'trazable' -> lote y vencimiento obligatorios; consumo por lote exacto (QR).
--   'con_vto'  -> comportamiento actual (lote opcional, vencimiento obligatorio, FEFO).
--   'simple'   -> sin lote ni vencimiento; descuento directo de stock.
-- Default 'con_vto' preserva el comportamiento de todos los productos existentes.

ALTER TABLE public.productos
    ADD COLUMN control_lote TEXT NOT NULL DEFAULT 'con_vto';

ALTER TABLE public.productos
    ADD CONSTRAINT productos_control_lote_check
    CHECK (control_lote IN ('trazable', 'con_vto', 'simple'));
