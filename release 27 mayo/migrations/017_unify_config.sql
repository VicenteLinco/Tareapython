-- Migración 017: Unificar tablas de configuración
-- Mueve setup_finalizado a la tabla 'configuracion' y elimina 'configuracion_sistema'

INSERT INTO configuracion (clave, valor)
SELECT clave, valor FROM configuracion_sistema
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;

DROP TABLE configuracion_sistema;