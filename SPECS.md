# SPECS — Inventario Lab Clínico
> Especificaciones de implementación · 2026-03-20
> Stack: Rust + Axum + SQLx · React 19 + TypeScript + Tailwind 4 + DaisyUI 5 + Lucide

---

## PRINCIPIOS DE DISEÑO

Estas specs toman como referencia los mejores patrones de las siguientes herramientas:
- **Linear** — filtros rápidos, feedback instantáneo, keyboard-first
- **Vercel Dashboard** — stat cards limpias, empty states cuidados, tipografía clara
- **Stripe Dashboard** — tablas de datos financieros, estados de carga, badges de estado
- **Shopify Admin** — flujos de inventario, confirmaciones destructivas, ayuda contextual
- **Raycast** — comandos, búsqueda global, atajos de teclado

**Regla principal:** el técnico de laboratorio no debe pensar — la UI hace el trabajo.

---

---

# PARTE 1 — CORRECCIONES DE SEGURIDAD

---

## SPEC-SEC-01 · Validar que la presentación pertenece al producto

**Prioridad:** CRÍTICA · **Archivo:** `backend/src/handlers/recepciones.rs`

### Problema
La query de factor de conversión solo filtra por `id`, no por `producto_id`. Un ID de presentación de otro producto pasaría la validación con un factor incorrecto.

### Fix — Backend

```rust
// ANTES (línea ~325):
sqlx::query_scalar(
    "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND activa = true",
)
.bind(pres_id)

// DESPUÉS:
sqlx::query_scalar(
    "SELECT factor_conversion FROM presentaciones
     WHERE id = $1 AND producto_id = $2 AND activa = true",
)
.bind(pres_id)
.bind(det.producto_id)  // det es el RecepcionDetalleInput actual
```

**Error a retornar si falla:**
```rust
.ok_or(AppError::Validation(format!(
    "La presentación {} no pertenece al producto {}",
    pres_id, det.producto_id
)))?
```

---

## SPEC-SEC-02 · Eliminar race condition en creación de lotes

**Prioridad:** CRÍTICA · **Archivo:** `backend/src/handlers/recepciones.rs` ~línea 591

### Fix — SQL con `ON CONFLICT`

```rust
// REEMPLAZAR la lógica SELECT → INSERT por:
let lote_id: Uuid = sqlx::query_scalar(
    r#"
    INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (producto_id, numero_lote)
    DO UPDATE SET updated_at = NOW()
    RETURNING id
    "#,
)
.bind(Uuid::new_v4())
.bind(producto_id)
.bind(numero_lote)
.bind(fecha_vencimiento)
.fetch_one(&mut **tx)
.await?;
```

> Requiere que exista `updated_at` en la tabla `lotes`. Si no existe, usar `DO NOTHING RETURNING id` con manejo del `None`.

---

## SPEC-SEC-03 · Control de acceso por área en stock y recepciones

**Prioridad:** CRÍTICA · **Archivo:** `backend/src/handlers/stock.rs`, `recepciones.rs`

### Patrón a seguir (ya existe en `consumos.rs`)

```rust
// En stock_por_area():
async fn stock_por_area(
    State(state): State<AppState>,
    claims: Claims,
    Path(area_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // AGREGAR al inicio:
    stock_ops::validar_acceso_area(&state.pool, claims.sub, area_id, &claims.rol).await?;
    // ... resto del handler
}
```

```rust
// En GET /recepciones, agregar validación si area_id está presente:
if let Some(aid) = params.area_id {
    stock_ops::validar_acceso_area(&state.pool, claims.sub, aid, &claims.rol).await?;
}
```

### Roles y acceso
| Rol | Restricción |
|-----|-------------|
| `admin` | Sin restricción — ve todas las áreas |
| `tecnologo` | Solo áreas asignadas en `usuario_areas` |
| `consulta` | Solo áreas asignadas en `usuario_areas` |

---

## SPEC-SEC-04 · Sanitizar URLs de íconos de proveedores

**Prioridad:** ALTA · **Archivo:** `frontend/src/components/ui/proveedor-select.tsx`

### Regla: solo HTTPS o emoji, nunca data: URLs

```tsx
// utils.ts — agregar helper:
export function isSafeIconUrl(url: string | null | undefined): boolean {
  if (!url) return false
  // Solo permitir HTTPS externo o rutas relativas
  return url.startsWith('https://') || url.startsWith('/')
}

// proveedor-select.tsx — reemplazar lógica de ícono:
function ProveedorIcon({ icono, size = 'md' }: ProveedorIconProps) {
  const [imgError, setImgError] = useState(false)
  const isSafeUrl = isSafeIconUrl(icono)
  const isEmoji = !!icono && !icono.startsWith('http') && !icono.startsWith('/')

  if (isEmoji) {
    return <span className={size === 'sm' ? 'text-base' : 'text-xl'}>{icono}</span>
  }
  if (isSafeUrl && !imgError) {
    return (
      <img
        src={icono!}
        alt=""
        className={size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'}
        onError={() => setImgError(true)}
        referrerPolicy="no-referrer"
      />
    )
  }
  return <Truck className={size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} />
}
```

> **Eliminar** completamente la rama `data:` — nunca renderizar data URLs de la API.

---

## SPEC-SEC-05 · Tokens JWT: mover accessToken a sessionStorage

**Prioridad:** ALTA · **Archivo:** `frontend/src/hooks/use-auth-store.ts`

### Estrategia de migración (sin romper flujo actual)

```ts
// use-auth-store.ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: MeResponse | null
  setTokens: (access: string, refresh: string) => void
  setUser: (user: MeResponse) => void
  logout: () => void
}

// accessToken → sessionStorage (se borra al cerrar tab)
// refreshToken → localStorage (persiste para re-login silencioso)
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (access, refresh) => {
        sessionStorage.setItem('lab-access-token', access)
        set({ accessToken: access, refreshToken: refresh })
      },
      setUser: (user) => set({ user }),
      logout: () => {
        sessionStorage.removeItem('lab-access-token')
        set({ accessToken: null, refreshToken: null, user: null })
      },
    }),
    {
      name: 'lab-auth-v2',
      storage: createJSONStorage(() => localStorage),
      // Solo persistir refreshToken y user, NO accessToken
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        user: state.user,
      }),
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (version < 2) {
          // Limpiar store viejo
          return { refreshToken: null, user: null }
        }
        return persistedState as Partial<AuthState>
      },
    }
  )
)
```

