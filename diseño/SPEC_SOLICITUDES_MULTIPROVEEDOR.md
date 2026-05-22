# Spec: Refactor Multi-Proveedor en Solicitudes de Compra

**Versión:** 1.0
**Fecha:** 2026-05-13
**Estado:** Aprobado para implementación

---

## 0. Resumen ejecutivo

Refactorización del módulo `solicitudes-compra` para soportar solicitudes que contienen ítems de múltiples proveedores bajo un único número de documento (`SOL-000042`). El envío se gestiona granularmente por proveedor mediante una nueva tabla `solicitud_envios`. Las recepciones siguen siendo mono-proveedor y se filtran por `proveedor_id` desde la solicitud origen.

### Tabla de cambios

| Área | Cambio | Complejidad |
|------|--------|-------------|
| DB | Migration 034 — tabla `solicitud_envios`, nuevo estado | S |
| Backend | Endpoints de envío por proveedor + recompute de estado | M |
| Backend | Recomendaciones sin filtro de proveedor | S |
| Frontend hook | Acumulación multi-proveedor + filtro acumulable | L |
| Frontend componentes | Pedido agrupado, revisión global, banner con chips | L |
| PDF | Secciones por proveedor + resumen final | M |
| Migración de datos | Borradores antiguos mono-proveedor | S |

---

## A. Migraciones de base de datos

### A.1 Migration `034_solicitud_envios.sql`

```sql
-- ============================================================
-- Migration 034: Envío granular por proveedor en solicitudes
-- ============================================================

-- 1. Nueva tabla solicitud_envios
CREATE TABLE solicitud_envios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitud_id    UUID NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
    proveedor_id    INTEGER NOT NULL REFERENCES proveedores(id),
    estado          TEXT NOT NULL DEFAULT 'pendiente',
    metodo_envio    TEXT,
    fecha_envio     TIMESTAMPTZ,
    usuario_envio_id UUID REFERENCES usuarios(id),
    nota            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version         INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT solicitud_envios_estado_check
        CHECK (estado IN ('pendiente', 'enviado', 'cancelado')),
    CONSTRAINT solicitud_envios_metodo_check
        CHECK (metodo_envio IS NULL OR metodo_envio IN
            ('email','telefono','whatsapp','presencial','otro')),
    CONSTRAINT solicitud_envios_fecha_consistente
        CHECK (
            (estado = 'enviado' AND fecha_envio IS NOT NULL AND metodo_envio IS NOT NULL)
            OR (estado <> 'enviado')
        ),
    CONSTRAINT solicitud_envios_unique
        UNIQUE (solicitud_id, proveedor_id)
);

CREATE INDEX idx_solicitud_envios_solicitud ON solicitud_envios(solicitud_id);
CREATE INDEX idx_solicitud_envios_proveedor ON solicitud_envios(proveedor_id);
CREATE INDEX idx_solicitud_envios_estado    ON solicitud_envios(estado);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_solicitud_envios_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version    = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER solicitud_envios_updated
BEFORE UPDATE ON solicitud_envios
FOR EACH ROW EXECUTE FUNCTION trg_solicitud_envios_updated();

-- 2. Drop y recrear check de estado en solicitudes_compra
ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN (
        'borrador',
        'guardada',
        'parcialmente_enviada',
        'enviada',
        'completada',
        'cancelada'
    ));

-- 3. Poblar solicitud_envios para solicitudes existentes ya enviadas
INSERT INTO solicitud_envios (solicitud_id, proveedor_id, estado, metodo_envio, fecha_envio, usuario_envio_id)
SELECT DISTINCT
    s.id,
    i.proveedor_id,
    CASE WHEN s.estado IN ('enviada','completada') THEN 'enviado' ELSE 'pendiente' END,
    CASE WHEN s.estado IN ('enviada','completada') THEN COALESCE(s.metodo_envio, 'otro') ELSE NULL END,
    CASE WHEN s.estado IN ('enviada','completada') THEN COALESCE(s.fecha_envio, s.created_at) ELSE NULL END,
    CASE WHEN s.estado IN ('enviada','completada') THEN s.usuario_id ELSE NULL END
FROM solicitudes_compra s
JOIN solicitudes_compra_items i ON i.solicitud_id = s.id
WHERE i.proveedor_id IS NOT NULL
ON CONFLICT (solicitud_id, proveedor_id) DO NOTHING;

-- 4. Comentarios
COMMENT ON TABLE solicitud_envios IS
'Estado de envío granular por proveedor para solicitudes multi-proveedor.';
COMMENT ON COLUMN solicitudes_compra.estado IS
'Estados: borrador|guardada|parcialmente_enviada|enviada|completada|cancelada. parcialmente_enviada se aplica cuando algunos pero no todos los proveedores tienen envío en estado enviado.';
```

### A.2 Notas sobre el schema

- **NO se modifica `solicitudes_compra_items`** — ya soporta `proveedor_id` por ítem.
- `solicitud_envios` tiene `UNIQUE(solicitud_id, proveedor_id)` — un único envío por par.
- La columna `metodo_envio` en `solicitudes_compra` queda obsoleta para multi-proveedor pero se conserva para compatibilidad legacy.
- `fecha_envio` global de `solicitudes_compra` = MAX(fecha_envio) de envíos confirmados.

---

## B. Backend Rust

### B.1 Nuevos modelos (`src/models/solicitud_envio.rs`)

```rust
use sqlx::types::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct SolicitudEnvio {
    pub id: Uuid,
    pub solicitud_id: Uuid,
    pub proveedor_id: i32,
    pub estado: String,            // pendiente|enviado|cancelado
    pub metodo_envio: Option<String>,
    pub fecha_envio: Option<DateTime<Utc>>,
    pub usuario_envio_id: Option<Uuid>,
    pub nota: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}
```

