-- backend/migrations/059_producto_almacenamiento.sql
ALTER TABLE productos
    ADD COLUMN temperatura_almacenamiento VARCHAR(30)
        CHECK (temperatura_almacenamiento IN (
            'ambiente', 'refrigerado', 'congelado', 'ultra_frio', 'no_aplica'
        )),
    ADD COLUMN requiere_cadena_frio BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN dias_estabilidad_abierto INT,
    ADD COLUMN clase_riesgo VARCHAR(20)
        CHECK (clase_riesgo IN (
            'biologico', 'quimico', 'radiactivo', 'inflamable', 'corrosivo', 'ninguno'
        ));
