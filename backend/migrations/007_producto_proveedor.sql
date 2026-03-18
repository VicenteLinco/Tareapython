-- Add proveedor_id to productos for catalog-level supplier assignment
ALTER TABLE productos ADD COLUMN proveedor_id INT REFERENCES proveedores(id);