### B.2 Nuevos DTOs (`src/dto/solicitudes_compra.rs`)

```rust
#[derive(Debug, Deserialize)]
pub struct RegistrarEnvioInput {
    pub proveedor_id: i32,
    pub metodo_envio: String,          // email|telefono|whatsapp|presencial|otro
    pub fecha_envio: Option<DateTime<Utc>>,  // default NOW()
    pub nota: Option<String>,
    pub version: i32,                  // optimistic locking del envio (0 si no existe aún)
}

#[derive(Debug, Serialize)]
pub struct EnvioProveedorView {
    pub proveedor_id: i32,
    pub proveedor_nombre: String,
    pub estado: String,                // pendiente|enviado|cancelado
    pub metodo_envio: Option<String>,
    pub fecha_envio: Option<DateTime<Utc>>,
    pub nota: Option<String>,
    pub total_items: i64,
    pub monto_total: rust_decimal::Decimal,
    pub version: i32,
}

#[derive(Debug, Serialize)]
pub struct ProveedorResumen {
    pub proveedor_id: i32,
    pub proveedor_nombre: String,
    pub total_items: i64,
    pub monto_total: rust_decimal::Decimal,
}

#[derive(Debug, Serialize)]
pub struct SolicitudDetalleResponse {
    pub solicitud: SolicitudCompra,
    pub items: Vec<SolicitudItemView>,
    pub envios: Vec<EnvioProveedorView>,
    pub proveedores_resumen: Vec<ProveedorResumen>,
}
```

### B.3 Endpoints

| Método | Path | Cambio | Descripción |
|--------|------|--------|-------------|
| GET | `/solicitudes-compra/recomendaciones` | Modificado | YA NO filtra por proveedor; devuelve todas |
| POST | `/solicitudes-compra` | Sin cambios | Acepta items con proveedor_id mixto |
| PUT | `/solicitudes-compra/:id` | Sin cambios | Ídem |
| POST | `/solicitudes-compra/:id/guardar` | Modificado | Crea filas `solicitud_envios` (pendiente) para cada proveedor distinto |
| GET | `/solicitudes-compra/:id` | Modificado | Devuelve `SolicitudDetalleResponse` con envíos y resúmenes |
| POST | `/solicitudes-compra/:id/envios` | **NUEVO** | Registra envío para un proveedor |
| DELETE | `/solicitudes-compra/:id/envios/:proveedor_id` | **NUEVO** | Cancela envío de un proveedor |
| POST | `/solicitudes-compra/:id/enviar` | **DEPRECADO** | Mantener para legacy |

### B.4 Lógica clave — registrar envío

`POST /solicitudes-compra/:id/envios`

```rust
pub async fn registrar_envio(
    State(pool): State<PgPool>,
    Extension(user): Extension<AuthUser>,
    Path(solicitud_id): Path<Uuid>,
    Json(input): Json<RegistrarEnvioInput>,
) -> Result<Json<SolicitudDetalleResponse>, ApiError> {
    let mut tx = pool.begin().await?;

    // 1. Verificar solicitud existe y no está en borrador/cancelada
    let solicitud = sqlx::query_as!(SolicitudCompra,
        r#"SELECT * FROM solicitudes_compra WHERE id = $1 FOR UPDATE"#,
        solicitud_id
    ).fetch_one(&mut *tx).await?;

    if solicitud.estado == "borrador" {
        return Err(ApiError::BadRequest("La solicitud está en borrador. Guárdala primero.".into()));
    }
    if matches!(solicitud.estado.as_str(), "cancelada" | "completada") {
        return Err(ApiError::BadRequest("La solicitud no admite cambios de envío".into()));
    }

    // 2. Verificar que el proveedor pertenezca a items de la solicitud
    let count: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM solicitudes_compra_items
           WHERE solicitud_id = $1 AND proveedor_id = $2"#,
        solicitud_id, input.proveedor_id
    ).fetch_one(&mut *tx).await?.unwrap_or(0);

    if count == 0 {
        return Err(ApiError::BadRequest("Proveedor no presente en la solicitud".into()));
    }

    let fecha = input.fecha_envio.unwrap_or_else(Utc::now);

    // 3. Upsert con verificación de versión
    let envio = sqlx::query_as!(SolicitudEnvio, r#"
        INSERT INTO solicitud_envios
            (solicitud_id, proveedor_id, estado, metodo_envio, fecha_envio, usuario_envio_id, nota)
        VALUES ($1, $2, 'enviado', $3, $4, $5, $6)
        ON CONFLICT (solicitud_id, proveedor_id) DO UPDATE
            SET estado = 'enviado',
                metodo_envio = EXCLUDED.metodo_envio,
                fecha_envio  = EXCLUDED.fecha_envio,
                usuario_envio_id = EXCLUDED.usuario_envio_id,
                nota = EXCLUDED.nota
            WHERE solicitud_envios.version = $7
        RETURNING *
    "#,
        solicitud_id, input.proveedor_id, input.metodo_envio, fecha,
        user.id, input.nota, input.version
    ).fetch_optional(&mut *tx).await?
     .ok_or(ApiError::Conflict("Versión de envío desactualizada".into()))?;

    // 4. Recalcular estado global
    recalcular_estado_solicitud(&mut tx, solicitud_id).await?;

    tx.commit().await?;
    obtener_detalle(pool, solicitud_id).await
}
```

### B.5 Función `recalcular_estado_solicitud`

