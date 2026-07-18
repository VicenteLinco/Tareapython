-- Migration: Add promedio_uso_mensual to productos
ALTER TABLE public.productos 
  ADD COLUMN promedio_uso_mensual numeric(12,4) DEFAULT 0.0000 NOT NULL,
  ADD COLUMN promedio_uso_mensual_inicial numeric(12,4) DEFAULT 0.0000 NOT NULL;