---

---

# PARTE 2 — CORRECCIONES DE BUGS

---

## SPEC-BUG-01 · Validación de tipo de imagen (fotos de recepciones)

**Archivo:** `backend/src/handlers/recepciones.rs` ~línea 559

```rust
// Permitir solo JPEG y PNG, rechazar SVG y otros
fn validar_data_url_imagen(data_url: &str) -> Result<(), AppError> {
    let permitidos = ["data:image/jpeg;base64,", "data:image/png;base64,"];
    if !permitidos.iter().any(|p| data_url.starts_with(p)) {
        return Err(AppError::Validation(
            "Solo se aceptan imágenes JPEG o PNG".into()
        ));
    }
    if data_url.len() > 14_000_000 {
        return Err(AppError::Validation(
            "La imagen no puede superar 10 MB".into()
        ));
    }
    // Verificar que el contenido base64 sea válido
    let base64_part = data_url.split(',').nth(1).ok_or_else(|| {
        AppError::Validation("Formato de imagen inválido".into())
    })?;
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(base64_part)
        .map_err(|_| AppError::Validation("Imagen corrupta o inválida".into()))?;
    Ok(())
}
```

---

## SPEC-BUG-02 · Eliminar N+1 queries en `stock_por_area`

**Archivo:** `backend/src/handlers/stock.rs` ~línea 278

### Query unificada con JSON aggregation

```sql
SELECT
    p.id                  AS producto_id,
    p.nombre              AS producto_nombre,
    p.codigo_interno,
    p.codigo_proveedor,
    p.stock_minimo,
    ub.nombre             AS unidad_nombre,
    ub.simbolo            AS unidad_simbolo,
    COALESCE(SUM(s.cantidad), 0) AS stock_total,
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'lote_id',          l.id,
            'numero_lote',      l.numero_lote,
            'cantidad',         s.cantidad,
            'fecha_vencimiento', l.fecha_vencimiento
        ) ORDER BY l.fecha_vencimiento ASC NULLS LAST
    ) FILTER (WHERE s.cantidad > 0) AS lotes
FROM productos p
JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
JOIN lotes l ON l.producto_id = p.id
JOIN stock s ON s.lote_id = l.id AND s.area_id = $1
WHERE s.cantidad > 0
  AND p.activo = true
GROUP BY p.id, p.nombre, p.codigo_interno, p.codigo_proveedor,
         p.stock_minimo, ub.nombre, ub.simbolo
ORDER BY p.nombre ASC
```

Deserializar `lotes` desde el JSON con `serde_json::from_value`.

---

## SPEC-BUG-03 · Alertas: query única con CTE + paginación

**Archivo:** `backend/src/handlers/stock.rs` ~línea 318

### Agregar parámetros de paginación

```rust
#[derive(Deserialize)]
struct AlertasParams {
    #[serde(default = "default_page")]
    page: i64,
    #[serde(default = "default_per_page")]
    per_page: i64,  // max 100
}
```

### Query unificada

```sql
WITH stock_producto AS (
    SELECT
        l.producto_id,
        p.nombre,
        p.stock_minimo,
        ub.simbolo AS unidad,
        SUM(s.cantidad) AS total,
        MIN(CASE WHEN l.fecha_vencimiento IS NOT NULL
            THEN l.fecha_vencimiento END) AS proxima_fecha_venc
    FROM stock s
    JOIN lotes l ON l.id = s.lote_id
    JOIN productos p ON p.id = l.producto_id
    JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
    WHERE s.cantidad > 0 AND p.activo = true
    GROUP BY l.producto_id, p.nombre, p.stock_minimo, ub.simbolo
)
SELECT
    producto_id,
    nombre,
    total,
    unidad,
    proxima_fecha_venc,
    stock_minimo,
    CASE
        WHEN proxima_fecha_venc < CURRENT_DATE THEN 'vencido'
        WHEN proxima_fecha_venc <= CURRENT_DATE + 30 THEN 'vence_30d'
        WHEN proxima_fecha_venc <= CURRENT_DATE + 90 THEN 'vence_90d'
        WHEN stock_minimo > 0 AND total < stock_minimo THEN 'bajo_minimo'
    END AS tipo_alerta
FROM stock_producto
WHERE
    (stock_minimo > 0 AND total < stock_minimo)
    OR proxima_fecha_venc <= CURRENT_DATE + 90
ORDER BY
    CASE WHEN proxima_fecha_venc < CURRENT_DATE THEN 0
         WHEN proxima_fecha_venc <= CURRENT_DATE + 30 THEN 1
         WHEN stock_minimo > 0 AND total < stock_minimo THEN 2
         ELSE 3 END,
    proxima_fecha_venc ASC NULLS LAST,
    nombre ASC
LIMIT $1 OFFSET $2
```

---

## SPEC-BUG-04 · Optimistic locking consistente en todos los handlers

**Archivos:** `backend/src/handlers/proveedores.rs`, `presentaciones.rs`, `usuarios.rs`

### Patrón a replicar del handler de productos

```rust
// En cualquier UPDATE de entidad con campo version:
let filas = sqlx::query(
    "UPDATE proveedores
     SET nombre = $1, ..., version = version + 1, updated_at = NOW()
     WHERE id = $2 AND version = $3",
)
.bind(&req.nombre)
.bind(id)
.bind(req.version)   // version viene del request del cliente
.execute(&mut *tx)
.await?;

if filas.rows_affected() == 0 {
    return Err(AppError::Conflict(
        "El registro fue modificado por otro usuario. Recarga e intenta de nuevo.".into()
    ));
}
```

**DTO a agregar en todos los UpdateXxx:**
```rust
pub struct UpdateProveedor {
    pub version: i32,  // obligatorio
    // ... resto de campos
}
```

---

## SPEC-BUG-05 · Validación de email con regex correcta

**Archivo:** `backend/src/errors.rs`

```rust
// Agregar a Cargo.toml: regex = "1"
use regex::Regex;
use std::sync::OnceLock;

static EMAIL_RE: OnceLock<Regex> = OnceLock::new();

pub fn validate_email(email: &str) -> Result<(), AppError> {
    let re = EMAIL_RE.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$").unwrap()
    });
    if !re.is_match(email) {
        return Err(AppError::Validation("Formato de email inválido".into()));
    }
    if email.len() > 254 {
        return Err(AppError::Validation("Email demasiado largo".into()));
    }
    Ok(())
}
```

