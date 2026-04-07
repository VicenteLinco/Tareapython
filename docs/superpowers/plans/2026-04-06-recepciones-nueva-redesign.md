# Recepciones Nueva — Rediseño Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la página `/recepciones/nueva` con un layout B+C (panel lateral fijo + lista de ítems con scan inline), soporte para decisiones de recepción (conforme/parcial/rechazo con motivo), escáner QR y sección de impresión de etiquetas vinculadas a lote.

**Architecture:** Panel izquierdo fijo con datos de guía y decisión; panel derecho scrollable con búsqueda/scan, tarjetas de ítems con edición inline, y sección de etiquetas al pie. Tras confirmar, el backend retorna los `codigo_interno` de los lotes creados para generar los QR de etiquetas.

**Tech Stack:** Rust/Axum (backend), React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (frontend), `qrcode` npm (ya instalado), `window.print()` para impresión de etiquetas.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `backend/migrations/038_recepcion_motivo_rechazo.sql` | Crear | Agrega columna `motivo_rechazo TEXT` a `recepciones` |
| `backend/src/dto/recepcion.rs` | Modificar | Agrega `motivo_rechazo: Option<String>` a `CreateRecepcion`; extiende respuesta con lotes |
| `backend/src/services/recepcion_service.rs` | Modificar | Maneja estados `rechazada`/`parcial`; retorna lista de lotes creados |
| `backend/src/services/producto_service.rs` | Modificar | Extiende `buscar_por_codigo` con lookup por `lote.codigo_interno` |
| `frontend/src/pages/recepciones/components/item-card.tsx` | Crear | Tarjeta de ítem con edición inline (lote, vencimiento, cantidad, área) |
| `frontend/src/pages/recepciones/components/labels-section.tsx` | Crear | Sección de etiquetas con checkbox, cantidad y botón imprimir |
| `frontend/src/lib/label-print.ts` | Crear | Genera HTML imprimible con QR por lote y dispara `window.print()` |
| `frontend/src/pages/recepciones/nueva.tsx` | Reescribir | Layout B+C completo, orquesta componentes y estado global |

---

## Task 1: Migration — agregar motivo_rechazo

**Files:**
- Create: `backend/migrations/038_recepcion_motivo_rechazo.sql`

- [ ] **Step 1: Crear archivo de migración**

```sql
-- backend/migrations/038_recepcion_motivo_rechazo.sql
ALTER TABLE recepciones ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
```

- [ ] **Step 2: Aplicar migración levantando el backend**

```bash
docker compose up --build -d
```

Verificar en logs que aparece `Applied migration 038_recepcion_motivo_rechazo`.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/038_recepcion_motivo_rechazo.sql
git commit -m "feat(db): add motivo_rechazo column to recepciones"
```

---

## Task 2: Backend — DTO, service y respuesta con lotes

**Files:**
- Modify: `backend/src/dto/recepcion.rs`
- Modify: `backend/src/services/recepcion_service.rs`

- [ ] **Step 1: Agregar `motivo_rechazo` al DTO `CreateRecepcion` y definir struct de respuesta**

En `backend/src/dto/recepcion.rs`, reemplazar la struct `CreateRecepcion` y agregar `LoteCreado`:

```rust
#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct CreateRecepcion {
    pub proveedor_id: i32,
    #[validate(length(max = 100))]
    pub guia_despacho: Option<String>,
    /// "completa" | "parcial" | "rechazada" — default "completa"
    pub estado: Option<String>,
    pub fecha_recepcion: DateTime<Utc>,
    #[validate(length(max = 1000))]
    pub nota: Option<String>,
    #[validate(length(max = 2000))]
    pub motivo_rechazo: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub detalle: Vec<DetalleRecepcionInput>,
}

