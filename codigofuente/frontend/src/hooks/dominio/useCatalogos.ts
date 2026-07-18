import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listarAreas,
  crearArea,
  actualizarArea,
  eliminarArea,
  listarCategorias,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
  listarUnidades,
  crearUnidad,
  actualizarUnidad,
  eliminarUnidad,
  listarProveedores,
  crearProveedor,
  actualizarProveedor,
  eliminarProveedor,
  listarProductos,
  detalleProducto,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  reactivarProducto,
  listarPresentaciones,
  crearPresentacion,
  actualizarPresentacion,
  eliminarPresentacion,
  listarProductosQuarantine,
  aprobarProductoQuarantine,
  rechazarProductoQuarantine,
} from "@/api";
import type {
  CreateArea,
  UpdateArea,
  CreateCategoria,
  UpdateCategoria,
  CreateUnidadBasica,
  UpdateUnidadBasica,
  CreateProveedor,
  UpdateProveedor,
  ProveedorQuery,
  CreateProducto,
  UpdateProducto,
} from "@/types";
import type {
  ProductosQuery,
  CreatePresentacion,
  UpdatePresentacion,
  ApproveProductPayload,
} from "@/api";
import { notify } from "@/lib/notify";
import { parseApiError } from "@/lib/api-error";
import { catalogosKeys } from "@/lib/queryKeys";

const STALE_5MIN = 5 * 60 * 1000;

// ─── Áreas ───────────────────────────────────────────────────────────────────

export function useAreas() {
  return useQuery({
    queryKey: catalogosKeys.areas,
    queryFn: () => listarAreas(),
    staleTime: STALE_5MIN,
  });
}

export function useCrearArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateArea) => crearArea(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.areas });
      notify.success("Área creada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useActualizarArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateArea }) =>
      actualizarArea(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.areas });
      notify.success("Área actualizada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eliminarArea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.areas });
      notify.success("Área eliminada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

// ─── Categorías ───────────────────────────────────────────────────────────────

export function useCategorias() {
  return useQuery({
    queryKey: catalogosKeys.categorias,
    queryFn: () => listarCategorias(),
    staleTime: STALE_5MIN,
  });
}

export function useCrearCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoria) => crearCategoria(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.categorias });
      notify.success("Categoría creada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useActualizarCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateCategoria }) =>
      actualizarCategoria(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.categorias });
      notify.success("Categoría actualizada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eliminarCategoria(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.categorias });
      notify.success("Categoría eliminada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

// ─── Unidades Básicas ─────────────────────────────────────────────────────────

export function useUnidadesBasicas() {
  return useQuery({
    queryKey: catalogosKeys.unidades,
    queryFn: () => listarUnidades(),
    staleTime: STALE_5MIN,
  });
}

export function useCrearUnidad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUnidadBasica) => crearUnidad(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.unidades });
      notify.success("Unidad creada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useActualizarUnidad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: UpdateUnidadBasica;
    }) => actualizarUnidad(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.unidades });
      notify.success("Unidad actualizada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarUnidad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eliminarUnidad(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.unidades });
      notify.success("Unidad eliminada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

// ─── Proveedores ──────────────────────────────────────────────────────────────

export function useProveedores(params?: Partial<ProveedorQuery>) {
  return useQuery({
    queryKey: catalogosKeys.proveedores(params),
    queryFn: () => listarProveedores(params),
    staleTime: STALE_5MIN,
  });
}

export function useCrearProveedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProveedor) => crearProveedor(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.proveedores() });
      notify.success("Proveedor creado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useActualizarProveedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateProveedor }) =>
      actualizarProveedor(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.proveedores() });
      notify.success("Proveedor actualizado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarProveedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eliminarProveedor(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.proveedores() });
      notify.success("Proveedor eliminado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

// ─── Productos ────────────────────────────────────────────────────────────────

export function useProductos(params?: ProductosQuery) {
  return useQuery({
    queryKey: catalogosKeys.productos.list(params),
    queryFn: () => listarProductos(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useProductoDetalle(id: string | null | undefined) {
  return useQuery({
    queryKey: catalogosKeys.productos.detail(id ?? ""),
    queryFn: () => detalleProducto(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useCrearProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProducto) => crearProducto(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.productos.all });
      notify.success("Producto creado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useActualizarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateProducto }) =>
      actualizarProducto(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: catalogosKeys.productos.all });
      qc.invalidateQueries({ queryKey: catalogosKeys.productos.detail(id) });
      notify.success("Producto actualizado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => eliminarProducto(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.productos.all });
      notify.success("Producto eliminado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useReactivarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reactivarProducto(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.productos.all });
      notify.success("Producto reactivado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

// ─── Presentaciones ───────────────────────────────────────────────────────────

export function usePresentaciones(productoId: string | null | undefined) {
  return useQuery({
    queryKey: catalogosKeys.productos.presentaciones(productoId ?? ""),
    queryFn: () => listarPresentaciones(productoId!),
    enabled: !!productoId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCrearPresentacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      productoId,
      payload,
    }: {
      productoId: string;
      payload: CreatePresentacion;
    }) => crearPresentacion(productoId, payload),
    onSuccess: (_data, { productoId }) => {
      qc.invalidateQueries({
        queryKey: catalogosKeys.productos.presentaciones(productoId),
      });
      qc.invalidateQueries({
        queryKey: catalogosKeys.productos.detail(productoId),
      });
      notify.success("Presentación creada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useActualizarPresentacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      productoId: string;
      payload: UpdatePresentacion;
    }) => actualizarPresentacion(id, payload),
    onSuccess: (_data, { productoId }) => {
      qc.invalidateQueries({
        queryKey: catalogosKeys.productos.presentaciones(productoId),
      });
      qc.invalidateQueries({
        queryKey: catalogosKeys.productos.detail(productoId),
      });
      notify.success("Presentación actualizada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarPresentacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => eliminarPresentacion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: catalogosKeys.productos.all });
      notify.success("Presentación eliminada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

// ─── Productos en Cuarentena ──────────────────────────────────────────────────

export function useProductosQuarantine() {
  return useQuery({
    queryKey: ["productos", "quarantine"],
    queryFn: () => listarProductosQuarantine(),
    staleTime: 60 * 1000,
  });
}

export function useAprobarProductoQuarantine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: ApproveProductPayload;
    }) => aprobarProductoQuarantine(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["productos"] }); // Invalidate list & quarantine
      notify.success("Producto aprobado y liberado de cuarentena");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useRechazarProductoQuarantine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rechazarProductoQuarantine(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["productos"] }); // Invalidate list & quarantine
      notify.success("Producto rechazado y eliminado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}
