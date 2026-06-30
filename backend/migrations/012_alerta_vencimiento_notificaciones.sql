-- Migration: Alerta Vencimiento y Notificaciones

ALTER TABLE public.recepcion_detalle 
  ADD COLUMN alerta_vencimiento boolean DEFAULT false NOT NULL,
  ADD COLUMN desperdicio_proyectado numeric(12,2) DEFAULT 0.0 NOT NULL;

CREATE TABLE public.notificaciones (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  titulo varchar(200) NOT NULL,
  mensaje text NOT NULL,
  tipo varchar(50) NOT NULL,
  leido boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX idx_notificaciones_usuario_leido ON public.notificaciones(usuario_id, leido);
CREATE INDEX idx_movimientos_lote_tipo ON public.movimientos(lote_id, tipo, created_at);
