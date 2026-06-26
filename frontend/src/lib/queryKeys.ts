// Centraliza todas las query keys del proyecto.
// Usar estas constantes en hooks y en invalidateQueries — nunca strings sueltos.

export const stockKeys = {
  all: ["stock"] as const,
  lists: () => [...stockKeys.all, "list"] as const,
  list: (filters?: object) => [...stockKeys.lists(), filters] as const,
  alertas: () => [...stockKeys.all, "alertas"] as const,
  area: (areaId: number, params?: object) =>
    [...stockKeys.all, "area", areaId, params] as const,
};

export const lotesKeys = {
  all: ["lotes"] as const,
  list: (filters?: object) => [...lotesKeys.all, "list", filters] as const,
  detail: (id: string) => [...lotesKeys.all, id] as const,
};

export const recepcionKeys = {
  all: ["recepciones"] as const,
  list: (filters?: object) => [...recepcionKeys.all, "list", filters] as const,
  detail: (id: string) => [...recepcionKeys.all, id] as const,
};

export const solicitudesKeys = {
  all: ["solicitudes"] as const,
  list: (filters?: object) =>
    [...solicitudesKeys.all, "list", filters] as const,
  detail: (id: string) => [...solicitudesKeys.all, id] as const,
  borrador: () => [...solicitudesKeys.all, "borrador"] as const,
  recomendaciones: (params?: object) =>
    [...solicitudesKeys.all, "recomendaciones", params] as const,
};

export const catalogosKeys = {
  areas: ["areas"] as const,
  categorias: ["categorias"] as const,
  unidades: ["unidades-basicas"] as const,
  proveedores: (params?: object) => ["proveedores", params] as const,
  productos: {
    all: ["productos"] as const,
    list: (filters?: object) => ["productos", "list", filters] as const,
    detail: (id: string) => ["productos", id] as const,
    presentaciones: (productoId: string) =>
      ["productos", productoId, "presentaciones"] as const,
  },
};

export const usuariosKeys = {
  all: ["usuarios"] as const,
  list: (params?: object) => [...usuariosKeys.all, "list", params] as const,
  detail: (id: string) => [...usuariosKeys.all, id] as const,
};

export const movimientosKeys = {
  all: ["movimientos"] as const,
  list: (filters?: object) =>
    [...movimientosKeys.all, "list", filters] as const,
  detail: (id: string) => [...movimientosKeys.all, id] as const,
  tendencias: (params?: object) =>
    [...movimientosKeys.all, "tendencias", params] as const,
};

export const conteoKeys = {
  all: ["conteo"] as const,
  pendientes: () => [...conteoKeys.all, "pendientes"] as const,
  list: (filters?: object) => [...conteoKeys.all, "list", filters] as const,
  detail: (id: string) => [...conteoKeys.all, id] as const,
};

export const configuracionKeys = {
  all: ["configuracion"] as const,
};

export const auditLogKeys = {
  all: ["audit-log"] as const,
  list: (filters?: object) => [...auditLogKeys.all, "list", filters] as const,
};

export const descartesKeys = {
  all: ["descartes"] as const,
  list: (filters?: object) => [...descartesKeys.all, "list", filters] as const,
};