---

## SPEC-BUG-06 · Validar `per_page` en todos los handlers paginados

**Patrón universal para DTOs de paginación:**

```rust
// En DTOs de paginación (src/dtos/pagination.rs o donde se defina):
impl PaginationParams {
    pub fn validated(self) -> Result<Self, AppError> {
        if self.per_page < 1 {
            return Err(AppError::Validation("per_page debe ser >= 1".into()));
        }
        if self.per_page > 200 {
            return Err(AppError::Validation("per_page no puede superar 200".into()));
        }
        Ok(self)
    }
}

// En cada handler:
let params = params.validated()?;
```

---

---

# PARTE 3 — MEJORAS DE UX

---

## SPEC-UX-01 · Modal de confirmación para acciones destructivas

**Archivos:** todos los pages con DELETE

### Componente reutilizable con DaisyUI

```tsx
// components/ui/confirm-dialog.tsx
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
  title: string
  description: string
  confirmLabel?: string
  variant?: 'danger' | 'warning'
}

export function ConfirmDialog({
  open, onClose, onConfirm, loading,
  title, description,
  confirmLabel = 'Confirmar',
  variant = 'danger',
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-lg ${
            variant === 'danger' ? 'bg-error/10' : 'bg-warning/10'
          }`}>
            <AlertTriangle className={`w-5 h-5 ${
              variant === 'danger' ? 'text-error' : 'text-warning'
            }`} />
          </div>
          <div>
            <h3 className="font-semibold text-base-content">{title}</h3>
            <p className="text-sm text-base-content/60 mt-1">{description}</p>
          </div>
        </div>
        <div className="modal-action mt-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            className={`btn btn-sm ${variant === 'danger' ? 'btn-error' : 'btn-warning'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <span className="loading loading-spinner loading-xs" />}
            {confirmLabel}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}
```

**Uso en recepciones:**
```tsx
const [deletingId, setDeletingId] = useState<string | null>(null)

<ConfirmDialog
  open={!!deletingId}
  onClose={() => setDeletingId(null)}
  onConfirm={() => deleteMutation.mutate(deletingId!)}
  loading={deleteMutation.isPending}
  title="Eliminar borrador"
  description="Esta acción no se puede deshacer. El borrador y todos sus ítems serán eliminados permanentemente."
  confirmLabel="Sí, eliminar"
  variant="danger"
/>
```

---

## SPEC-UX-02 · Error boundary global con fallback visual

**Archivo:** `frontend/src/components/ui/error-boundary.tsx` (nuevo)

```tsx
import { Component, ReactNode } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'

interface Props { children: ReactNode; fallbackMessage?: string }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary capturó:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200">
        <div className="card bg-base-100 shadow-lg max-w-md w-full mx-4">
          <div className="card-body items-center text-center gap-4">
            <div className="p-4 bg-error/10 rounded-full">
              <AlertCircle className="w-8 h-8 text-error" />
            </div>
            <div>
              <h2 className="card-title justify-center">Algo salió mal</h2>
              <p className="text-base-content/60 text-sm mt-1">
                {this.props.fallbackMessage ??
                  'Ocurrió un error inesperado. Recarga la página para continuar.'}
              </p>
            </div>
            {import.meta.env.DEV && (
              <div className="alert alert-error text-left w-full">
                <code className="text-xs break-all">
                  {this.state.error?.message}
                </code>
              </div>
            )}
            <button
              className="btn btn-primary btn-sm gap-2"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="w-4 h-4" />
              Recargar
            </button>
          </div>
        </div>
      </div>
    )
  }
}
```

**En App.tsx:**
```tsx
<ErrorBoundary>
  <RouterProvider router={router} />
</ErrorBoundary>
```

---

## SPEC-UX-03 · Helper de errores API centralizado

**Archivo:** `frontend/src/lib/api-error.ts` (nuevo)

```ts
interface ApiErrorBody {
  error?: string
  message?: string
  details?: string
}

export function parseApiError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Error inesperado'
  const e = err as { response?: { status?: number; data?: ApiErrorBody }; message?: string }

  const data = e.response?.data
  const status = e.response?.status

  // Usar mensaje del backend si existe
  if (data?.message) return data.message
  if (data?.error) return data.error

  // Mensajes por status HTTP
  switch (status) {
    case 400: return 'Datos inválidos. Revisa el formulario.'
    case 401: return 'Credenciales inválidas o sesión expirada.'
    case 403: return 'No tienes permisos para esta acción.'
    case 404: return 'El recurso no fue encontrado.'
    case 409: return 'Conflicto: el registro fue modificado por otro usuario.'
    case 422: return data?.details ?? 'Error de validación.'
    case 500: return 'Error del servidor. Intenta en unos minutos.'
    default:
      if (!navigator.onLine) return 'Sin conexión a internet.'
      return e.message ?? 'Error de conexión.'
  }
}
```

**Uso:**
```tsx
} catch (err) {
  setError(parseApiError(err))
}
```

---

## SPEC-UX-04 · Loading state y disable en formularios de mutación

**Patrón para cualquier formulario con mutación (recepciones/nueva, etc.):**

```tsx
const mutation = useMutation({ mutationFn: crearRecepcion })

// Botón de submit:
<button
  type="submit"
  className="btn btn-primary gap-2"
  disabled={mutation.isPending}
>
  {mutation.isPending ? (
    <>
      <span className="loading loading-spinner loading-sm" />
      Guardando...
    </>
  ) : (
    <>
      <Save className="w-4 h-4" />
      Guardar recepción
    </>
  )}
</button>

// Toast en onSuccess / onError:
onSuccess: () => {
  toast.success('Recepción guardada correctamente')
  navigate('/recepciones')
},
onError: (err) => {
  toast.error(parseApiError(err))
},
```

---

## SPEC-UX-05 · Sidebar activo en sub-rutas

**Archivo:** `frontend/src/components/layout/sidebar.tsx`

```tsx
import { useLocation } from 'react-router-dom'

// En el componente:
const location = useLocation()