```rust
async fn recalcular_estado_solicitud(
    tx: &mut Transaction<'_, Postgres>,
    solicitud_id: Uuid,
) -> Result<(), ApiError> {
    let row = sqlx::query!(r#"
        WITH proveedores_items AS (
            SELECT DISTINCT proveedor_id FROM solicitudes_compra_items
            WHERE solicitud_id = $1 AND proveedor_id IS NOT NULL
        ),
        envios_ok AS (
            SELECT proveedor_id FROM solicitud_envios
            WHERE solicitud_id = $1 AND estado = 'enviado'
        )
        SELECT
            (SELECT COUNT(*) FROM proveedores_items)::bigint AS total_provs,
            (SELECT COUNT(*) FROM envios_ok)::bigint          AS provs_enviados,
            (SELECT MAX(fecha_envio) FROM solicitud_envios
                WHERE solicitud_id = $1 AND estado = 'enviado') AS fecha_max
    "#, solicitud_id).fetch_one(&mut **tx).await?;

    let nuevo_estado = match (row.total_provs.unwrap_or(0), row.provs_enviados.unwrap_or(0)) {
        (_, 0)                      => "guardada",
        (t, e) if e < t            => "parcialmente_enviada",
        (t, e) if e >= t && t > 0  => "enviada",
        _                          => "guardada",
    };

    sqlx::query!(r#"
        UPDATE solicitudes_compra
        SET estado = $1,
            fecha_envio = COALESCE($2, fecha_envio),
            version = version + 1
        WHERE id = $3
          AND estado NOT IN ('cancelada','completada')
    "#, nuevo_estado, row.fecha_max, solicitud_id)
        .execute(&mut **tx).await?;

    Ok(())
}
```

### B.6 `POST /:id/guardar` — cambio adicional

Después de cambiar estado a `guardada`, generar filas pendiente en `solicitud_envios`:

```sql
INSERT INTO solicitud_envios (solicitud_id, proveedor_id, estado)
SELECT DISTINCT $1, proveedor_id, 'pendiente'
FROM solicitudes_compra_items
WHERE solicitud_id = $1 AND proveedor_id IS NOT NULL
ON CONFLICT (solicitud_id, proveedor_id) DO NOTHING;
```

### B.7 `GET /:id` — query enriquecida con envíos

```sql
SELECT
    se.proveedor_id,
    p.nombre AS proveedor_nombre,
    se.estado,
    se.metodo_envio,
    se.fecha_envio,
    se.nota,
    se.version,
    COUNT(i.id) AS total_items,
    COALESCE(SUM(i.precio_unitario * i.cantidad_sugerida), 0) AS monto_total
FROM solicitud_envios se
JOIN proveedores p ON p.id = se.proveedor_id
LEFT JOIN solicitudes_compra_items i
    ON i.solicitud_id = se.solicitud_id AND i.proveedor_id = se.proveedor_id
WHERE se.solicitud_id = $1
GROUP BY se.id, p.nombre
ORDER BY p.nombre;
```

### B.8 Errores específicos

| Caso | HTTP | Mensaje |
|------|------|---------|
| Solicitud en borrador | 400 | "La solicitud debe estar guardada para registrar envíos" |
| Solicitud cancelada/completada | 400 | "Solicitud no admite cambios" |
| Proveedor no en solicitud | 400 | "El proveedor no tiene ítems en esta solicitud" |
| Versión desactualizada | 409 | "Versión del envío desactualizada, recarga la página" |
| Método inválido | 400 | "Método de envío inválido" |

---

## C. Frontend — Hook `useSolicitudState.ts`

### C.1 Estado nuevo

```typescript
// ANTES (eliminar):
// const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null)

// NUEVO:
const [proveedoresFiltro, setProveedoresFiltro] = useState<Proveedor[]>(() => {
  try {
    const ids: number[] = JSON.parse(localStorage.getItem('solicitud_proveedores_ids') ?? '[]')
    // se hidratan desde proveedores[] una vez cargados
    return []
  } catch { return [] }
})
// proveedorActivo = el último en el filtro (contexto de búsqueda avanzada)
const proveedorActivo = proveedoresFiltro[proveedoresFiltro.length - 1] ?? null
```

Persistir:
```typescript
useEffect(() => {
  localStorage.setItem('solicitud_proveedores_ids', JSON.stringify(proveedoresFiltro.map(p => p.id)))
}, [proveedoresFiltro])
```

Hidratar al cargar proveedores:
```typescript
useEffect(() => {
  if (!proveedores) return
  const ids: number[] = JSON.parse(localStorage.getItem('solicitud_proveedores_ids') ?? '[]')
  const hidratados = ids.map(id => proveedores.find(p => p.id === id)).filter(Boolean) as Proveedor[]
  setProveedoresFiltro(hidratados)
}, [proveedores])
```

### C.2 Variables derivadas