/// Información del lote creado durante la recepción, para generar etiquetas QR
#[derive(Debug, Serialize, Type)]
pub struct LoteCreado {
    pub lote_id: Uuid,
    pub codigo_interno: String,
    pub numero_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub presentacion_nombre: Option<String>,
    pub area_nombre: String,
    pub cantidad: rust_decimal::Decimal,
}
```

- [ ] **Step 2: Actualizar `crear_recepcion` en el service para retornar lotes y manejar `rechazada`**

En `backend/src/services/recepcion_service.rs`, reemplazar la función `crear_recepcion` completa:

```rust
pub async fn crear_recepcion(
    pool: &PgPool,
    req: CreateRecepcion,
    usuario_id: Uuid,
) -> Result<(Uuid, Vec<crate::dto::recepcion::LoteCreado>), AppError> {
    req.validate().map_err(|e| AppError::Validation(e.to_string()))?;

    let estado = req.estado.as_deref().unwrap_or("completa");
    if !["completa", "parcial", "rechazada", "borrador"].contains(&estado) {
        return Err(AppError::Validation(format!("Estado inválido: {}", estado)));
    }

    // Para rechazada: no se necesitan ítems en detalle
    if estado != "rechazada" && req.detalle.is_empty() {
        return Err(AppError::Validation("Se requiere al menos un ítem en el detalle".into()));
    }

    let mut tx = pool.begin().await?;

    let (recepcion_id, _numero): (Uuid, String) = sqlx::query_as(
        "INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, nota, motivo_rechazo, solicitud_id, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, numero_documento"
    )
    .bind(req.proveedor_id)
    .bind(&req.guia_despacho)
    .bind(estado)
    .bind(req.fecha_recepcion)
    .bind(&req.nota)
    .bind(&req.motivo_rechazo)
    .bind(req.solicitud_id)
    .bind(usuario_id)
    .fetch_one(&mut *tx)
    .await?;

    let mut lotes_creados: Vec<crate::dto::recepcion::LoteCreado> = Vec::new();

    // Para rechazada no procesamos ítems
    if estado != "rechazada" {
        for item in &req.detalle {
            // Obtener nombre del producto y área para el LoteCreado
            let (producto_nombre, presentacion_nombre, area_nombre): (String, Option<String>, String) = sqlx::query_as(
                r#"SELECT p.nombre,
                          (SELECT pr.nombre FROM presentaciones pr WHERE pr.id = $2),
                          a.nombre
                   FROM productos p, areas a
                   WHERE p.id = $1 AND a.id = $3"#
            )
            .bind(item.producto_id)
            .bind(item.presentacion_id)
            .bind(item.area_destino_id)
            .fetch_one(&mut *tx)
            .await?;

            let (lote_id, codigo_interno): (Uuid, String) = sqlx::query_as(
                r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario, codigo_interno)
                   VALUES ($1, $2, $3, $4, $5, 'L' || LPAD(nextval('seq_lot_numero')::text, 6, '0'))
                   ON CONFLICT (producto_id, numero_lote)
                   DO UPDATE SET fecha_vencimiento = EXCLUDED.fecha_vencimiento, costo_unitario = EXCLUDED.costo_unitario
                   RETURNING id, codigo_interno"#
            )
            .bind(item.producto_id)
            .bind(req.proveedor_id)
            .bind(&item.numero_lote)
            .bind(item.fecha_vencimiento)
            .bind(item.costo_unitario)
            .fetch_one(&mut *tx)
            .await?;

            let factor = if let Some(pres_id) = item.presentacion_id {
                sqlx::query_scalar::<_, Decimal>(
                    "SELECT factor_conversion FROM presentaciones WHERE id = $1"
                )
                .bind(pres_id)
                .fetch_one(&mut *tx)
                .await?
            } else {
                Decimal::from(1)
            };

            let cantidad_base = item.cantidad_presentaciones * factor;

            sqlx::query(
                "INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
                                              cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
            )
            .bind(recepcion_id)
            .bind(item.producto_id)
            .bind(lote_id)
            .bind(item.presentacion_id)
            .bind(item.area_destino_id)
            .bind(item.cantidad_presentaciones)
            .bind(factor)
            .bind(cantidad_base)
            .bind(item.precio_unitario)
            .execute(&mut *tx)
            .await?;

            // completa y parcial ambas aplican movimientos de stock
            if estado == "completa" || estado == "parcial" {
                stock_ops::aplicar_ingreso(
                    &mut tx,
                    lote_id,
                    item.area_destino_id,
                    cantidad_base,
                    usuario_id,
                    "INGRESO",
                    Some(recepcion_id),
                    None,
                    Some("RECEPCION"),
                )
                .await?;
            }

            lotes_creados.push(crate::dto::recepcion::LoteCreado {
                lote_id,
                codigo_interno,
                numero_lote: item.numero_lote.clone(),
                fecha_vencimiento: item.fecha_vencimiento,
                producto_id: item.producto_id,
                producto_nombre,
                presentacion_nombre,
                area_nombre,
                cantidad: item.cantidad_presentaciones,
            });
        }
    }

    tx.commit().await?;
    Ok((recepcion_id, lotes_creados))
}
```

- [ ] **Step 3: Actualizar el handler `crear` en `recepciones.rs` para usar la nueva firma**

En `backend/src/handlers/recepciones.rs`, reemplazar la función `crear`:

```rust
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<CreateRecepcion>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /recepciones", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let (id, lotes) = match recepcion_service::crear_recepcion(&state.pool, req, claims.sub).await {
        Ok(result) => result,
        Err(e) => {
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            return Err(e);
        }
    };

    let response = serde_json::json!({ "id": id, "lotes": lotes });
    idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;

    Ok((StatusCode::CREATED, Json(response)))
}
```

- [ ] **Step 4: Compilar backend**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Esperado: `Finished` sin errores. Si hay error de tipo en la query del producto/área, verificar que los campos existan en las tablas.

- [ ] **Step 5: Commit**

```bash
git add backend/src/dto/recepcion.rs backend/src/services/recepcion_service.rs backend/src/handlers/recepciones.rs
git commit -m "feat(recepciones): add motivo_rechazo, handle parcial/rechazada states, return lotes in response"
```

---

## Task 3: Backend — extender scan con lookup por lote.codigo_interno

**Files:**
- Modify: `backend/src/services/producto_service.rs:332-429`

- [ ] **Step 1: Agregar lookup por `lote.codigo_interno` al final de `buscar_por_codigo`**

En `backend/src/services/producto_service.rs`, reemplazar el bloque final de `buscar_por_codigo` (desde el comentario `// 2. Buscar por código interno` hasta el `Ok(json!({ "encontrado": false }))`):

```rust
        // 2. Buscar por código interno del producto
        let row2 = sqlx::query_as::<_, Row2>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url
               FROM productos p
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE p.codigo_interno = $1 AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row2 {
            return Ok(json!({
                "encontrado": true,
                "tipo": "producto",
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": null,
                "presentacion_nombre": null,
                "factor_conversion": null,
                "stock_total": r.stock_total,
                "imagen_url": r.imagen_url,
            }));
        }

        // 3. Buscar por codigo_interno del lote (para escanear etiquetas impresas en recepción)
        #[derive(sqlx::FromRow)]
        struct Row3 {
            lote_id: Uuid,
            codigo_interno_lote: String,
            numero_lote: String,
            fecha_vencimiento: chrono::NaiveDate,
            producto_id: Uuid,
            producto_nombre: String,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            presentacion_id: Option<i32>,
            presentacion_nombre: Option<String>,
            area_id: Option<i32>,
            area_nombre: Option<String>,
            imagen_url: Option<String>,
        }

        let row3 = sqlx::query_as::<_, Row3>(
            r#"SELECT
                 l.id as lote_id,
                 l.codigo_interno as codigo_interno_lote,
                 l.numero_lote,
                 l.fecha_vencimiento,
                 p.id as producto_id,
                 p.nombre as producto_nombre,
                 ub.nombre as unidad_base_nombre,
                 ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT pr.id FROM presentaciones pr
                  WHERE pr.producto_id = p.id AND pr.activa = true
                  ORDER BY pr.id ASC LIMIT 1) as presentacion_id,
                 (SELECT pr.nombre FROM presentaciones pr
                  WHERE pr.producto_id = p.id AND pr.activa = true
                  ORDER BY pr.id ASC LIMIT 1) as presentacion_nombre,
                 (SELECT s.area_id FROM stock s WHERE s.lote_id = l.id AND s.cantidad > 0
                  ORDER BY s.cantidad DESC LIMIT 1) as area_id,
                 (SELECT a.nombre FROM stock s JOIN areas a ON a.id = s.area_id
                  WHERE s.lote_id = l.id AND s.cantidad > 0
                  ORDER BY s.cantidad DESC LIMIT 1) as area_nombre,
                 p.imagen_url
               FROM lotes l
               JOIN productos p ON p.id = l.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE l.codigo_interno = $1 AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row3 {
            return Ok(json!({
                "encontrado": true,
                "tipo": "lote",
                "lote_id": r.lote_id,
                "codigo_interno_lote": r.codigo_interno_lote,
                "numero_lote": r.numero_lote,
                "fecha_vencimiento": r.fecha_vencimiento,
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": r.presentacion_id,
                "presentacion_nombre": r.presentacion_nombre,
                "area_id": r.area_id,
                "area_nombre": r.area_nombre,
                "imagen_url": r.imagen_url,
            }));
        }

        Ok(json!({ "encontrado": false }))
```