// Reemplazar condición de link activo:
// ANTES:
const isActive = location.pathname === item.href
// DESPUÉS:
const isActive = item.href === '/'
  ? location.pathname === '/'
  : location.pathname.startsWith(item.href)
```

---

## SPEC-UX-06 · Breadcrumb y navegación de regreso en detalle de recepción

**Archivo:** `frontend/src/pages/recepciones/detalle.tsx`

```tsx
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ArrowLeft } from 'lucide-react'

// En el header de la página:
<div className="flex items-center gap-2 mb-6">
  {/* Botón volver (visible en móvil) */}
  <button
    className="btn btn-ghost btn-sm gap-1 lg:hidden"
    onClick={() => navigate('/recepciones')}
  >
    <ArrowLeft className="w-4 h-4" />
    Volver
  </button>

  {/* Breadcrumb (visible en desktop) */}
  <div className="breadcrumbs text-sm hidden lg:flex">
    <ul>
      <li>
        <button
          className="link link-hover text-base-content/60"
          onClick={() => navigate('/recepciones')}
        >
          Recepciones
        </button>
      </li>
      <li className="text-base-content font-medium">
        {recepcion?.numero_documento ?? '...'}
      </li>
    </ul>
  </div>
</div>
```

---

## SPEC-UX-07 · PDF con metadata de auditoría

**Archivo:** `frontend/src/lib/stock-pdf.ts`

Agregar en el header del PDF:

```ts
// En la función que genera el header:
const ahora = new Date()
const fechaGeneracion = ahora.toLocaleString('es-CL', {
  day: '2-digit', month: 'long', year: 'numeric',
  hour: '2-digit', minute: '2-digit'
})

doc.setFontSize(8)
doc.setTextColor(120, 120, 120)
doc.text(
  `Generado el ${fechaGeneracion} por ${user.nombre}`,
  pageWidth / 2,
  headerY + 12,
  { align: 'center' }
)

// Footer con filtros aplicados:
const filtrosTexto = [
  filtroArea ? `Área: ${filtroArea}` : 'Todas las áreas',
  filtroCategoria ? `Categoría: ${filtroCategoria}` : null,
  filtroBusqueda ? `Búsqueda: "${filtroBusqueda}"` : null,
].filter(Boolean).join(' · ')

doc.text(`Filtros: ${filtrosTexto}`, margen, pageHeight - 8)
```

---

## SPEC-UX-08 · Empty state personalizable en DataTable

**Archivo:** `frontend/src/components/ui/data-table.tsx`

```tsx
// Agregar prop:
interface DataTableProps<T> {
  // ... props existentes
  emptyState?: {
    icon?: ReactNode
    title: string
    description?: string
    action?: ReactNode
  }
}

// En el render cuando no hay datos:
if (data.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      {emptyState?.icon ?? (
        <div className="p-4 bg-base-200 rounded-full">
          <PackageX className="w-8 h-8 text-base-content/30" />
        </div>
      )}
      <div>
        <p className="font-medium text-base-content/70">
          {emptyState?.title ?? 'Sin resultados'}
        </p>
        {emptyState?.description && (
          <p className="text-sm text-base-content/40 mt-1">
            {emptyState.description}
          </p>
        )}
      </div>
      {emptyState?.action}
    </div>
  )
}
```

**Ejemplo de uso en stock:**
```tsx
<DataTable
  emptyState={{
    title: 'Sin insumos en esta área',
    description: 'No hay stock registrado con los filtros actuales.',
    action: (
      <button className="btn btn-sm btn-ghost" onClick={clearFilters}>
        Limpiar filtros
      </button>
    )
  }}
/>
```

---

---

# PARTE 4 — NUEVA FUNCIONALIDAD

---

## SPEC-FEAT-01 · Setup inicial / Importación CSV

### Backend — 6 endpoints

```
POST   /api/v1/setup/iniciar          → Poner sistema en modo setup
POST   /api/v1/setup/importar/csv     → Importar productos desde CSV
GET    /api/v1/setup/importar/estado  → Estado del proceso de importación
POST   /api/v1/setup/importar/preview → Preview de CSV antes de confirmar
POST   /api/v1/setup/importar/confirmar → Confirmar y ejecutar la carga
POST   /api/v1/setup/finalizar        → Cerrar modo setup
```

### Formato del CSV esperado

```csv
codigo_interno,nombre,descripcion,categoria,unidad_simbolo,proveedor,stock_minimo,codigo_proveedor
INS-001,Guante de látex talla S,Caja 100 unidades,EPP,un,LabSur SA,5,GLT-S
INS-002,Tubo vacutainer EDTA 3mL,,Hematología,un,BioMedical,10,TBE-3
```

### Handler de preview en Rust

```rust
#[derive(Deserialize)]
pub struct CsvImportRequest {
    pub csv_base64: String,  // CSV codificado en base64 desde el frontend
}

#[derive(Serialize)]
pub struct CsvPreviewRow {
    pub linea: i32,
    pub codigo_interno: String,
    pub nombre: String,
    pub categoria: String,
    pub categoria_existe: bool,
    pub unidad_existe: bool,
    pub proveedor_existe: bool,
    pub error: Option<String>,
}

async fn preview_csv(
    State(state): State<AppState>,
    claims: Claims,
    Json(req): Json<CsvImportRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    claims.require_admin()?;

    let csv_bytes = base64::engine::general_purpose::STANDARD
        .decode(&req.csv_base64)
        .map_err(|_| AppError::Validation("CSV inválido".into()))?;

    let csv_str = String::from_utf8(csv_bytes)
        .map_err(|_| AppError::Validation("CSV debe ser UTF-8".into()))?;

    // Parsear con el crate `csv`
    // Por cada fila, verificar que categoría/unidad/proveedor existan en BD
    // Retornar preview con errores por fila
    todo!()
}
```

### Frontend — Página Setup (`/setup`)

```
Paso 1: Descargar plantilla CSV
Paso 2: Subir CSV → Preview de la tabla
Paso 3: Revisar errores (filas con error se resaltan en rojo)
Paso 4: Confirmar importación → Barra de progreso
Paso 5: Resumen (X productos importados, Y errores)
```

**Componente visual (DaisyUI steps):**

```tsx
// pages/setup/index.tsx
const PASOS = [
  { id: 1, label: 'Plantilla' },
  { id: 2, label: 'Subir CSV' },
  { id: 3, label: 'Revisión' },
  { id: 4, label: 'Importar' },
  { id: 5, label: 'Listo' },
]