```typescript
// Todas las recomendaciones, sin filtro de proveedor único
const recomendacionesAll = recomendaciones ?? []

// Filtro acumulable (vacío = todos)
const recsFiltered = proveedoresFiltro.length === 0
  ? recomendacionesAll
  : recomendacionesAll.filter(r => proveedoresFiltro.some(p => p.id === r.proveedor_id))

// Agrupación para RevisionView
const recsByProveedor = useMemo(() => {
  const map = new Map<number, { proveedor: { id: number; nombre: string }; items: ItemRecomendado[] }>()
  for (const r of recomendacionesAll) {
    if (r.proveedor_id == null) continue
    if (!map.has(r.proveedor_id)) {
      map.set(r.proveedor_id, {
        proveedor: { id: r.proveedor_id, nombre: r.proveedor_nombre ?? 'Sin nombre' },
        items: []
      })
    }
    map.get(r.proveedor_id)!.items.push(r)
  }
  // Orden: críticos primero, luego alfabético
  return Array.from(map.values()).sort((a, b) => {
    const ca = a.items.filter(i => i.nivel_urgencia === 'critica').length
    const cb = b.items.filter(i => i.nivel_urgencia === 'critica').length
    if (cb !== ca) return cb - ca
    return a.proveedor.nombre.localeCompare(b.proveedor.nombre)
  })
}, [recomendacionesAll])

// Agrupación del carrito por proveedor
const itemsByProveedor = useMemo(() => {
  const map = new Map<number, { proveedor_nombre: string; items: SolicitudItem[]; subtotal: number }>()
  for (const it of items) {
    const pid = it.proveedor_id ?? -1
    if (!map.has(pid)) map.set(pid, { proveedor_nombre: it.proveedor_nombre, items: [], subtotal: 0 })
    const g = map.get(pid)!
    g.items.push(it)
    g.subtotal += (it.precio_unitario ?? 0) * it.cantidad
  }
  return Array.from(map.entries())
    .map(([proveedor_id, v]) => ({ proveedor_id, ...v }))
    .sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre))
}, [items])

const totalGeneral = useMemo(
  () => items.reduce((acc, it) => acc + (it.precio_unitario ?? 0) * it.cantidad, 0),
  [items]
)

const proveedoresEnCarrito = useMemo(
  () => [...new Set(items.map(i => i.proveedor_id).filter(Boolean))] as number[],
  [items]
)
```

### C.3 Handlers nuevos/modificados

```typescript
// NUEVO — agrega proveedor al filtro (toggle off si ya está)
const handleAgregarProveedorFiltro = (p: Proveedor) => {
  setProveedoresFiltro(prev =>
    prev.some(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p]
  )
}

const handleQuitarProveedorFiltro = (proveedor_id: number) =>
  setProveedoresFiltro(prev => prev.filter(p => p.id !== proveedor_id))

const handleLimpiarFiltros = () => setProveedoresFiltro([])

// NUEVO — elimina todos los items de un proveedor del carrito
const handleQuitarProveedorCarrito = (proveedor_id: number) => {
  setItems(prev => prev.filter(it => it.proveedor_id !== proveedor_id))
  toast.success('Ítems del proveedor removidos del pedido')
}

// handleSelectProveedor REEMPLAZADO — ya NO limpia el carrito
const handleAgregarProveedor = (p: Proveedor) => {
  handleAgregarProveedorFiltro(p)
  // el carrito NO se toca
}

// handleCambiarProveedor REEMPLAZADO
const handleVolverAGaleria = () => {
  setProveedoresFiltro([])
  // el carrito NO se toca
}
```

### C.4 React Query — envíos

```typescript
const registrarEnvioMutation = useMutation({
  mutationFn: (input: { solicitudId: string; body: RegistrarEnvioInput }) =>
    api.post<SolicitudDetalleResponse>(
      `/solicitudes-compra/${input.solicitudId}/envios`, input.body
    ).then(r => r.data),
  onSuccess: (data, { solicitudId }) => {
    queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    queryClient.setQueryData(['solicitud-detail', solicitudId], data)
    toast.success('Envío registrado')
  },
  onError: (e: any) => {
    if (e.response?.status === 409) toast.error('Versión desactualizada, recarga la página')
    else toast.error(e.response?.data?.message ?? 'Error registrando envío')
  }
})

const cancelarEnvioMutation = useMutation({
  mutationFn: ({ solicitudId, proveedorId, version }: { solicitudId: string; proveedorId: number; version: number }) =>
    api.delete(`/solicitudes-compra/${solicitudId}/envios/${proveedorId}`, { data: { version } }),
  onSuccess: (_, { solicitudId }) => {
    queryClient.invalidateQueries({ queryKey: ['solicitud-detail', solicitudId] })
    queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    toast.success('Envío cancelado')
  }
})
```

### C.5 Return del hook (nuevas claves)

```typescript
return {
  // ... todo lo anterior, más:
  proveedoresFiltro,
  proveedorActivo,
  recsByProveedor,
  itemsByProveedor,
  proveedoresEnCarrito,
  totalGeneral,
  handleAgregarProveedorFiltro,
  handleQuitarProveedorFiltro,
  handleLimpiarFiltros,
  handleQuitarProveedorCarrito,
  handleVolverAGaleria,
  registrarEnvioMutation,
  cancelarEnvioMutation,
}
```

---

## D. Frontend — Componentes

### D.1 `proveedor-gallery.tsx`

**Props nuevas:**
```typescript
interface ProveedorGalleryProps {
  proveedores: Proveedor[] | undefined
  isLoading: boolean
  urgenciasByProveedor: Record<number, { total: number; criticos: number }>
  vencimientoByProveedor: Record<number, { lotes: number; productos: number }>
  diasVencimiento: number
  onDiasVencimientoChange: (dias: number) => void
  proveedoresFiltro: Proveedor[]              // NUEVO
  onToggleFiltro: (p: Proveedor) => void      // NUEVO — reemplaza onSelect
  logoBase64?: string | null
}
```

Comportamiento de card: si `proveedoresFiltro.includes(p)` → borde verde + checkmark. Click = toggle. El texto del header cambia a "Selecciona proveedores para pedir" (plural).

### D.2 `proveedor-banner.tsx` — reescribir como chips

