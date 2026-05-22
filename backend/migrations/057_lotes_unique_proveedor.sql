-- Migration 057: Refinar constraint UNIQUE de lotes para incluir proveedor_id.
-- El constraint anterior (producto_id, numero_lote) impedía que dos proveedores
-- distintos usaran el mismo número de lote para el mismo producto, lo cual ocurre
-- en la práctica. El nuevo constraint lo permite correctamente.

ALTER TABLE lotes
    DROP CONSTRAINT IF EXISTS lotes_producto_id_numero_lote_key;

ALTER TABLE lotes
    ADD CONSTRAINT lotes_producto_proveedor_lote_key
    UNIQUE (producto_id, proveedor_id, numero_lote);