<ul className="steps steps-horizontal w-full mb-8">
  {PASOS.map((paso) => (
    <li
      key={paso.id}
      className={`step ${pasoActual >= paso.id ? 'step-primary' : ''}`}
    >
      {paso.label}
    </li>
  ))}
</ul>
```

**Preview de CSV con resaltado de errores:**

```tsx
// Tabla de preview
<div className="overflow-x-auto">
  <table className="table table-sm table-zebra">
    <thead>
      <tr>
        <th>#</th><th>Código</th><th>Nombre</th>
        <th>Categoría</th><th>Unidad</th><th>Proveedor</th><th>Estado</th>
      </tr>
    </thead>
    <tbody>
      {preview.map((row) => (
        <tr key={row.linea} className={row.error ? 'bg-error/10' : ''}>
          <td className="text-base-content/40">{row.linea}</td>
          <td className="font-mono text-sm">{row.codigo_interno}</td>
          <td>{row.nombre}</td>
          <td>
            <span className={`badge badge-sm ${
              row.categoria_existe ? 'badge-success' : 'badge-error'
            }`}>
              {row.categoria}
            </span>
          </td>
          <td>
            <span className={`badge badge-sm ${
              row.unidad_existe ? 'badge-success' : 'badge-error'
            }`}>
              {row.unidad_simbolo}
            </span>
          </td>
          <td>
            <span className={`badge badge-sm ${
              row.proveedor_existe ? 'badge-success' : 'badge-ghost'
            }`}>
              {row.proveedor}
            </span>
          </td>
          <td>
            {row.error
              ? <span className="text-error text-xs">{row.error}</span>
              : <span className="text-success text-xs">✓ OK</span>
            }
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

---

## SPEC-FEAT-02 · Página de Consumos

**Ruta:** `/consumos`
**Archivo:** `frontend/src/pages/consumos/index.tsx`

### Layout visual — inspirado en Stripe (acción rápida + historial)

```
┌──────────────────────────────────────────────────────────────┐
│  CONSUMOS                                    [+ Nuevo Consumo]│
├──────────────┬───────────────────────────────────────────────┤
│              │  Historial de consumos                        │
│  Consumo     │  ┌─────────────────────────────────────────┐ │
│  Rápido      │  │ Filtros: área · producto · fecha        │ │
│  ──────────  │  ├─────────────────────────────────────────┤ │
│  Producto    │  │ MOV-000123 │ Guante látex │ 5 un │ Área 3│ │
│  Área        │  │ MOV-000122 │ Tubo EDTA    │ 10 un│ Área 1│ │
│  Cantidad    │  │ ...                                     │ │
│  [Registrar] │  └─────────────────────────────────────────┘ │
└──────────────┴───────────────────────────────────────────────┘
```

### Formulario de consumo rápido

```tsx
// Componente principal
export function ConsumoRapido() {
  return (
    <div className="card bg-base-100 border border-base-200 shadow-sm">
      <div className="card-body gap-4">
        <h3 className="card-title text-sm font-semibold uppercase tracking-wide
                       text-base-content/50">
          Consumo rápido
        </h3>

        {/* Búsqueda de producto con autocomplete */}
        <ProductoSearch
          onSelect={setProductoId}
          placeholder="Buscar insumo..."
        />

        {/* Área (prellenada con área del usuario) */}
        <AreaSelect value={areaId} onChange={setAreaId} />

        {/* Cantidad */}
        <div className="form-control">
          <label className="label">
            <span className="label-text">Cantidad</span>
            {stockDisponible !== null && (
              <span className="label-text-alt text-base-content/40">
                Disponible: {stockDisponible} {unidad}
              </span>
            )}
          </label>
          <input
            type="number"
            min={1}
            max={stockDisponible ?? undefined}
            className="input input-bordered input-sm"
            value={cantidad}
            onChange={e => setCantidad(Number(e.target.value))}
          />
        </div>

        {/* Stock insuficiente warning */}
        {stockDisponible !== null && cantidad > stockDisponible && (
          <div className="alert alert-warning py-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs">
              Stock insuficiente. Disponible: {stockDisponible} {unidad}
            </span>
          </div>
        )}

        <button
          className="btn btn-primary btn-sm w-full gap-2"
          disabled={!productoId || !areaId || cantidad < 1 || mutation.isPending}
          onClick={handleSubmit}
        >
          {mutation.isPending
            ? <span className="loading loading-spinner loading-xs" />
            : <Minus className="w-4 h-4" />
          }
          Registrar consumo
        </button>
      </div>
    </div>
  )
}
```

### Modal de consumo batch

```tsx
// Inspirado en Linear: agregar múltiples items antes de confirmar
// Tabla editable con filas tipo spreadsheet

interface BatchItem {
  productoId: string
  productoNombre: string
  areaId: string
  cantidad: number
  unidad: string
}

<div className="modal modal-open">
  <div className="modal-box max-w-2xl">
    <h3 className="font-semibold mb-4">Consumo en lote</h3>

    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Insumo</th>
            <th>Área</th>
            <th>Cantidad</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td className="font-medium text-sm">{item.productoNombre}</td>
              <td className="text-sm text-base-content/60">{item.areaNombre}</td>
              <td>
                <input
                  type="number"
                  className="input input-bordered input-xs w-20"
                  value={item.cantidad}
                  onChange={e => updateItem(i, 'cantidad', Number(e.target.value))}
                />
                <span className="text-xs text-base-content/40 ml-1">{item.unidad}</span>
              </td>
              <td>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => removeItem(i)}
                >
                  <X className="w-3 h-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <button className="btn btn-ghost btn-sm gap-1 mt-2" onClick={addEmptyItem}>
      <Plus className="w-4 h-4" />
      Agregar ítem
    </button>

    <div className="modal-action">
      <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
      <button
        className="btn btn-primary btn-sm gap-2"
        disabled={items.length === 0 || mutation.isPending}
        onClick={() => mutation.mutate(items)}
      >
        {mutation.isPending && <span className="loading loading-spinner loading-xs" />}
        Registrar {items.length} consumo{items.length !== 1 ? 's' : ''}
      </button>
    </div>
  </div>
</div>
```

---

## SPEC-FEAT-03 · Página de Transferencias y Descartes

**Ruta:** `/descartes`
**Archivo:** `frontend/src/pages/descartes/index.tsx`

### Layout con tabs

```tsx
// DaisyUI tabs
<div className="tabs tabs-border mb-6">
  <button
    className={`tab ${activeTab === 'transferencia' ? 'tab-active' : ''}`}
    onClick={() => setActiveTab('transferencia')}
  >
    <ArrowLeftRight className="w-4 h-4 mr-2" />
    Transferencia
  </button>
  <button
    className={`tab ${activeTab === 'descarte' ? 'tab-active' : ''}`}
    onClick={() => setActiveTab('descarte')}
  >
    <Trash2 className="w-4 h-4 mr-2" />
    Descarte
  </button>
</div>
```

### Formulario de transferencia

```tsx
// Dos areas lado a lado con flecha
<div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
  <div className="form-control">
    <label className="label"><span className="label-text">Área origen</span></label>
    <AreaSelect value={areaOrigen} onChange={setAreaOrigen} />
  </div>

  <div className="flex flex-col items-center gap-1 pt-6">
    <ArrowRight className="w-5 h-5 text-base-content/40" />
  </div>

  <div className="form-control">
    <label className="label"><span className="label-text">Área destino</span></label>
    <AreaSelect
      value={areaDestino}
      onChange={setAreaDestino}
      exclude={[areaOrigen]}
    />
  </div>
</div>
```

### Formulario de descarte (masivo)

```tsx
// Tabla de lotes seleccionables para descartar
// Muestra: producto, lote, vencimiento, cantidad disponible, cantidad a descartar
// Motivo obligatorio con opciones: vencido | dañado | contaminado | otro
<div className="form-control mt-4">
  <label className="label"><span className="label-text">Motivo del descarte</span></label>
  <select className="select select-bordered select-sm">
    <option value="">Seleccionar motivo...</option>
    <option value="vencido">Producto vencido</option>
    <option value="dañado">Producto dañado</option>
    <option value="contaminado">Contaminación</option>
    <option value="otro">Otro (especificar)</option>
  </select>
</div>
```

---

## SPEC-FEAT-04 · Página de Movimientos / Historial

**Ruta:** `/movimientos`
**Archivo:** `frontend/src/pages/movimientos/index.tsx`

### Diseño inspirado en Vercel Activity Log

```
┌─────────────────────────────────────────────────────────┐
│ HISTORIAL DE MOVIMIENTOS                                │
│                                                         │
│ [Tipo ▼] [Área ▼] [Producto] [Fecha desde] [Fecha hasta]│
├─────────────────────────────────────────────────────────┤
│ 2026-03-20                                              │
│ ─────────────────────────────────────────────────────── │
│ ● 14:32  MOV-000150  Consumo  Guante látex  -5 un  Área3│
│ ● 14:15  MOV-000149  Ingreso  Tubo EDTA    +50 un  Área1│
│                                                         │
│ 2026-03-19                                              │
│ ─────────────────────────────────────────────────────── │
│ ● 16:45  MOV-000148  Transfer Guante...   -10/+10  A2→A1│
└─────────────────────────────────────────────────────────┘
```

```tsx
// Íconos y colores por tipo de movimiento
const TIPO_CONFIG = {
  ingreso:       { icon: ArrowDownCircle, color: 'text-success', label: 'Ingreso' },
  consumo:       { icon: Minus,           color: 'text-error',   label: 'Consumo' },
  transferencia: { icon: ArrowLeftRight,  color: 'text-info',    label: 'Transferencia' },
  descarte:      { icon: Trash2,          color: 'text-warning', label: 'Descarte' },
  ajuste:        { icon: Settings,        color: 'text-base-content/60', label: 'Ajuste' },
}

// Agrupar por fecha
const porFecha = useMemo(() =>
  groupBy(movimientos, m => formatDate(m.created_at)),
[movimientos])
```

---

## SPEC-FEAT-05 · Gestión de Usuarios

**Ruta:** `/usuarios`
**Archivo:** `frontend/src/pages/usuarios/index.tsx`

### Vista de tarjetas de usuario (no tabla)

```tsx
// Inspirado en Notion team settings
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
  {usuarios.map((u) => (
    <div
      key={u.id}
      className="card bg-base-100 border border-base-200 shadow-sm
                 hover:border-primary/30 transition-colors"
    >
      <div className="card-body p-4">
        <div className="flex items-center gap-3">
          {/* Avatar con inicial */}
          <div className="avatar placeholder">
            <div className="bg-primary text-primary-content rounded-full w-10">
              <span className="text-sm font-semibold">
                {u.nombre.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{u.nombre}</p>
            <p className="text-xs text-base-content/50 truncate">{u.email}</p>
          </div>
          <RolBadge rol={u.rol} />
        </div>

        {/* Áreas asignadas */}
        <div className="flex flex-wrap gap-1 mt-2">
          {u.areas?.slice(0, 3).map((a) => (
            <span key={a.id} className="badge badge-ghost badge-sm">{a.nombre}</span>
          ))}
          {(u.areas?.length ?? 0) > 3 && (
            <span className="badge badge-ghost badge-sm">
              +{u.areas!.length - 3}
            </span>
          )}
        </div>

        {/* Acciones */}
        <div className="card-actions justify-end mt-2">
          <button
            className="btn btn-ghost btn-xs gap-1"
            onClick={() => openEdit(u)}
          >
            <Pencil className="w-3 h-3" />
            Editar
          </button>
          <button
            className={`btn btn-xs gap-1 ${
              u.activo ? 'btn-ghost text-error' : 'btn-ghost text-success'
            }`}
            onClick={() => toggleActivo(u)}
          >
            {u.activo ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
            {u.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>
    </div>
  ))}
</div>
```

**Badges de rol:**
```tsx
function RolBadge({ rol }: { rol: string }) {
  const config = {
    admin:     { label: 'Admin',      cls: 'badge-error' },
    tecnologo: { label: 'Tecnólogo',  cls: 'badge-primary' },
    consulta:  { label: 'Consulta',   cls: 'badge-ghost' },
  }
  const c = config[rol as keyof typeof config] ?? { label: rol, cls: 'badge-neutral' }
  return <span className={`badge badge-sm ${c.cls}`}>{c.label}</span>
}
```

---

## SPEC-FEAT-06 · Audit Log

**Ruta:** `/audit-log`
**Archivo:** `frontend/src/pages/audit-log/index.tsx`

### Diseño de timeline (DaisyUI)

```tsx
<ul className="timeline timeline-vertical timeline-compact">
  {entries.map((entry) => (
    <li key={entry.id}>
      <div className="timeline-start text-xs text-base-content/40 whitespace-nowrap">
        {formatDateTime(entry.created_at)}
      </div>
      <div className="timeline-middle">
        <div className={`w-2 h-2 rounded-full ${
          entry.accion === 'DELETE' ? 'bg-error' :
          entry.accion === 'CREATE' ? 'bg-success' : 'bg-info'
        }`} />
      </div>
      <div className="timeline-end timeline-box text-sm">
        <span className="font-medium">{entry.usuario_nombre}</span>
        {' '}
        <span className="text-base-content/60">
          {entry.accion.toLowerCase()} {entry.entidad} #{entry.entidad_id?.slice(0, 8)}
        </span>
        {entry.cambios && (
          <details className="mt-1">
            <summary className="text-xs text-base-content/40 cursor-pointer">
              Ver cambios
            </summary>
            <pre className="text-xs mt-1 bg-base-200 p-2 rounded overflow-x-auto">
              {JSON.stringify(entry.cambios, null, 2)}
            </pre>
          </details>
        )}
      </div>
      <hr />
    </li>
  ))}
</ul>
```

---

## SPEC-FEAT-07 · Mejoras al módulo de Stock

### 7.1 · Tabs de vista: Resumen global / Por área

```tsx
<div className="tabs tabs-border mb-6">
  <button className={`tab ${vista === 'global' ? 'tab-active' : ''}`}
    onClick={() => setVista('global')}>
    <LayoutGrid className="w-4 h-4 mr-2" />
    Resumen global
  </button>
  <button className={`tab ${vista === 'area' ? 'tab-active' : ''}`}
    onClick={() => setVista('area')}>
    <MapPin className="w-4 h-4 mr-2" />
    Por área
  </button>
  <button className={`tab ${vista === 'alertas' ? 'tab-active' : ''}`}
    onClick={() => setVista('alertas')}>
    <Bell className="w-4 h-4 mr-2" />
    Alertas
    {totalAlertas > 0 && (
      <span className="badge badge-error badge-sm ml-2">{totalAlertas}</span>
    )}
  </button>
</div>
```

### 7.2 · Stat cards en resumen — DaisyUI stats

```tsx
<div className="stats stats-horizontal shadow-sm w-full mb-6 bg-base-100 border border-base-200">
  <div className="stat">
    <div className="stat-figure text-primary">
      <Package className="w-7 h-7" />
    </div>
    <div className="stat-title">Insumos en stock</div>
    <div className="stat-value text-primary">{resumen.total_productos}</div>
    <div className="stat-desc">productos distintos</div>
  </div>

  <div className="stat">
    <div className="stat-figure text-warning">
      <TrendingDown className="w-7 h-7" />
    </div>
    <div className="stat-title">Bajo mínimo</div>
    <div className="stat-value text-warning">{resumen.bajo_minimo}</div>
    <div className="stat-desc">requieren reposición</div>
  </div>

  <div className="stat">
    <div className="stat-figure text-error">
      <Clock className="w-7 h-7" />
    </div>
    <div className="stat-title">Por vencer (90d)</div>
    <div className="stat-value text-error">{resumen.por_vencer_90d}</div>
    <div className="stat-desc">en los próximos 90 días</div>
  </div>
</div>
```

### 7.3 · Barra de stock con color semántico en stock-detail

```tsx
// Reemplazar/mejorar la barra de porcentaje actual:
function StockBar({ cantidad, minimo }: { cantidad: number; minimo: number | null }) {
  const pct = minimo && minimo > 0
    ? Math.min((cantidad / (minimo * 2)) * 100, 100)
    : 100

  const color =
    cantidad === 0 ? 'progress-error' :
    (minimo && cantidad < minimo) ? 'progress-warning' :
    'progress-success'

  return (
    <div>
      <progress
        className={`progress ${color} w-full h-2`}
        value={pct}
        max={100}
      />
      <div className="flex justify-between text-xs text-base-content/40 mt-0.5">
        <span>{cantidad} disponible</span>
        {minimo && <span>Mín: {minimo}</span>}
      </div>
    </div>
  )
}
```

---

## SPEC-FEAT-08 · Mejoras a Recepciones

### 8.1 · Badge de estado con colores semánticos

```tsx
function EstadoBadge({ estado }: { estado: string }) {
  const config = {
    borrador:  { label: 'Borrador',  cls: 'badge-warning',  icon: FileEdit },
    completa:  { label: 'Completa',  cls: 'badge-success',  icon: CheckCircle2 },
    anulada:   { label: 'Anulada',   cls: 'badge-error',    icon: XCircle },
  }
  const c = config[estado as keyof typeof config]
  const Icon = c?.icon ?? Circle
  return (
    <span className={`badge gap-1 ${c?.cls ?? 'badge-ghost'}`}>
      <Icon className="w-3 h-3" />
      {c?.label ?? estado}
    </span>
  )
}
```

### 8.2 · Indicador de foto en listado

```tsx
// En la columna de foto del listado:
{row.foto_documento ? (
  <div className="tooltip" data-tip="Tiene foto adjunta">
    <ImageIcon className="w-4 h-4 text-success" />
  </div>
) : (
  <div className="tooltip" data-tip="Sin foto">
    <ImageOff className="w-4 h-4 text-base-content/20" />
  </div>
)}
```

### 8.3 · Filtros activos como chips (inspirado en Linear)

```tsx
// Mostrar filtros activos debajo de la barra de búsqueda:
{hayFiltrosActivos && (
  <div className="flex flex-wrap gap-2 mt-2">
    {proveedorId && (
      <span className="badge badge-outline gap-1">
        <Building2 className="w-3 h-3" />
        {proveedorNombre}
        <button onClick={() => setProveedorId(null)}>
          <X className="w-3 h-3" />
        </button>
      </span>
    )}
    {estado && (
      <span className="badge badge-outline gap-1">
        {estado}
        <button onClick={() => setEstado(null)}>
          <X className="w-3 h-3" />
        </button>
      </span>
    )}
    <button
      className="text-xs text-base-content/40 hover:text-base-content underline"
      onClick={clearAllFilters}
    >
      Limpiar todo
    </button>
  </div>
)}
```

---

---

# PARTE 5 — DEUDA TÉCNICA

---

## SPEC-TECH-01 · Reemplazar unwrap() en config y main

**Archivo:** `backend/src/config.rs`

```rust
// ANTES:
let jwt_secret = env::var("JWT_SECRET").expect("JWT_SECRET must be set");

// DESPUÉS — retornar error estructurado:
pub fn load() -> Result<Config, String> {
    let jwt_secret = env::var("JWT_SECRET")
        .map_err(|_| "Variable JWT_SECRET no está definida")?;

    if jwt_secret.len() < 32 {
        return Err(format!(
            "JWT_SECRET debe tener al menos 32 caracteres (tiene {})",
            jwt_secret.len()
        ));
    }
    // ...
    Ok(Config { jwt_secret, ... })
}

// En main.rs:
let config = Config::load().unwrap_or_else(|e| {
    eprintln!("ERROR DE CONFIGURACIÓN: {}", e);
    std::process::exit(1);
});
```

---

## SPEC-TECH-02 · Índices de base de datos faltantes

**Nueva migración:** `backend/migrations/013_indices_performance.sql`

```sql
-- FK de alta frecuencia en recepcion_detalle
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recepcion_detalle_recepcion_id
    ON recepcion_detalle(recepcion_id);

-- Stock por área (queries de stock_por_area y alertas)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_area_cantidad
    ON stock(area_id, cantidad) WHERE cantidad > 0;

-- Movimientos por fecha (historial paginado)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimientos_created_at
    ON movimientos(created_at DESC);

-- Movimientos por producto (trazabilidad)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimientos_producto_id
    ON movimientos(producto_id);

-- Lotes por vencimiento (alertas)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lotes_fecha_vencimiento
    ON lotes(fecha_vencimiento) WHERE fecha_vencimiento IS NOT NULL;

-- Audit log por entidad (búsqueda de auditoría)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_entidad
    ON audit_log(entidad, entidad_id);
```

---

## SPEC-TECH-03 · Query keys tipadas con React Query

**Archivo:** `frontend/src/lib/query-keys.ts` (nuevo)

```ts
export const QK = {
  stock: {
    all: ['stock'] as const,
    list: (p: StockParams) => ['stock', 'list', p] as const,
    area: (areaId: string) => ['stock', 'area', areaId] as const,
    alertas: (p: AlertasParams) => ['stock', 'alertas', p] as const,
  },
  recepciones: {
    all: ['recepciones'] as const,
    list: (p: RecepcionesParams) => ['recepciones', 'list', p] as const,
    detail: (id: string) => ['recepciones', id] as const,
  },
  productos: {
    all: ['productos'] as const,
    list: (p: ProductosParams) => ['productos', 'list', p] as const,
    detail: (id: string) => ['productos', id] as const,
  },
  creador_productos: {
    categorias: ['creador_productos', 'categorias'] as const,
    areas: ['creador_productos', 'areas'] as const,
    proveedores: ['creador_productos', 'proveedores'] as const,
    unidades: ['creador_productos', 'unidades'] as const,
  },
  movimientos: {
    list: (p: MovimientosParams) => ['movimientos', 'list', p] as const,
    detail: (id: string) => ['movimientos', id] as const,
  },
  usuarios: {
    list: ['usuarios', 'list'] as const,
    me: ['usuarios', 'me'] as const,
  },
} as const
```

**Uso:**
```ts
// ANTES:
queryKey: ['stock', { search, categoriaId, page }]

// DESPUÉS:
queryKey: QK.stock.list({ search, categoriaId, page })
```

---

## SPEC-TECH-04 · Rate limiting en endpoints de mutación

**Archivo:** `backend/src/main.rs`

```rust
// Rate limiter diferenciado:
// Auth: 10 req/min (ya existe)
// Mutaciones (POST/PUT/DELETE): 60 req/min por usuario autenticado
// Lecturas (GET): 300 req/min

// En la función de middleware de rate limiting, verificar el método HTTP:
async fn check_rate_limit(
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let method = req.method().clone();
    let limit = match method {
        Method::GET | Method::HEAD => 300,
        _ => 60,
    };
    // ... resto del limiter con el límite correcto
}
```

---

---

# APÉNDICE A — Componentes DaisyUI usados

| Componente | Specs donde se usa |
|------------|-------------------|
| `modal` | SEC, UX-01, FEAT-01, FEAT-02 |
| `steps` | FEAT-01 (setup CSV) |
| `tabs tabs-border` | FEAT-02, FEAT-03, FEAT-07 |
| `stats` | FEAT-07 |
| `timeline` | FEAT-06 |
| `breadcrumbs` | UX-06 |
| `alert` | FEAT-02 (stock insuficiente) |
| `badge` | FEAT-03, FEAT-05, FEAT-08 |
| `progress` | FEAT-07 (stock bar) |
| `table table-sm table-zebra` | FEAT-01, FEAT-02 |
| `avatar placeholder` | FEAT-05 |
| `tooltip` | FEAT-08 |
| `loading loading-spinner` | UX-04 en todos los forms |
| `card` | FEAT-05 |
| `drawer` | stock-detail (ya existe, mantener) |

---

# APÉNDICE B — Orden de implementación sugerido

```
Sprint 1 (Seguridad + integridad):
  SEC-01 → SEC-02 → SEC-03 → BUG-01 → BUG-02

Sprint 2 (UX crítica + robustez):
  UX-01 → UX-02 → UX-03 → UX-04 → BUG-03 → BUG-04

Sprint 3 (Funcionalidad core faltante):
  FEAT-01 (CSV setup) → FEAT-05 (Configuración) → FEAT-02 (Consumos)

Sprint 4 (Completar MVP):
  FEAT-03 (Transferencias) → FEAT-04 (Movimientos) → FEAT-05 (Usuarios)

Sprint 5 (Pulido + deuda técnica):
  FEAT-06 → FEAT-07 → FEAT-08 → TECH-01..04 → SEC-04 → SEC-05
```