```tsx
export function ProveedoresBanner({
  proveedoresFiltro,
  onQuitarFiltro,
  onAgregarOtro,
  onLimpiarFiltros,
  proveedoresDisponibles,  // para el popover de búsqueda
}: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap p-3 bg-base-200/50 rounded-2xl">
      <span className="text-sm font-medium opacity-60 shrink-0">Comprando a:</span>

      {proveedoresFiltro.length === 0 && (
        <span className="text-sm opacity-40 italic">Todos los proveedores</span>
      )}

      {proveedoresFiltro.map(p => (
        <Badge key={p.id} className="gap-1.5 pl-2 pr-1 py-1 rounded-lg">
          {p.icono && <span>{p.icono}</span>}
          {p.nombre}
          <button
            onClick={() => onQuitarFiltro(p.id)}
            className="ml-1 rounded hover:bg-base-300 p-0.5"
            aria-label={`Quitar ${p.nombre}`}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {/* Popover con autocomplete de proveedores no incluidos */}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 gap-1 rounded-lg">
            <Plus className="size-3.5" /> Agregar proveedor
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-64">
          <Command>
            <CommandInput placeholder="Buscar proveedor..." />
            <CommandList>
              {proveedoresDisponibles
                .filter(p => !proveedoresFiltro.some(f => f.id === p.id))
                .map(p => (
                  <CommandItem key={p.id} onSelect={() => onAgregarOtro(p)}>
                    {p.icono && <span className="mr-2">{p.icono}</span>}
                    {p.nombre}
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {proveedoresFiltro.length > 0 && (
        <Button size="sm" variant="ghost" onClick={onLimpiarFiltros} className="h-7 opacity-50">
          Limpiar
        </Button>
      )}
    </div>
  )
}
```

### D.3 `quiebres-panel.tsx` — modo Revisión con grupos

Cuando `modo === 'revision'`, renderizar `recsByProveedor` como collapsibles:

```tsx
{recsByProveedor.map(grupo => {
  const criticos = grupo.items.filter(i => i.nivel_urgencia === 'critica')
  const otros    = grupo.items.filter(i => i.nivel_urgencia !== 'critica')
  const defaultOpen = criticos.length > 0 ||
    grupo.items.some(i => i.nivel_urgencia === 'alta')

  return (
    <Collapsible key={grupo.proveedor.id} defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 bg-base-200/60 rounded-xl hover:bg-base-200 transition-colors">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{grupo.proveedor.nombre}</span>
          <span className="text-xs opacity-50">{grupo.items.length} ítems</span>
        </div>
        <div className="flex items-center gap-2">
          {criticos.length > 0 && (
            <span className="badge badge-error badge-xs">{criticos.length} crítico{criticos.length !== 1 ? 's' : ''}</span>
          )}
          <ChevronDown className="size-4 opacity-50 group-data-[state=open]:rotate-180 transition-transform" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {/* Críticos siempre visibles */}
        {criticos.map(item => <ItemRecomendadoCard key={item.producto_id} item={item} onAgregar={onAgregar} />)}
        {/* Normales detrás de "Mostrar X más" si hay muchos */}
        {otros.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs opacity-50 hover:opacity-80 pl-2">
              Mostrar {otros.length} con stock normal...
            </CollapsibleTrigger>
            <CollapsibleContent>
              {otros.map(item => <ItemRecomendadoCard key={item.producto_id} item={item} onAgregar={onAgregar} />)}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
})}
```

### D.4 `pedido-panel.tsx` — agrupación por proveedor

```tsx
const multiProveedor = itemsByProveedor.length > 1

// Layout single-proveedor: render plano actual (sin headers)
// Layout multi-proveedor:
{multiProveedor && (
  <div className="space-y-3">
    {itemsByProveedor.map(grupo => (
      <section key={grupo.proveedor_id} className="border border-base-300 rounded-2xl overflow-hidden">
        <header className="flex items-center justify-between px-4 py-2.5 bg-base-200/60">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{grupo.proveedor_nombre}</span>
            <span className="badge badge-ghost badge-xs">{grupo.items.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tabular-nums">
              {monedaSimbolo}{grupo.subtotal.toLocaleString('es-CL')}
            </span>
            <button
              onClick={() => handleQuitarProveedorCarrito(grupo.proveedor_id)}
              className="btn btn-ghost btn-xs text-error"
              title="Quitar todos los ítems de este proveedor"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </header>
        <div className="p-2">
          {grupo.items.map(item => <ItemRow key={item.producto_id} item={item} />)}
        </div>
      </section>
    ))}

    <div className="flex justify-between items-center px-4 py-3 bg-base-200 rounded-2xl font-bold">
      <span>Total general</span>
      <span className="text-lg tabular-nums">{monedaSimbolo}{totalGeneral.toLocaleString('es-CL')}</span>
    </div>
  </div>
)}
```

### D.5 `detalle-modal.tsx` — envíos por proveedor

