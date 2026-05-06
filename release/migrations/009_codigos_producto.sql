-- Códigos adicionales por producto: referencia proveedor y código interno de bodega
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS codigo_proveedor VARCHAR(100),
  ADD COLUMN IF NOT EXISTS codigo_maestro   VARCHAR(100);