- [ ] **Step 2: Compilar**

```bash
cd backend && cargo build 2>&1 | tail -10
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/producto_service.rs
git commit -m "feat(scan): extend scan endpoint to resolve lote.codigo_interno"
```

---

## Task 4: Frontend — componente ReceptionItemCard

**Files:**
- Create: `frontend/src/pages/recepciones/components/item-card.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
// frontend/src/pages/recepciones/components/item-card.tsx
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductoImage } from '@/components/ui/producto-image'
import { formatCantidad } from '@/lib/utils'
import type { Area, Presentacion } from '@/types'

export interface DetalleLineUI {
  id: string
  producto_id: string
  producto_nombre: string
  presentacion_id: number | null
  presentacion_nombre: string
  presentacion_nombre_plural: string
  cantidad_presentacion: number
  factor_conversion: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  codigo_lote: string
  fecha_vencimiento: string
  area_destino_id: number | null
  area_destino_nombre: string
  presentaciones: Presentacion[]
  precio_unitario: string
  imagen_url?: string | null
  incluir_etiqueta: boolean
  cantidad_etiquetas: number
}

interface Props {
  detalle: DetalleLineUI
  areas: Area[]
  onChange: (id: string, patch: Partial<DetalleLineUI>) => void
  onRemove: (id: string) => void
}

function isComplete(d: DetalleLineUI): boolean {
  return !!(d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
}

export function ReceptionItemCard({ detalle: d, areas, onChange, onRemove }: Props) {
  const complete = isComplete(d)

  const unidadLabel = formatCantidad(
    d.cantidad_presentacion,
    d.presentacion_nombre || d.unidad_base_nombre,
    d.presentacion_nombre_plural || d.unidad_base_nombre_plural
  )

  const baseEquiv = d.presentacion_id && d.factor_conversion > 1
    ? formatCantidad(
        d.cantidad_presentacion * d.factor_conversion,
        d.unidad_base_nombre,
        d.unidad_base_nombre_plural
      )
    : null

  return (
    <div className={`card bg-base-100 border p-4 transition-colors ${
      complete ? 'border-success/40' : 'border-warning/40'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <ProductoImage src={d.imagen_url} size="md" className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{d.producto_nombre}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {d.area_destino_id ? (
              <span className="badge badge-sm badge-ghost">{d.area_destino_nombre}</span>
            ) : (
              <select
                className="select select-bordered select-xs select-warning"
                value=""
                onChange={e => {
                  const aid = Number(e.target.value)
                  if (!aid) return
                  const nombre = areas.find(a => a.id === aid)?.nombre ?? ''
                  onChange(d.id, { area_destino_id: aid, area_destino_nombre: nombre })
                }}
              >
                <option value="">⚠ Asignar área…</option>
                {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            )}
            <span className={`badge badge-xs ${complete ? 'badge-success' : 'badge-warning'}`}>
              {complete ? '✓ Completo' : '⚠ Incompleto'}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onRemove(d.id)}>
          <Trash2 className="h-4 w-4 text-error" />
        </Button>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Lote</span></label>
          <input
            className={`input input-sm input-bordered w-full font-mono ${!d.codigo_lote ? 'input-warning' : ''}`}
            placeholder="Nº lote"
            value={d.codigo_lote}
            onChange={e => onChange(d.id, { codigo_lote: e.target.value })}
          />
        </div>
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Vencimiento</span></label>
          <input
            type="date"
            className={`input input-sm input-bordered w-full ${!d.fecha_vencimiento ? 'input-warning' : ''}`}
            value={d.fecha_vencimiento}
            onChange={e => onChange(d.id, { fecha_vencimiento: e.target.value })}
          />
        </div>
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Cantidad</span></label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              className="input input-sm input-bordered w-16"
              value={d.cantidad_presentacion}
              onChange={e => onChange(d.id, { cantidad_presentacion: Number(e.target.value) || 1 })}
            />
            {d.presentaciones.length > 1 ? (
              <select
                className="select select-bordered select-xs flex-1"
                value={d.presentacion_id ?? ''}
                onChange={e => {
                  const pid = Number(e.target.value)
                  const pres = d.presentaciones.find(p => p.id === pid)
                  if (!pres) return
                  onChange(d.id, {
                    presentacion_id: pres.id,
                    presentacion_nombre: pres.nombre,
                    presentacion_nombre_plural: pres.nombre_plural ?? '',
                    factor_conversion: Number(pres.factor_conversion),
                  })
                }}
              >
                {d.presentaciones.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs opacity-50 truncate">{unidadLabel.split(' ').slice(1).join(' ')}</span>
            )}
          </div>
          {baseEquiv && (
            <p className="text-xs opacity-40 mt-0.5">= {baseEquiv}</p>
          )}
        </div>
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Precio unit.</span></label>
          <input
            type="number"
            className="input input-sm input-bordered w-full"
            placeholder="$0"
            value={d.precio_unitario}
            onChange={e => onChange(d.id, { precio_unitario: e.target.value })}
          />
        </div>
      </div>

      {/* Etiqueta toggle */}
      {complete && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-base-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={d.incluir_etiqueta}
              onChange={e => onChange(d.id, { incluir_etiqueta: e.target.checked })}
            />
            <span className="text-xs">🏷️ Imprimir etiqueta</span>
          </label>
          {d.incluir_etiqueta && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs opacity-50">Cant.:</span>
              <input
                type="number"
                min={1}
                max={99}
                className="input input-xs input-bordered w-14 text-center"
                value={d.cantidad_etiquetas}
                onChange={e => onChange(d.id, { cantidad_etiquetas: Math.max(1, Number(e.target.value)) })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/recepciones/components/item-card.tsx
git commit -m "feat(recepciones): add ReceptionItemCard component with inline editing"
```

---

## Task 5: Frontend — utilidad de impresión de etiquetas

**Files:**
- Create: `frontend/src/lib/label-print.ts`

- [ ] **Step 1: Crear utilidad**

```ts
// frontend/src/lib/label-print.ts
import QRCode from 'qrcode'

export interface LoteParaEtiqueta {
  lote_id: string
  codigo_interno: string   // valor codificado en el QR
  numero_lote: string
  fecha_vencimiento: string
  producto_nombre: string
  presentacion_nombre?: string | null
  area_nombre: string
  cantidad_etiquetas: number  // cuántas copias imprimir
}

/**
 * Genera HTML imprimible con etiquetas 50x25mm (una por fila, repetidas según cantidad_etiquetas)
 * y dispara window.print() en un iframe oculto.
 */
export async function imprimirEtiquetas(lotes: LoteParaEtiqueta[]): Promise<void> {
  const filas: string[] = []

  for (const lote of lotes) {
    const qrDataUrl = await QRCode.toDataURL(lote.codigo_interno, {
      width: 64,
      margin: 1,
      errorCorrectionLevel: 'M',
    })

    const fechaCorta = lote.fecha_vencimiento
      ? new Date(lote.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL', {
          day: '2-digit', month: '2-digit', year: '2-digit'
        })
      : '—'

    const unidad = lote.presentacion_nombre || ''
    const nombreCorto = lote.producto_nombre.length > 28
      ? lote.producto_nombre.slice(0, 26) + '…'
      : lote.producto_nombre

    const etiquetaHtml = `
      <div class="label">
        <img class="qr" src="${qrDataUrl}" alt="QR ${lote.codigo_interno}" />
        <div class="info">
          <div class="nombre">${nombreCorto}</div>
          <div class="sub">${unidad ? unidad + ' · ' : ''}${lote.area_nombre}</div>
          <div class="lote">Lote: ${lote.numero_lote}</div>
          <div class="vence">Vence: ${fechaCorta}</div>
        </div>
      </div>`

    for (let i = 0; i < lote.cantidad_etiquetas; i++) {
      filas.push(etiquetaHtml)
    }
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  @page { size: 50mm 25mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; }
  .label {
    width: 50mm; height: 25mm;
    display: flex; align-items: center; gap: 2mm;
    padding: 1.5mm; page-break-after: always;
    border: 0.3mm solid #ccc;
    overflow: hidden;
  }
  .label:last-child { page-break-after: avoid; }
  .qr { width: 18mm; height: 18mm; flex-shrink: 0; }
  .info { flex: 1; min-width: 0; }
  .nombre { font-size: 6pt; font-weight: bold; line-height: 1.2; margin-bottom: 0.5mm; }
  .sub    { font-size: 5pt; color: #555; margin-bottom: 0.5mm; white-space: nowrap; overflow: hidden; }
  .lote   { font-size: 5.5pt; font-family: monospace; }
  .vence  { font-size: 5.5pt; color: #333; }
</style>
</head>
<body>
${filas.join('\n')}
</body>
</html>`

  // Crear iframe oculto para no navegar fuera de la página
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }

  doc.open()
  doc.write(html)
  doc.close()

  // Esperar a que las imágenes QR carguen
  await new Promise<void>(resolve => setTimeout(resolve, 400))

  iframe.contentWindow?.print()

  // Limpiar después de imprimir
  setTimeout(() => document.body.removeChild(iframe), 2000)
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/label-print.ts
git commit -m "feat(labels): add label print utility with QR code generation"
```

---

## Task 6: Frontend — componente LabelsSection

**Files:**
- Create: `frontend/src/pages/recepciones/components/labels-section.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
// frontend/src/pages/recepciones/components/labels-section.tsx
import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { imprimirEtiquetas, type LoteParaEtiqueta } from '@/lib/label-print'
import { toast } from 'sonner'
import type { DetalleLineUI } from './item-card'

interface LoteConfirmado extends LoteParaEtiqueta {
  // tras confirmar, el servidor devuelve codigo_interno real del lote
}

interface Props {
  // Fase 1: durante el llenado del formulario — muestra preview y permite configurar
  detalles?: DetalleLineUI[]
  onToggleEtiqueta?: (id: string, incluir: boolean) => void
  onCantidadEtiqueta?: (id: string, cant: number) => void
  // Fase 2: tras confirmar — imprime con los lotes reales del servidor
  lotesConfirmados?: LoteConfirmado[]
}

export function LabelsSection({ detalles, onToggleEtiqueta, onCantidadEtiqueta, lotesConfirmados }: Props) {
  const [imprimiendo, setImprimiendo] = useState(false)

  // Fase post-confirmación: imprime directamente con lotes del servidor
  if (lotesConfirmados) {
    const total = lotesConfirmados.reduce((s, l) => s + l.cantidad_etiquetas, 0)

    const handlePrint = async () => {
      setImprimiendo(true)
      try {
        await imprimirEtiquetas(lotesConfirmados)
      } catch {
        toast.error('Error al generar etiquetas')
      } finally {
        setImprimiendo(false)
      }
    }

    return (
      <div className="card bg-base-100 border border-primary/30 p-4">
        <p className="font-semibold text-sm mb-3">🏷️ Etiquetas listas para imprimir</p>
        <div className="space-y-1 mb-3">
          {lotesConfirmados.map(l => (
            <div key={l.lote_id} className="flex justify-between text-xs text-base-content/70">
              <span className="truncate">{l.producto_nombre}</span>
              <span className="font-mono ml-2">{l.codigo_interno} · {l.cantidad_etiquetas} etiq.</span>
            </div>
          ))}
        </div>
        <Button className="w-full" onClick={handlePrint} disabled={imprimiendo}>
          <Printer className="h-4 w-4 mr-2" />
          {imprimiendo ? 'Generando…' : `Imprimir ${total} etiqueta${total !== 1 ? 's' : ''}`}
        </Button>
      </div>
    )
  }

  // Fase pre-confirmación: configuración de etiquetas por ítem
  if (!detalles) return null
  const completos = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
  if (completos.length === 0) return null

  const seleccionados = completos.filter(d => d.incluir_etiqueta)
  const totalEtiquetas = seleccionados.reduce((s, d) => s + d.cantidad_etiquetas, 0)

  return (
    <div className="card bg-base-100 border border-dashed p-4">
      <p className="font-semibold text-sm mb-3">🏷️ Configurar etiquetas</p>
      <div className="space-y-2">
        {completos.map(d => (
          <div key={d.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={d.incluir_etiqueta}
              onChange={e => onToggleEtiqueta?.(d.id, e.target.checked)}
            />
            <span className="flex-1 truncate text-xs">{d.producto_nombre}</span>
            <span className="text-xs opacity-50 font-mono">{d.codigo_lote}</span>
            {d.incluir_etiqueta && (
              <input
                type="number"
                min={1}
                max={99}
                className="input input-xs input-bordered w-14 text-center"
                value={d.cantidad_etiquetas}
                onChange={e => onCantidadEtiqueta?.(d.id, Math.max(1, Number(e.target.value)))}
              />
            )}
          </div>
        ))}
      </div>
      {totalEtiquetas > 0 && (
        <p className="text-xs opacity-50 mt-2 text-right">
          {totalEtiquetas} etiqueta{totalEtiquetas !== 1 ? 's' : ''} se imprimirán al confirmar
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/recepciones/components/labels-section.tsx
git commit -m "feat(recepciones): add LabelsSection component for pre/post confirm label config"
```

---

## Task 7: Frontend — reescribir nueva.tsx con layout B+C

**Files:**
- Modify: `frontend/src/pages/recepciones/nueva.tsx`

- [ ] **Step 1: Reescribir el archivo completo**

```tsx
// frontend/src/pages/recepciones/nueva.tsx
import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { ArrowLeft, Search, ShoppingCart, ScanLine } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import { toast } from 'sonner'
import { ReceptionItemCard, type DetalleLineUI } from './components/item-card'
import { LabelsSection } from './components/labels-section'
import { imprimirEtiquetas, type LoteParaEtiqueta } from '@/lib/label-print'
import type { Proveedor, Producto, Area, SolicitudResumen } from '@/types'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Decision = 'completa' | 'parcial' | 'rechazada'

interface LoteConfirmadoApi {
  lote_id: string
  codigo_interno: string
  numero_lote: string
  fecha_vencimiento: string
  producto_nombre: string
  presentacion_nombre: string | null
  area_nombre: string
  cantidad: number
}

const TODAY = new Date().toISOString().split('T')[0]
const NOW_TIME = new Date().toTimeString().slice(0, 5)

const MOTIVOS_RECHAZO = [
  { id: 'temperatura', label: '🌡️ Cadena de frío rota' },
  { id: 'embalaje', label: '📦 Embalaje dañado' },
  { id: 'documentos', label: '📄 Documentos incorrectos' },
  { id: 'cantidad', label: '🔢 Cantidad no coincide' },
  { id: 'no_solicitado', label: '⚗️ Producto no solicitado' },
]

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()

  // Estado cabecera
  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [guiaDespacho, setGuiaDespacho] = useState('')
  const [fechaRecepcion] = useState(TODAY)
  const [horaRecepcion] = useState(NOW_TIME)
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [solicitudModalOpen, setSolicitudModalOpen] = useState(false)

  // Estado ítems
  const [detalles, setDetalles] = useState<DetalleLineUI[]>([])
  const [searchValue, setSearchValue] = useState('')

  // Estado decisión
  const [decision, setDecision] = useState<Decision>('completa')
  const [motivosSeleccionados, setMotivosSeleccionados] = useState<string[]>([])
  const [motivoOtro, setMotivoOtro] = useState('')
  const [nota, setNota] = useState('')

  // Estado post-confirmación (para imprimir etiquetas)
  const [lotesConfirmados, setLotesConfirmados] = useState<LoteParaEtiqueta[] | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then(r => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then(r => r.data),
  })

  const { data: productos } = useQuery({
    queryKey: ['productos-all'],
    queryFn: () => api.get<{ data: Producto[] }>('/productos', { params: { per_page: 500 } }).then(r => r.data.data),
  })

  const { data: solicitudesPendientes } = useQuery({
    queryKey: ['solicitudes-activas'],
    queryFn: () => api.get<{ data: SolicitudResumen[] }>('/solicitudes-compra').then(r =>
      (r.data.data ?? []).filter(s => ['aprobada', 'enviada'].includes(s.estado))
    ),
  })

  // ─── Agregar ítem ──────────────────────────────────────────────────────────

  const addProducto = useCallback(async (prod: Producto) => {
    try {
      const res = await api.get(`/productos/${prod.id}`)
      const full = res.data
      const presentaciones = full.presentaciones || []
      const pres = presentaciones[0] || null

      const catalogoArea = full.areas?.[0]
      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prod.id),
        producto_nombre: prod.nombre,
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_presentacion: 1,
        factor_conversion: Number(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        codigo_lote: '',
        fecha_vencimiento: '',
        area_destino_id: catalogoArea?.id ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? '',
        presentaciones,
        precio_unitario: full.precio_unidad ? String((full.precio_unidad * Number(pres?.factor_conversion || 1)).toFixed(2)) : '',
        imagen_url: full.imagen_url,
        incluir_etiqueta: false,
        cantidad_etiquetas: 1,
      }
      setDetalles(prev => [line, ...prev])
      toast.success(`${prod.nombre} añadido`)
    } catch {
      toast.error('Error al cargar producto')
    }
  }, [])

  // ─── Búsqueda / Scan ───────────────────────────────────────────────────────

  const handleSearch = useCallback(async (valor: string) => {
    const q = valor.trim()
    if (q.length < 2) return

    try {
      const res = await api.get('/productos/scan', { params: { codigo: q } })
      const data = res.data

      if (!data.encontrado) {
        // Fallback a búsqueda por nombre
        const found = productos?.find(p =>
          p.nombre.toLowerCase().includes(q.toLowerCase()) ||
          p.codigo_interno.toLowerCase() === q.toLowerCase()
        )
        if (found) { await addProducto(found); setSearchValue(''); return }
        toast.error('Producto no encontrado')
        return
      }

      if (data.tipo === 'lote') {
        // Escaneo de etiqueta existente: pre-rellenar lote y vencimiento
        const pres = data.presentacion_id
          ? [{ id: data.presentacion_id, nombre: data.presentacion_nombre, nombre_plural: data.presentacion_nombre + 's', factor_conversion: 1, activa: true, version: 1 }]
          : []

        const line: DetalleLineUI = {
          id: uuidv4(),
          producto_id: String(data.producto_id),
          producto_nombre: data.producto_nombre,
          presentacion_id: data.presentacion_id || null,
          presentacion_nombre: data.presentacion_nombre || '',
          presentacion_nombre_plural: data.presentacion_nombre ? data.presentacion_nombre + 's' : '',
          cantidad_presentacion: 1,
          factor_conversion: 1,
          unidad_base_nombre: data.unidad_base_nombre || '',
          unidad_base_nombre_plural: data.unidad_base_nombre_plural || '',
          codigo_lote: data.numero_lote,
          fecha_vencimiento: data.fecha_vencimiento || '',
          area_destino_id: data.area_id || null,
          area_destino_nombre: data.area_nombre || '',
          presentaciones: pres,
          precio_unitario: '',
          imagen_url: data.imagen_url || null,
          incluir_etiqueta: false,
          cantidad_etiquetas: 1,
        }
        setDetalles(prev => [line, ...prev])
        toast.success(`Lote ${data.numero_lote} añadido`)
      } else {
        // Producto por código interno o código de barras
        const prod = productos?.find(p => p.id === data.producto_id || String(p.id) === String(data.producto_id))
        if (prod) await addProducto(prod)
      }
      setSearchValue('')
    } catch {
      toast.error('Error en la búsqueda')
    }
  }, [productos, addProducto])

  // ─── Cambiar ítem ──────────────────────────────────────────────────────────

  const handleChange = useCallback((id: string, patch: Partial<DetalleLineUI>) => {
    setDetalles(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  }, [])

  const handleRemove = useCallback((id: string) => {
    setDetalles(prev => prev.filter(d => d.id !== id))
  }, [])

  // ─── Confirmar ─────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: (payload: object) => api.post('/recepciones', payload, {
      headers: { 'x-idempotency-key': uuidv4() }
    }),
    onSuccess: (res) => {
      const lotes: LoteConfirmadoApi[] = res.data.lotes ?? []
      // Filtrar solo los que el usuario marcó para imprimir
      const paraImprimir: LoteParaEtiqueta[] = lotes
        .map(l => {
          const detalle = detalles.find(d => d.codigo_lote === l.numero_lote && d.producto_id === l.producto_id)
          if (!detalle?.incluir_etiqueta) return null
          return {
            lote_id: l.lote_id,
            codigo_interno: l.codigo_interno,
            numero_lote: l.numero_lote,
            fecha_vencimiento: l.fecha_vencimiento,
            producto_nombre: l.producto_nombre,
            presentacion_nombre: l.presentacion_nombre,
            area_nombre: l.area_nombre,
            cantidad_etiquetas: detalle.cantidad_etiquetas,
          } satisfies LoteParaEtiqueta
        })
        .filter((x): x is LoteParaEtiqueta => x !== null)

      if (paraImprimir.length > 0) {
        setLotesConfirmados(paraImprimir)
        setShowPrintModal(true)
      } else {
        toast.success('Recepción confirmada')
        navigate('/recepciones')
      }
    },
    onError: () => toast.error('Error al confirmar recepción'),
  })

  const handleConfirmar = () => {
    if (!proveedorId) { toast.error('Selecciona un proveedor'); return }

    if (decision === 'rechazada') {
      if (motivosSeleccionados.length === 0 && !motivoOtro.trim()) {
        toast.error('Indica al menos un motivo de rechazo')
        return
      }
      const motivos = [
        ...motivosSeleccionados.map(id => MOTIVOS_RECHAZO.find(m => m.id === id)?.label ?? id),
        ...(motivoOtro.trim() ? [`Otro: ${motivoOtro.trim()}`] : []),
      ].join(' | ')

      mutation.mutate({
        proveedor_id: proveedorId,
        guia_despacho: guiaDespacho || undefined,
        fecha_recepcion: new Date(`${fechaRecepcion}T${horaRecepcion}`).toISOString(),
        estado: 'rechazada',
        motivo_rechazo: motivos,
        solicitud_id: solicitudId || undefined,
        detalle: [],
      })
      return
    }

    const validos = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
    if (validos.length === 0) { toast.error('Completa al menos un ítem con lote, vencimiento y área'); return }

    if (decision === 'parcial' && !nota.trim()) {
      toast.error('Indica en la nota qué faltó por recibir')
      return
    }

    mutation.mutate({
      proveedor_id: proveedorId,
      guia_despacho: guiaDespacho || undefined,
      fecha_recepcion: new Date(`${fechaRecepcion}T${horaRecepcion}`).toISOString(),
      estado: decision,
      nota: nota || undefined,
      solicitud_id: solicitudId || undefined,
      detalle: validos.map(d => ({
        producto_id: d.producto_id,
        numero_lote: d.codigo_lote,
        fecha_vencimiento: d.fecha_vencimiento,
        presentacion_id: d.presentacion_id,
        cantidad_presentaciones: d.cantidad_presentacion,
        area_destino_id: d.area_destino_id!,
        precio_unitario: d.precio_unitario ? parseFloat(d.precio_unitario) : undefined,
      })),
    })
  }

  // ─── Helpers UI ────────────────────────────────────────────────────────────

  const toggleMotivo = (id: string) =>
    setMotivosSeleccionados(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )

  const estadoBadge = {
    completa:  { label: 'Conforme', cls: 'badge-success' },
    parcial:   { label: 'Parcial', cls: 'badge-info' },
    rechazada: { label: 'Rechazada', cls: 'badge-error' },
  }[decision]

  const btnLabel = {
    completa:  'Confirmar recepción',
    parcial:   'Confirmar recepción parcial',
    rechazada: 'Registrar rechazo',
  }[decision]

  const itemsCompletos = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id).length

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4">
      {/* Título */}
      <div className="flex items-center gap-3 mb-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recepciones')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Nueva Recepción</h1>
      </div>

      {/* Layout B+C */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Panel izquierdo ── */}
        <div className="w-full lg:w-72 lg:sticky lg:top-4 space-y-4">

          {/* Datos guía */}
          <div className="card bg-base-100 border p-4 space-y-3">
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Guía de Despacho</h2>

            <div>
              <label className="label py-0.5"><span className="label-text text-xs">Proveedor *</span></label>
              <ProveedorSelect
                value={proveedorId || ''}
                onChange={v => setProveedorId(Number(v))}
                proveedores={proveedores || []}
              />
            </div>

            <div>
              <label className="label py-0.5"><span className="label-text text-xs">Nº Guía de Despacho</span></label>
              <input
                className="input input-sm input-bordered w-full"
                placeholder="GD-00000"
                value={guiaDespacho}
                onChange={e => setGuiaDespacho(e.target.value)}
              />
            </div>

            <div>
              <label className="label py-0.5"><span className="label-text text-xs">Fecha recepción</span></label>
              <div className="flex gap-1">
                <input type="date" className="input input-sm input-bordered flex-1" defaultValue={TODAY} readOnly />
                <input type="time" className="input input-sm input-bordered w-20" defaultValue={NOW_TIME} readOnly />
              </div>
            </div>

            <button
              className="btn btn-sm btn-ghost btn-outline w-full border-dashed"
              onClick={() => setSolicitudModalOpen(true)}
            >
              <ShoppingCart className="h-4 w-4 mr-1" />
              {solicitudId ? 'Solicitud vinculada ✓' : 'Vincular solicitud'}
            </button>
          </div>

          {/* Estado */}
          <div className="card bg-base-100 border p-4 space-y-2">
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Estado</h2>
            <span className={`badge ${estadoBadge.cls}`}>{estadoBadge.label}</span>
            {detalles.length > 0 && (
              <p className="text-xs opacity-50">
                {itemsCompletos}/{detalles.length} ítems completos
              </p>
            )}
          </div>

          {/* Decisión */}
          <div className="card bg-base-100 border p-4 space-y-3">
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Decisión de recepción</h2>

            {(['completa', 'parcial', 'rechazada'] as Decision[]).map(dec => (
              <label key={dec} className={cn(
                'flex items-start gap-2 cursor-pointer rounded-lg p-2 border transition-colors',
                decision === dec
                  ? dec === 'completa' ? 'border-success bg-success/10'
                  : dec === 'parcial'  ? 'border-info bg-info/10'
                  : 'border-error bg-error/10'
                  : 'border-transparent hover:border-base-300'
              )}>
                <input
                  type="radio"
                  className="radio radio-sm mt-0.5"
                  checked={decision === dec}
                  onChange={() => setDecision(dec)}
                />
                <div>
                  <p className="text-sm font-medium">
                    {dec === 'completa' ? '✅ Conforme'
                      : dec === 'parcial' ? '⚠️ Recepción parcial'
                      : '🚫 Rechazar guía'}
                  </p>
                  <p className="text-xs opacity-50">
                    {dec === 'completa' ? 'Todo llegó según lo esperado'
                      : dec === 'parcial' ? 'Solo parte del pedido recibido'
                      : 'No se recepciona ningún ítem'}
                  </p>
                </div>
              </label>
            ))}

            {/* Motivos de rechazo */}
            {decision === 'rechazada' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs opacity-50">Motivo(s):</p>
                {MOTIVOS_RECHAZO.map(m => (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm checkbox-error"
                      checked={motivosSeleccionados.includes(m.id)}
                      onChange={() => toggleMotivo(m.id)}
                    />
                    {m.label}
                  </label>
                ))}
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full text-xs"
                  placeholder="Otro motivo (opcional)…"
                  value={motivoOtro}
                  onChange={e => setMotivoOtro(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            {/* Nota para parcial */}
            {decision === 'parcial' && (
              <textarea
                className="textarea textarea-bordered textarea-sm w-full text-xs"
                placeholder="Describe qué faltó por recibir…"
                value={nota}
                onChange={e => setNota(e.target.value)}
                rows={2}
              />
            )}

            <Button
              className="w-full"
              variant={decision === 'rechazada' ? 'destructive' : 'default'}
              onClick={handleConfirmar}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? <span className="loading loading-spinner loading-sm" />
                : btnLabel}
            </Button>
          </div>
        </div>

        {/* ── Panel derecho ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Búsqueda / scan */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" />
            <input
              className="input input-bordered w-full pl-10 pr-10"
              placeholder="Escanear QR · Código interno · Nombre del producto…"
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { handleSearch(searchValue) } }}
            />
            <ScanLine
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 cursor-pointer"
              onClick={() => handleSearch(searchValue)}
            />
          </div>

          {/* Lista de ítems */}
          {detalles.length === 0 ? (
            <div className="card bg-base-100 border border-dashed p-12 text-center">
              <p className="text-4xl mb-3">📦</p>
              <p className="opacity-50 text-sm">Escanea o busca productos para agregar ítems a la recepción</p>
            </div>
          ) : (
            <div className="space-y-3">
              {detalles.map(d => (
                <ReceptionItemCard
                  key={d.id}
                  detalle={d}
                  areas={areas ?? []}
                  onChange={handleChange}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}

          {/* Sección etiquetas */}
          {decision !== 'rechazada' && (
            <LabelsSection
              detalles={detalles}
              onToggleEtiqueta={(id, val) => handleChange(id, { incluir_etiqueta: val })}
              onCantidadEtiqueta={(id, val) => handleChange(id, { cantidad_etiquetas: val })}
            />
          )}
        </div>
      </div>

      {/* Modal vincular solicitud */}
      <Dialog open={solicitudModalOpen} onClose={() => setSolicitudModalOpen(false)} title="Vincular Solicitud">
        <div className="space-y-2">
          {solicitudesPendientes?.map(s => (
            <button
              key={s.id}
              className="w-full p-4 border rounded-xl hover:bg-base-200 text-left"
              onClick={async () => {
                const res = await api.get(`/solicitudes-compra/${s.id}`)
                setSolicitudId(s.id)
                setSolicitudModalOpen(false)
                toast.success('Solicitud vinculada')
                for (const item of res.data.items) {
                  const p = productos?.find(x => x.id === item.producto_id)
                  if (p) await addProducto(p)
                }
              }}
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-bold text-sm">{s.numero_documento}</p>
                  <p className="text-xs opacity-50">{formatDate(s.fecha_creacion)}</p>
                </div>
                <Badge variant="outline">{s.items_count} ítems</Badge>
              </div>
            </button>
          ))}
          {solicitudesPendientes?.length === 0 && (
            <p className="text-center py-8 opacity-40 text-sm">No hay solicitudes aprobadas.</p>
          )}
        </div>
      </Dialog>

      {/* Modal imprimir etiquetas post-confirmación */}
      <Dialog
        open={showPrintModal}
        onClose={() => { setShowPrintModal(false); navigate('/recepciones') }}
        title="¿Imprimir etiquetas?"
      >
        {lotesConfirmados && (
          <LabelsSection lotesConfirmados={lotesConfirmados} />
        )}
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { setShowPrintModal(false); navigate('/recepciones') }}
          >
            Saltar
          </Button>
          <Button
            className="flex-1"
            onClick={async () => {
              if (lotesConfirmados) await imprimirEtiquetas(lotesConfirmados)
              setShowPrintModal(false)
              navigate('/recepciones')
            }}
          >
            Imprimir y finalizar
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Verificar que TypeScript compila sin errores**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Si hay errores de tipo en `DetalleLineUI` (los campos `incluir_etiqueta` y `cantidad_etiquetas` son nuevos), verificar que el tipo en `item-card.tsx` coincida con el uso en `nueva.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/recepciones/nueva.tsx
git commit -m "feat(recepciones): rewrite nueva.tsx with B+C layout, decision section, QR scan, label printing"
```

---

## Task 8: Exportar tipos TypeScript

**Files:**
- Modify: `backend/src/bin/export_types.rs` (solo si `LoteCreado` necesita ser exportado)
- Modify: `frontend/src/types/generated.ts` (generado automáticamente)

- [ ] **Step 1: Agregar `LoteCreado` al export_types**

En `backend/src/bin/export_types.rs`, en la línea del import de `recepcion::` agregar `LoteCreado`:

```rust
// Antes (línea ~21):
recepcion::{RecepcionQuery, PaginatedRecepciones, RecepcionListItem, SubirFotoInput, CreateRecepcion, DetalleRecepcionInput, DetalleRecepcionRow},

// Después:
recepcion::{RecepcionQuery, PaginatedRecepciones, RecepcionListItem, SubirFotoInput, CreateRecepcion, DetalleRecepcionInput, DetalleRecepcionRow, LoteCreado},
```

Y después del bloque `append!(DetalleRecepcionRow);` agregar:

```rust
append!(LoteCreado);
```

- [ ] **Step 2: Regenerar tipos**

```bash
cd backend && cargo run --bin export_types
```

- [ ] **Step 3: Verificar que `LoteCreado` aparece en generated.ts**

```bash
grep "LoteCreado" frontend/src/types/generated.ts
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/bin/export_types.rs frontend/src/types/generated.ts
git commit -m "chore: regenerate TypeScript types with LoteCreado"
```

---

## Verificación final

- [ ] Levantar todo: `docker compose up --build -d && cd frontend && npm run dev`
- [ ] Navegar a `/recepciones/nueva`
- [ ] Verificar layout B+C en desktop (panel lateral fijo, panel derecho scrollable)
- [ ] Agregar un producto manualmente (búsqueda por nombre)
- [ ] Completar lote + vencimiento + área → badge cambia a verde, aparece toggle de etiqueta
- [ ] Cambiar decisión a "Rechazar" → aparecen motivos, botón cambia a rojo
- [ ] Cambiar decisión a "Parcial" → aparece textarea de nota
- [ ] Confirmar como "Conforme" → si hay etiquetas marcadas, aparece modal de impresión
- [ ] Verificar en DB: `SELECT estado, motivo_rechazo FROM recepciones ORDER BY created_at DESC LIMIT 1`