```tsx
{/* Sección de envíos — solo para solicitudes no en borrador */}
{detalle?.envios && detalle.envios.length > 0 && (
  <div className="space-y-3">
    <h3 className="font-semibold text-sm opacity-60 uppercase tracking-wide">Estado de envíos</h3>
    {detalle.envios.map(env => (
      <div key={env.proveedor_id} className="flex items-center justify-between p-3 border rounded-xl">
        <div>
          <p className="font-semibold text-sm">{env.proveedor_nombre}</p>
          <p className="text-xs opacity-50">
            {env.total_items} ítems · {monedaSimbolo}{Number(env.monto_total).toLocaleString('es-CL')}
          </p>
          {env.estado === 'enviado' && env.fecha_envio && (
            <p className="text-xs text-success">
              Enviado por {env.metodo_envio} el {format(new Date(env.fecha_envio), 'dd/MM/yyyy')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={env.estado === 'enviado' ? 'default' : 'secondary'}>
            {env.estado === 'enviado' ? '✓ Enviado' : '⏳ Pendiente'}
          </Badge>
          {env.estado === 'pendiente' && solicitud.estado !== 'cancelada' && (
            <Button size="sm" onClick={() => abrirDialogoEnvio(env)}>
              Registrar envío
            </Button>
          )}
          {env.estado === 'enviado' && (
            <Button size="sm" variant="ghost" onClick={() => cancelarEnvio(env)}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
    ))}
  </div>
)}

{/* Dialog registrar envío */}
<Dialog open={!!envioDialogo} onOpenChange={() => setEnvioDialogo(null)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Registrar envío — {envioDialogo?.proveedor_nombre}</DialogTitle>
    </DialogHeader>
    <div className="space-y-4">
      <Select value={metodoEnvio} onValueChange={setMetodoEnvio}>
        <SelectTrigger><SelectValue placeholder="Método de envío" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="email">Email</SelectItem>
          <SelectItem value="telefono">Teléfono</SelectItem>
          <SelectItem value="whatsapp">WhatsApp</SelectItem>
          <SelectItem value="presencial">Presencial</SelectItem>
          <SelectItem value="otro">Otro</SelectItem>
        </SelectContent>
      </Select>
      <Input type="date" value={fechaEnvio} onChange={e => setFechaEnvio(e.target.value)} />
      <Textarea placeholder="Nota (opcional)" value={nota} onChange={e => setNota(e.target.value)} />
    </div>
    <DialogFooter>
      <Button onClick={confirmarEnvio} disabled={!metodoEnvio}>
        Confirmar envío
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### D.6 `historial-view.tsx`

```tsx
// Columna Proveedor:
<td>
  {solicitud.proveedores.length === 1
    ? solicitud.proveedores[0].nombre
    : (
      <span title={solicitud.proveedores.map(p => p.nombre).join(', ')}>
        {solicitud.proveedores.length} proveedores
      </span>
    )
  }
</td>

// Badge de estado — agregar parcialmente_enviada:
const estadoConfig = {
  borrador:              { label: 'Borrador',          variant: 'outline' },
  guardada:              { label: 'Guardada',           variant: 'secondary' },
  parcialmente_enviada:  { label: 'Env. parcial',       variant: 'warning' },
  enviada:               { label: 'Enviada',            variant: 'default' },
  completada:            { label: 'Completada',         variant: 'success' },
  cancelada:             { label: 'Cancelada',          variant: 'destructive' },
}
```

---

## E. Flujos de usuario

### E.1 Modo Revisión → solicitud multi-proveedor (camino feliz)

1. Usuario navega a `/solicitudes-compra`. Modo `revision` por defecto.
2. Frontend hace `GET /solicitudes-compra/recomendaciones` → recibe todos los proveedores.
3. Panel izquierdo muestra grupos por proveedor. Grupos con críticos abiertos. Grupos normales colapsados.
4. Usuario expande "MedSupply" → ve 3 ítems críticos. Click "Agregar" en Ítem A → va al carrito.
5. Agrupa "LabCorp" → ve 1 crítico. Click "Agregar" en Ítem B → carrito ahora tiene 2 grupos.
6. Carrito muestra:
   ```
   ─ LabCorp ─── Ítem B [qty] $5.000
   ─ MedSupply ─ Ítem A [qty] $8.000
   Total general: $13.000
   ```
7. Click "Guardar solicitud":
   - `POST /solicitudes-compra` → `{ items: [ItemA(MedSupply), ItemB(LabCorp)] }` → crea borrador.
   - `POST /solicitudes-compra/{id}/guardar` → estado = `guardada`, crea 2 filas en `solicitud_envios` (pendiente).
8. Toast: "Solicitud SOL-000042 guardada (2 proveedores)". Vista cambia a historial.

### E.2 Modo Avanzado → acumular proveedores

1. Usuario cambia a "Avanzado".
2. Galería muestra todos los proveedores. Click en LabCorp → card con borde verde + checkmark.
3. Banner de chips aparece: [LabCorp ×] [+ Agregar proveedor] [Limpiar]
4. Panel izquierdo quiebres filtra para LabCorp. Buscador filtra catálogo LabCorp.
5. Agrega Ítem B al carrito.
6. Click "Agregar proveedor" en banner → Popover con autocomplete. Escribe "Med" → aparece MedSupply. Enter.
7. Chips: [LabCorp ×] [MedSupply ×] [+ Agregar] [Limpiar]
8. Panel izquierdo ahora muestra ítems de LabCorp Y MedSupply.
9. Agrega Ítem A (MedSupply) → carrito agrupado.
10. Click [LabCorp ×] en chips → SOLO se quita del filtro. Carrito intacto.
11. Guardar → igual que E.1.

### E.3 Envío granular desde historial

1. Historial: `SOL-000042` aparece con estado "Guardada".
2. Click en fila → DetalleModal abre con tabs de ítems por proveedor.
3. Sección "Estado de envíos" muestra:
   ```
   LabCorp    1 ítem · $5.000    [⏳ Pendiente] [Registrar envío]
   MedSupply  1 ítem · $8.000    [⏳ Pendiente] [Registrar envío]
   ```
4. Click "Registrar envío" en LabCorp → Dialog: método=Email, fecha=hoy, nota="".
5. Submit → `POST /solicitudes-compra/{id}/envios` `{ proveedor_id: LabCorpId, metodo: email, version: 1 }`.
6. Backend recalcula → estado = `parcialmente_enviada`.
7. Modal refetchea. Sección actualizada:
   ```
   LabCorp    ✓ Enviado — Email 13/05/2026    [Cancelar]
   MedSupply  ⏳ Pendiente                    [Registrar envío]
   ```
8. Click "Registrar envío" en MedSupply → mismo flujo.
9. Backend recalcula → estado = `enviada`. Toast "Solicitud completamente enviada".

### E.4 Crear recepción vinculada

1. Desde DetalleModal de `SOL-000042`, botón "Crear recepción ▾".
2. Dropdown: [LabCorp] [MedSupply].
3. Click LabCorp → navega a `/recepciones/nueva?solicitud_id=SOL-000042&proveedor_id=123`.
4. Página de recepción hace `GET /solicitudes-compra/{id}` y filtra `items.filter(i => i.proveedor_id === 123)`.
5. Pre-carga solo los ítems de LabCorp en el formulario de recepción. Flujo normal desde aquí.

### E.5 Edge cases

| Caso | Comportamiento |
|------|----------------|
| Ítem sin `proveedor_id` en carrito | Botón "Guardar" disabled. Toast explicativo: "Todos los ítems deben tener proveedor asignado". |
| Borrador legacy mono-proveedor en localStorage | Si `borradorItems` todos tienen el mismo `proveedor_id`, se restaura normalmente. `proveedoresFiltro` se hidratan con ese proveedor. |
| Recomendación con `proveedor_id = null` | Sección "Sin proveedor asignado" al final del panel Revisión. Botón "Agregar" disabled con tooltip: "Asigna este producto a un proveedor en el catálogo". |
| Conflicto 409 al registrar envío | Toast error no destructivo. Dialog permanece abierto. `version` se actualiza automáticamente vía refetch. |
| Eliminar último ítem de un proveedor | Grupo desaparece del carrito. Si era el único → carrito vacío. |
| Cancelar envío ya marcado como "enviado" | `DELETE /envios/:proveedor_id`. Estado regresa a `pendiente`. Estado solicitud recalcula (puede regresar de `enviada` a `parcialmente_enviada`). |
| Quitar proveedor del chip de filtro | NUNCA limpia el carrito. Solo afecta la vista del panel izquierdo. |
| Solicitud con proveedor eliminado (soft delete) | Ítem sigue en solicitud. En detalle modal se muestra con `[Proveedor eliminado]`. No bloquea envío. |

---

## F. Generación de PDF

### F.1 Header global

```
[Logo laboratorio]         SOLICITUD DE COMPRA
                           N° SOL-000042
                           Fecha emisión: 13 de mayo de 2026
                           Usuario: Vicente L.
                           Estado: Guardada
                           [Línea de firma si pdfFirmaLabel está definido]
