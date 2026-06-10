-- backend/migrations/043_horizonte_dias_solicitud.sql
ALTER TABLE solicitud_compra_detalle
  ADD COLUMN horizonte_dias       INTEGER,
  ADD COLUMN horizonte_sugerido   INTEGER,
  ADD COLUMN horizonte_razon      TEXT;

COMMENT ON COLUMN solicitud_compra_detalle.horizonte_dias
  IS 'Horizonte activo al guardar. NULL indica cantidad editada manualmente (ningún chip activo).';
COMMENT ON COLUMN solicitud_compra_detalle.horizonte_sugerido
  IS 'Horizonte calculado por el sistema al agregar el ítem. Inmutable.';
COMMENT ON COLUMN solicitud_compra_detalle.horizonte_razon
  IS 'Razón textual del horizonte sugerido. Inmutable.';
