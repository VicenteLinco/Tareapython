// Dominio: catálogos (productos, presentaciones, categorías, unidades, áreas, proveedores)
import api from '@/lib/api'
import type {
  Producto,
  Presentacion,
  Categoria,
  UnidadBasica,
  Area,
  Proveedor,
  CreateProducto,
  UpdateProducto,
  CreateCategoria,
  UpdateCategoria,
  CreateUnidadBasica,
  UpdateUnidadBasica,
  CreateArea,
  UpdateArea,
  CreateProveedor,
  UpdateProveedor,
  ProveedorQuery,
  ProductoProveedor,
} from '@/types'

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface ProductosQuery {
  q?: string | null
  categoria_id?: number | null
  proveedor_id?: number | null
  area_id?: number | null
  activo?: boolean
  page?: number
  per_page?: number
}

export interface ProductosResponse {
  data: Producto[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface ProductoDetalle extends Producto {
  categoria_nombre: string | null
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  proveedor_nombre: string | null
  presentaciones: Presentacion[]
  proveedores: ProductoProveedor[]
  area_ids: number[]
}

export interface CreatePresentacion {
  nombre: string
  nombre_plural: string
  factor_conversion: number
  codigo_barras?: string | null
}

export interface UpdatePresentacion {
  nombre?: string | null
  nombre_plural?: string | null
  factor_conversion?: number | null
  codigo_barras?: string | null
  version: number
}

// ─── Productos ────────────────────────────────────────────────────────────────

/** GET /productos — Listar productos con filtros y paginación */
export async function listarProductos(params?: ProductosQuery): Promise<ProductosResponse> {
  const { data } = await api.get<ProductosResponse>('/productos', { params })
  return data
}

/** GET /productos/:id — Detalle de un producto */
export async function detalleProducto(id: string): Promise<ProductoDetalle> {
  const { data } = await api.get<ProductoDetalle>(`/productos/${id}`)
  return data
}

/** GET /productos/scan?codigo=:codigo — Buscar producto por código de barras o interno */
export async function buscarProducto(codigo: string): Promise<Producto> {
  const { data } = await api.get<Producto>('/productos/scan', { params: { codigo } })
  return data
}

/** POST /productos — Crear producto */
export async function crearProducto(payload: CreateProducto): Promise<ProductoDetalle> {
  const { data } = await api.post<ProductoDetalle>('/productos', payload)
  return data
}

/** PUT /productos/:id — Actualizar producto */
export async function actualizarProducto(id: string, payload: UpdateProducto): Promise<ProductoDetalle> {
  const { data } = await api.put<ProductoDetalle>(`/productos/${id}`, payload)
  return data
}

/** POST /productos/:id/reactivar — Reactivar producto eliminado (soft delete) */
export async function reactivarProducto(id: string): Promise<ProductoDetalle> {
  const { data } = await api.post<ProductoDetalle>(`/productos/${id}/reactivar`, {})
  return data
}

/** DELETE /productos/:id — Soft-delete de un producto */
export async function eliminarProducto(id: string): Promise<void> {
  await api.delete(`/productos/${id}`)
}

// ─── Presentaciones ───────────────────────────────────────────────────────────

/** GET /productos/:productoId/presentaciones — Listar presentaciones de un producto */
export async function listarPresentaciones(productoId: string): Promise<Presentacion[]> {
  const { data } = await api.get<Presentacion[]>(`/productos/${productoId}/presentaciones`)
  return data
}

/** POST /productos/:productoId/presentaciones — Crear presentación */
export async function crearPresentacion(productoId: string, payload: CreatePresentacion): Promise<Presentacion> {
  const { data } = await api.post<Presentacion>(`/productos/${productoId}/presentaciones`, payload)
  return data
}

/** PUT /presentaciones/:id — Actualizar presentación */
export async function actualizarPresentacion(id: number, payload: UpdatePresentacion): Promise<Presentacion> {
  const { data } = await api.put<Presentacion>(`/presentaciones/${id}`, payload)
  return data
}

/** DELETE /presentaciones/:id — Eliminar presentación */
export async function eliminarPresentacion(id: number): Promise<void> {
  await api.delete(`/presentaciones/${id}`)
}

// ─── Categorías ───────────────────────────────────────────────────────────────

/** GET /categorias — Listar categorías */
export async function listarCategorias(): Promise<Categoria[]> {
  const { data } = await api.get<Categoria[]>('/categorias')
  return data
}

/** POST /categorias — Crear categoría */
export async function crearCategoria(payload: CreateCategoria): Promise<Categoria> {
  const { data } = await api.post<Categoria>('/categorias', payload)
  return data
}

/** PUT /categorias/:id — Actualizar categoría */
export async function actualizarCategoria(id: number, payload: UpdateCategoria): Promise<Categoria> {
  const { data } = await api.put<Categoria>(`/categorias/${id}`, payload)
  return data
}

/** DELETE /categorias/:id — Eliminar categoría */
export async function eliminarCategoria(id: number): Promise<void> {
  await api.delete(`/categorias/${id}`)
}

// ─── Unidades Básicas ─────────────────────────────────────────────────────────

/** GET /unidades-basicas — Listar unidades básicas */
export async function listarUnidades(): Promise<UnidadBasica[]> {
  const { data } = await api.get<UnidadBasica[]>('/unidades-basicas')
  return data
}

/** POST /unidades-basicas — Crear unidad básica */
export async function crearUnidad(payload: CreateUnidadBasica): Promise<UnidadBasica> {
  const { data } = await api.post<UnidadBasica>('/unidades-basicas', payload)
  return data
}

/** PUT /unidades-basicas/:id — Actualizar unidad básica */
export async function actualizarUnidad(id: number, payload: UpdateUnidadBasica): Promise<UnidadBasica> {
  const { data } = await api.put<UnidadBasica>(`/unidades-basicas/${id}`, payload)
  return data
}

/** DELETE /unidades-basicas/:id — Eliminar unidad básica */
export async function eliminarUnidad(id: number): Promise<void> {
  await api.delete(`/unidades-basicas/${id}`)
}

// ─── Áreas ────────────────────────────────────────────────────────────────────

/** GET /areas — Listar áreas */
export async function listarAreas(): Promise<Area[]> {
  const { data } = await api.get<Area[]>('/areas')
  return data
}

/** POST /areas — Crear área */
export async function crearArea(payload: CreateArea): Promise<Area> {
  const { data } = await api.post<Area>('/areas', payload)
  return data
}

/** PUT /areas/:id — Actualizar área */
export async function actualizarArea(id: number, payload: UpdateArea): Promise<Area> {
  const { data } = await api.put<Area>(`/areas/${id}`, payload)
  return data
}

/** DELETE /areas/:id — Eliminar área */
export async function eliminarArea(id: number): Promise<void> {
  await api.delete(`/areas/${id}`)
}

// ─── Proveedores ──────────────────────────────────────────────────────────────

/** GET /proveedores — Listar proveedores */
export async function listarProveedores(params?: Partial<ProveedorQuery>): Promise<Proveedor[]> {
  const { data } = await api.get<Proveedor[]>('/proveedores', { params })
  return data
}

/** POST /proveedores — Crear proveedor */
export async function crearProveedor(payload: CreateProveedor): Promise<Proveedor> {
  const { data } = await api.post<Proveedor>('/proveedores', payload)
  return data
}

/** PUT /proveedores/:id — Actualizar proveedor */
export async function actualizarProveedor(id: number, payload: UpdateProveedor): Promise<Proveedor> {
  const { data } = await api.put<Proveedor>(`/proveedores/${id}`, payload)
  return data
}

/** DELETE /proveedores/:id — Eliminar proveedor (soft delete si aplica) */
export async function eliminarProveedor(id: number): Promise<void> {
  await api.delete(`/proveedores/${id}`)
}