```

NO incluye "Proveedor:" cuando hay más de uno.

### F.2 Sección por proveedor (una por página si supera 15 ítems)

```
════════════════════════════════════════════════════
PROVEEDOR: Laboratorios Bayer
Contacto: Juan Pérez
Email: jp@bayer.com · Tel: +56 9 1234 5678
Estado envío: Enviado por email el 13/05/2026
════════════════════════════════════════════════════

 #  | Cód. Prov | Producto        | Presentación  | Cant. | P. Unit. |  Total
 1  | BY-001    | Reactivo PCR A  | Caja x 50     |   3   |  $12.000 | $36.000
 2  | BY-089    | Guantes Nitrilo | Caja x 100    |   2   |   $8.500 | $17.000

                                           Subtotal proveedor:    $53.000
```

Orden de columnas: `#`, `Código Proveedor`, `Código Maestro`, `Producto`, `Presentación`, `Cantidad`, `Precio Unit.`, `Total`.

Columnas `Código Proveedor` y `Código Maestro` se muestran solo si al menos 1 ítem del grupo tiene valor.

### F.3 Resumen final (última página o sección)

```
════════════════════════════════════════════════════
RESUMEN DE PEDIDO

 Proveedor              Ítems   Monto          Estado
 ─────────────────────────────────────────────────────
 Laboratorios Bayer       2     $53.000        ✓ Enviado
 MedSupply Chile          1      $5.200        ⏳ Pendiente
 ─────────────────────────────────────────────────────
 TOTAL                    3     $58.200

════════════════════════════════════════════════════

Nota: [nota de solicitud si existe]

Generado el 13/05/2026 a las 14:32 · [nombre laboratorio]
```

### F.4 Implementación (ajustes al código actual)

```typescript
// Agrupar items por proveedor para el PDF
const secciones = itemsByProveedor.map(grupo => ({
  proveedor: grupo.proveedor_nombre,
  envio: detalle.envios.find(e => e.proveedor_id === grupo.proveedor_id),
  items: grupo.items,
  subtotal: grupo.subtotal,
})).sort((a, b) => a.proveedor.localeCompare(b.proveedor))

// Header: no incluir "Proveedor:" si secciones.length > 1
const esMultiProveedor = secciones.length > 1
```

---

## G. Orden de implementación

| # | Tarea | Complejidad | Depende de | Paralel. |
|---|-------|-------------|------------|----------|
| 1 | Migration 034 (DB) | S | — | solo |
| 2 | Modelo `SolicitudEnvio` + DTOs Rust | S | 1 | con 3 |
| 3 | Handler `recomendaciones` — quitar filtro proveedor | S | — | con 2 |
| 4 | Handler `guardar` — crear filas envios pendiente | S | 1,2 | — |
| 5 | Handler `POST /:id/envios` + `recalcular_estado_solicitud` | M | 2,4 | — |
| 6 | Handler `DELETE /:id/envios/:proveedor_id` | S | 5 | — |
| 7 | Handler `GET /:id` enriquecido con envíos y resumen | M | 2,4 | — |
| 8 | `cargo run --bin export_types` | S | 2,7 | — |
| 9 | `useSolicitudState` — refactor completo (proveedoresFiltro, derivados, handlers) | L | 8 | con 10 |
| 10 | `proveedor-banner` reescrito como chips + popover | M | 8 | con 9 |
| 11 | `proveedor-gallery` con toggle multi-selección | S | 10 | — |
| 12 | `pedido-panel` agrupado por proveedor + subtotales | M | 9 | con 13 |
| 13 | `quiebres-panel` modo revisión con groups collapsibles | M | 9 | con 12 |
| 14 | `revision-view` sin selector de proveedor | M | 13 | — |
| 15 | `detalle-modal` tabs + cards envío por proveedor | L | 7,8 | — |
| 16 | Dialog "Registrar envío" dentro de detalle-modal | M | 15 | — |
| 17 | `historial-view` columna N proveedores + badge parcialmente_enviada | S | 8 | — |
| 18 | PDF multi-proveedor con secciones + resumen final | M | 9,15 | — |
| 19 | Integración recepción — filtro por proveedor_id desde solicitud | S | 7 | — |

