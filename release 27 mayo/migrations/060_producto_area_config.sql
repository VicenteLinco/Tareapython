-- backend/migrations/060_producto_area_config.sql
-- NULL = hereda el stock_minimo global de productos.stock_minimo
ALTER TABLE producto_area
    ADD COLUMN stock_minimo DECIMAL(12,2),
    ADD COLUMN stock_maximo DECIMAL(12,2),
    ADD COLUMN punto_reorden DECIMAL(12,2);
