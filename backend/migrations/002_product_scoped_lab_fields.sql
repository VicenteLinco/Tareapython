ALTER TABLE lab_campo_definicion
    ADD COLUMN alcance text NOT NULL DEFAULT 'laboratorio',
    ADD CONSTRAINT lab_campo_definicion_alcance_check
        CHECK (alcance IN ('laboratorio', 'producto'));

CREATE TABLE lab_campo_producto_valor (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    definicion_id uuid NOT NULL REFERENCES lab_campo_definicion(id) ON DELETE CASCADE,
    valor_entero integer,
    valor_booleano boolean,
    valor_fecha date,
    valor_texto text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (producto_id, definicion_id)
);

CREATE INDEX idx_lab_campo_producto_valor_producto
    ON lab_campo_producto_valor (producto_id);