**Camino crítico:** 1 → 2 → 4 → 5 → 7 → 8 → 9 → 15 → 16

**Paralelizable en bloque tras paso 8:** {10,11} y {12,13} son independientes entre sí.

---

## H. Invariantes y reglas de negocio

### H.1 Invariantes de DB

1. `solicitud_envios (solicitud_id, proveedor_id)` es UNIQUE.
2. Solo puede existir fila en `solicitud_envios` si hay al menos 1 ítem con ese `proveedor_id` en `solicitudes_compra_items` para la misma solicitud. Validar transaccionalmente en backend.
3. `solicitud_envios` solo se crea cuando la solicitud sale de borrador (`guardar`). Nunca en estado borrador.
4. `estado = 'enviado'` requiere `fecha_envio IS NOT NULL AND metodo_envio IS NOT NULL` (constraint en DB).
5. El estado de `solicitudes_compra` NUNCA se actualiza directamente; siempre via `recalcular_estado_solicitud`.

### H.2 Tabla de transiciones de estado

| De | A | Acción que lo provoca |
|----|---|----------------------|
| `borrador` | `guardada` | `POST /:id/guardar` |
| `guardada` | `parcialmente_enviada` | Registrar envío de subset de proveedores |
| `guardada` | `enviada` | Registrar envío de TODOS los proveedores en un solo paso |
| `parcialmente_enviada` | `enviada` | Registrar último envío pendiente |
| `parcialmente_enviada` | `guardada` | Cancelar todos los envíos enviados |
| `enviada` | `parcialmente_enviada` | Cancelar uno de los envíos |
| `enviada` | `completada` | Flujo de recepciones (fuera de scope) |
| Cualquiera válido | `cancelada` | Acción explícita de admin (fuera de scope) |

### H.3 Validaciones del backend

1. Guardar solicitud con ítem sin `proveedor_id` → HTTP 422 con `{ field: "items[N].proveedor_id", message: "Requerido" }`.
2. Registrar envío en solicitud `borrador` → HTTP 400.
3. Registrar envío en solicitud `cancelada` o `completada` → HTTP 400.
4. Proveedor no presente en ítems de la solicitud → HTTP 400.
5. Optimistic locking en `solicitud_envios.version` → HTTP 409 si no coincide.
6. Optimistic locking en `solicitudes_compra.version` en mutaciones de ítems.
7. Método de envío inválido → HTTP 400 (validado también por constraint DB).

### H.4 Reglas de UI

1. Nunca limpiar carrito al cambiar/quitar filtro de proveedor (solo afecta el panel izquierdo).
2. Nunca limpiar carrito al agregar un proveedor al filtro.
3. Botón "Guardar" disabled si algún ítem tiene `proveedor_id === null`.
4. `formatCantidad` obligatorio para todas las cantidades con unidad visible.
5. Buscador "Agregar proveedor" en banner: navegable por teclado (↑↓ Enter Escape).
6. Toast de 409 NO destructivo: dialog permanece abierto, estado se refresca automáticamente.
7. Al cancelar envío: pedir confirmación (dialog) antes de ejecutar el DELETE.

### H.5 Manejo de conflictos de versión (409)

```typescript
onError: (e) => {
  if (e.response?.status === 409) {
    // 1. Refetch del detalle para obtener version actualizada
    queryClient.invalidateQueries({ queryKey: ['solicitud-detail', solicitudId] })
    // 2. Toast no destructivo
    toast.error('Alguien más actualizó esta solicitud. La versión se actualizó, intenta de nuevo.')
    // 3. Dialog permanece abierto; el refetch actualizará `env.version` automáticamente
  }
}
```

---

## I. Checklist de QA

- [ ] Crear solicitud con 1 proveedor (regresión — comportamiento igual al actual)
- [ ] Crear solicitud con 3 proveedores en modo revisión
- [ ] Crear solicitud con 2 proveedores en modo avanzado, alternando filtros
- [ ] Quitar chip de filtro → carrito permanece intacto
- [ ] Quitar grupo del carrito → filtro permanece intacto
- [ ] Guardar → `solicitud_envios` tiene N filas en estado `pendiente`
- [ ] Registrar envío de 1 de 2 proveedores → estado `parcialmente_enviada`
- [ ] Registrar envío del último proveedor → estado `enviada`
- [ ] Cancelar un envío → estado regresa a `parcialmente_enviada`
- [ ] Cancelar todos los envíos → estado regresa a `guardada`
- [ ] PDF de solicitud single-proveedor (sin cambios visuales)
- [ ] PDF de solicitud multi-proveedor con secciones separadas y resumen
- [ ] Crear recepción desde solicitud multi-proveedor → filtra ítems por proveedor
- [ ] Borrador antiguo mono-proveedor se restaura correctamente
- [ ] Conflicto 409 al registrar envío con versión obsoleta → toast + dialog permanece
- [ ] Historial muestra "N proveedores" con tooltip y badge `parcialmente_enviada`
- [ ] Ítem sin proveedor_id bloquea el botón "Guardar" con mensaje claro
- [ ] Recomendación sin proveedor_id muestra botón disabled con tooltip explicativo
