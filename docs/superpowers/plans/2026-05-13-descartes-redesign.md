# Descartes Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la página de descartes con: stock vencido cross-área por defecto, filtros por área/proveedor, tab de historial con sesiones expandibles y exportación PDF por sesión y por rango de fechas.

**Architecture:** Dos tabs en `index.tsx` (NuevoDescarte + Historial). Backend agrega `GET /stock/lotes-vencidos` (todos los lotes vencidos cross-área) y `GET /descartes` (historial de sesiones). El frontend genera PDFs 100% client-side con jspdf (ya instalado) siguiendo el patrón de `solicitud-pdf.ts`.

**Tech Stack:** Rust/Axum/SQLx (backend), React 19 + TypeScript + Tailwind + shadcn/ui (frontend), jspdf + jspdf-autotable (PDF, ya instalados).

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `backend/src/handlers/stock.rs` | Modificar | Agregar handler `lotes_vencidos` y ruta GET |
| `backend/src/handlers/descartes.rs` | Modificar | Agregar handler `listar` y ruta GET |
| `frontend/src/types/index.ts` | Modificar | Agregar tipos `DescarteVencidoItem`, `DescarteSession`, `DescarteSessionItem` |
| `frontend/src/lib/descarte-pdf.ts` | Crear | Generación de PDF de acta de descarte |
| `frontend/src/pages/descartes/use-descartes-stock.ts` | Crear | Query hook para `/stock/lotes-vencidos` |
| `frontend/src/pages/descartes/use-descartes-historial.ts` | Crear | Query hook para `GET /descartes` |
| `frontend/src/pages/descartes/nuevo-descarte-tab.tsx` | Crear | Tab de nuevo descarte (lista + carrito) |
| `frontend/src/pages/descartes/historial-tab.tsx` | Crear | Tab de historial con sesiones y PDF |
| `frontend/src/pages/descartes/index.tsx` | Reescribir | Shell con dos tabs |

---

## Task 1: Backend — GET /stock/lotes-vencidos

**Files:**
- Modify: `backend/src/handlers/stock.rs`

- [ ] **Paso 1: Agregar el handler `lotes_vencidos` al final de stock.rs, antes de `pub fn routes()`**

```rust
#[derive(Debug, Deserialize)]
struct LotesVencidosQuery {
    area_id: Option<i32>,
    proveedor_id: Option<i32>,
    dias_alerta: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct LoteVencidoItem {
    lote_id: Uuid,
    producto_id: Uuid,
    producto_nombre: String,
    codigo_lote: String,
    fecha_vencimiento: NaiveDate,
    area_id: i32,
    area_nombre: String,
    proveedor_id: Option<i32>,
    proveedor_nombre: Option<String>,
    cantidad: Decimal,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
}

async fn lotes_vencidos(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<LotesVencidosQuery>,
) -> Result<Json<Vec<LoteVencidoItem>>, AppError> {
    let dias = params.dias_alerta.unwrap_or(0);

    let mut conditions = vec![
        "s.cantidad > 0".to_string(),
        "l.fecha_vencimiento <= CURRENT_DATE + ($1 * INTERVAL '1 day')".to_string(),
    ];
    let mut param_idx = 1u32;

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("s.area_id = ${}", param_idx));
    }
    if params.proveedor_id.is_some() {
        param_idx += 1;
        conditions.push(format!("l.proveedor_id = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let sql = format!(
        r#"SELECT
               s.lote_id,
               l.producto_id,
               p.nombre AS producto_nombre,
               l.numero_lote AS codigo_lote,
               l.fecha_vencimiento,
               s.area_id,
               a.nombre AS area_nombre,
               l.proveedor_id,
               pv.nombre AS proveedor_nombre,
               s.cantidad,
               um.nombre AS unidad_base_nombre,
               um.nombre_plural AS unidad_base_nombre_plural
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = s.area_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           LEFT JOIN proveedores pv ON pv.id = l.proveedor_id
           WHERE {}
           ORDER BY l.fecha_vencimiento ASC, p.nombre ASC"#,
        where_clause
    );

    let mut query = sqlx::query_as::<_, LoteVencidoItem>(&sql).bind(dias);
    if let Some(v) = params.area_id {
        query = query.bind(v);
    }
    if let Some(v) = params.proveedor_id {
        query = query.bind(v);
    }

    let items = query.fetch_all(&state.pool).await?;
    Ok(Json(items))
}
```

- [ ] **Paso 2: Registrar la ruta en `pub fn routes()` al final de stock.rs**

Reemplazar:
```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/area/{area_id}", get(stock_por_area))
        .route("/alertas", get(alertas))
}
```

Por:
```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/area/{area_id}", get(stock_por_area))
        .route("/alertas", get(alertas))
        .route("/lotes-vencidos", get(lotes_vencidos))
}
```

- [ ] **Paso 3: Compilar backend para verificar**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Esperado: `Finished` sin errores.

- [ ] **Paso 4: Commit**

```bash
git add backend/src/handlers/stock.rs
git commit -m "feat(stock): agregar GET /stock/lotes-vencidos cross-area"
```

---

## Task 2: Backend — GET /descartes (historial de sesiones)

**Files:**
- Modify: `backend/src/handlers/descartes.rs`

- [ ] **Paso 1: Agregar imports y handler `listar` en descartes.rs**

Al inicio del archivo reemplazar los imports existentes por:
```rust
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::descarte::DescarteRequest;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;
use crate::services::{descarte_service, idempotency};
```

- [ ] **Paso 2: Agregar structs de query y handler `listar` antes de `pub fn routes()`**

```rust
#[derive(Debug, Deserialize)]
struct DescartesQuery {
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    area_id: Option<i32>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, sqlx::FromRow)]
struct DescarteSessionRow {
    grupo_movimiento: Uuid,
    fecha: DateTime<Utc>,
    usuario_nombre: String,
    total_items: i64,
    areas: Vec<String>,
    items: serde_json::Value,
    total_count: i64,
}

async fn listar(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<DescartesQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec![
        "m.tipo IN ('DESCARTE_VENCIDO', 'DESCARTE_DAÑADO')".to_string(),
    ];
    let mut param_idx = 0u32;

    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("m.created_at >= ${}::date", param_idx));
    }
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "m.created_at < ${}::date + INTERVAL '1 day'",
            param_idx
        ));
    }
    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.area_id = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let sql = format!(
        r#"WITH session_data AS (
               SELECT
                   m.grupo_movimiento,
                   MIN(m.created_at) AS fecha,
                   MIN(u.nombre) AS usuario_nombre,
                   COUNT(*)::bigint AS total_items,
                   ARRAY_AGG(DISTINCT a.nombre ORDER BY a.nombre) AS areas,
                   JSON_AGG(
                       JSON_BUILD_OBJECT(
                           'producto_nombre', p.nombre,
                           'codigo_lote', l.numero_lote,
                           'area_nombre', a.nombre,
                           'tipo', m.tipo,
                           'cantidad', m.cantidad,
                           'unidad_base_nombre', um.nombre,
                           'unidad_base_nombre_plural', um.nombre_plural,
                           'fecha_vencimiento', l.fecha_vencimiento,
                           'nota', m.nota
                       ) ORDER BY m.created_at ASC
                   ) AS items
               FROM movimientos m
               JOIN lotes l ON l.id = m.lote_id
               JOIN productos p ON p.id = l.producto_id
               JOIN areas a ON a.id = m.area_id
               JOIN usuarios u ON u.id = m.usuario_id
               JOIN unidades_basicas um ON um.id = p.unidad_base_id
               WHERE {}
               GROUP BY m.grupo_movimiento
           ),
           total_count AS (
               SELECT COUNT(*) AS total_count FROM session_data
           )
           SELECT s.*, tc.total_count
           FROM session_data s, total_count tc
           ORDER BY s.fecha DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        param_idx + 1,
        param_idx + 2,
    );

    let mut query = sqlx::query_as::<_, DescarteSessionRow>(&sql);

    if let Some(v) = params.desde {
        query = query.bind(v);
    }
    if let Some(v) = params.hasta {
        query = query.bind(v);
    }
    if let Some(v) = params.area_id {
        query = query.bind(v);
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(&state.pool).await?;
    let total = rows.first().map(|r| r.total_count).unwrap_or(0);

    let data: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "grupo_movimiento": r.grupo_movimiento,
                "fecha": r.fecha,
                "usuario_nombre": r.usuario_nombre,
                "total_items": r.total_items,
                "areas": r.areas,
                "items": r.items,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "data": data,
        "total": total,
        "page": pagination.page(),
        "per_page": limit,
    })))
}
```

- [ ] **Paso 3: Registrar la ruta GET en `pub fn routes()`**

Reemplazar:
```rust
pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(crear))
}
```

Por:
```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
}
```

- [ ] **Paso 4: Compilar**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Esperado: `Finished` sin errores.

- [ ] **Paso 5: Commit**

```bash
git add backend/src/handlers/descartes.rs
git commit -m "feat(descartes): agregar GET /descartes para historial de sesiones"
```

---

## Task 3: Frontend — Tipos TypeScript nuevos

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Paso 1: Agregar los tres tipos al final del archivo**

Abrir `frontend/src/types/index.ts` y agregar al final:

```typescript
export interface DescarteVencidoItem {
  lote_id: string
  producto_id: string
  producto_nombre: string
  codigo_lote: string
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
  proveedor_id: number | null
  proveedor_nombre: string | null
  cantidad: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
}

export interface DescarteSessionItem {
  producto_nombre: string
  codigo_lote: string
  area_nombre: string
  tipo: 'DESCARTE_VENCIDO' | 'DESCARTE_DAÑADO'
  cantidad: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  fecha_vencimiento: string
  nota: string | null
}

export interface DescarteSession {
  grupo_movimiento: string
  fecha: string
  usuario_nombre: string
  total_items: number
  areas: string[]
  items: DescarteSessionItem[]
}
```

- [ ] **Paso 2: Verificar que TypeScript compila sin errores**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores en `types/index.ts`.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): agregar DescarteVencidoItem, DescarteSession, DescarteSessionItem"
```

---

## Task 4: Frontend — Hook use-descartes-stock

**Files:**
- Create: `frontend/src/pages/descartes/use-descartes-stock.ts`

- [ ] **Paso 1: Crear el archivo**

```typescript
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import type { DescarteVencidoItem } from '@/types'

interface DescartesStockParams {
  diasAlerta?: number
  areaId?: number | null
  proveedorId?: number | null
}

export function useDescartesStock(params: DescartesStockParams) {
  return useQuery({
    queryKey: ['descartes-stock', params.diasAlerta ?? 0, params.areaId, params.proveedorId],
    queryFn: () =>
      api
        .get<DescarteVencidoItem[]>('/stock/lotes-vencidos', {
          params: {
            dias_alerta: params.diasAlerta ?? 0,
            area_id: params.areaId ?? undefined,
            proveedor_id: params.proveedorId ?? undefined,
          },
        })
        .then((r) => r.data),
    staleTime: 30_000,
  })
}
```

- [ ] **Paso 2: Verificar compilación TS**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "descartes" | head -10
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/pages/descartes/use-descartes-stock.ts
git commit -m "feat(descartes): hook useDescartesStock para lotes vencidos cross-area"
```

---

## Task 5: Frontend — Hook use-descartes-historial

**Files:**
- Create: `frontend/src/pages/descartes/use-descartes-historial.ts`

- [ ] **Paso 1: Crear el archivo**

```typescript
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import type { DescarteSession, PaginatedResponse } from '@/types'

interface DescartesHistorialParams {
  desde?: string | null
  hasta?: string | null
  areaId?: number | null
  page?: number
  perPage?: number
}

export function useDescartesHistorial(params: DescartesHistorialParams) {
  return useQuery({
    queryKey: ['descartes-historial', params.desde, params.hasta, params.areaId, params.page],
    queryFn: () =>
      api
        .get<PaginatedResponse<DescarteSession>>('/descartes', {
          params: {
            desde: params.desde ?? undefined,
            hasta: params.hasta ?? undefined,
            area_id: params.areaId ?? undefined,
            page: params.page ?? 1,
            per_page: params.perPage ?? 20,
          },
        })
        .then((r) => r.data),
    staleTime: 30_000,
  })
}
```

- [ ] **Paso 2: Verificar compilación TS**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "descartes" | head -10
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/pages/descartes/use-descartes-historial.ts
git commit -m "feat(descartes): hook useDescartesHistorial para sesiones paginadas"
```

---

## Task 6: Frontend — descarte-pdf.ts

**Files:**
- Create: `frontend/src/lib/descarte-pdf.ts`

Sigue el mismo patrón de `frontend/src/lib/solicitud-pdf.ts`.

- [ ] **Paso 1: Crear el archivo**

```typescript
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDate, formatCantidad } from '@/lib/utils'
import type { DescarteSession, DescarteSessionItem } from '@/types'

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number }
}

const C = {
  primary: [15, 23, 42] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  textMain: [30, 41, 59] as [number, number, number],
  textLight: [100, 116, 139] as [number, number, number],
  error: [220, 38, 38] as [number, number, number],
  bgLight: [248, 250, 252] as [number, number, number],
}

function motivoLabel(tipo: DescarteSessionItem['tipo']): string {
  return tipo === 'DESCARTE_VENCIDO' ? 'Vencido' : 'Dañado/Otro'
}

export function exportarDescartePDF(
  session: DescarteSession,
  nombreLaboratorio = 'Laboratorio Clínico'
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' }) as JsPdfWithAutoTable
  const W = doc.internal.pageSize.getWidth()

  // Cabecera
  doc.setFillColor(...C.error)
  doc.rect(0, 0, W, 35, 'F')
  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('ACTA DE DESCARTE', 15, 17)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(nombreLaboratorio.toUpperCase(), 15, 25)

  // Número de sesión (últimos 8 chars del UUID)
  const shortId = session.grupo_movimiento.slice(-8).toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`#${shortId}`, W - 20, 20, { align: 'right' })

  // Info general
  let y = 45
  doc.setTextColor(...C.textMain)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')

  const infoRows: [string, string][] = [
    ['Fecha:', formatDate(session.fecha)],
    ['Responsable:', session.usuario_nombre],
    ['Área(s):', session.areas.join(', ')],
    ['Total ítems:', String(session.total_items)],
  ]

  for (const [label, value] of infoRows) {
    doc.setFont('helvetica', 'bold')
    doc.text(label, 15, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 45, y)
    y += 6
  }

  y += 4

  // Tabla de ítems
  autoTable(doc, {
    startY: y,
    head: [['#', 'Producto', 'Lote', 'Área', 'Motivo', 'Cantidad', 'Venc.', 'Nota']],
    body: session.items.map((item, i) => [
      String(i + 1),
      item.producto_nombre,
      item.codigo_lote,
      item.area_nombre,
      motivoLabel(item.tipo),
      formatCantidad(Number(item.cantidad), item.unidad_base_nombre, item.unidad_base_nombre_plural),
      formatDate(item.fecha_vencimiento),
      item.nota ?? '',
    ]),
    headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: C.textMain },
    alternateRowStyles: { fillColor: C.bgLight },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 40 },
      2: { cellWidth: 20 },
      3: { cellWidth: 22 },
      4: { cellWidth: 18 },
      5: { cellWidth: 20 },
      6: { cellWidth: 18 },
      7: { cellWidth: 'auto' },
    },
    margin: { left: 15, right: 15 },
  })

  // Firma
  const finalY = doc.lastAutoTable.finalY + 15
  doc.setFontSize(9)
  doc.setTextColor(...C.textLight)
  doc.text('Firma responsable: ___________________________', 15, finalY)
  doc.text(`Generado: ${new Date().toLocaleString('es-CL')}`, W - 15, finalY, { align: 'right' })

  doc.save(`descarte-${session.fecha.slice(0, 10)}-${shortId}.pdf`)
}

export function exportarDescartesRangoPDF(
  sessions: DescarteSession[],
  desde: string | null,
  hasta: string | null,
  nombreLaboratorio = 'Laboratorio Clínico'
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' }) as JsPdfWithAutoTable
  const W = doc.internal.pageSize.getWidth()

  // Cabecera
  doc.setFillColor(...C.error)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('HISTORIAL DE DESCARTES', 15, 14)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(nombreLaboratorio.toUpperCase(), 15, 22)

  const rango =
    desde || hasta
      ? `Período: ${desde ? formatDate(desde) : '—'} → ${hasta ? formatDate(hasta) : '—'}`
      : 'Período: Todos los registros'
  doc.text(rango, W - 15, 22, { align: 'right' })

  const allRows: (string | number)[][] = []
  for (const session of sessions) {
    for (const item of session.items) {
      allRows.push([
        formatDate(session.fecha),
        session.usuario_nombre,
        item.producto_nombre,
        item.codigo_lote,
        item.area_nombre,
        motivoLabel(item.tipo),
        formatCantidad(Number(item.cantidad), item.unidad_base_nombre, item.unidad_base_nombre_plural),
        formatDate(item.fecha_vencimiento),
        item.nota ?? '',
      ])
    }
  }

  autoTable(doc, {
    startY: 36,
    head: [['Fecha', 'Responsable', 'Producto', 'Lote', 'Área', 'Motivo', 'Cantidad', 'Venc.', 'Nota']],
    body: allRows,
    headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, textColor: C.textMain },
    alternateRowStyles: { fillColor: C.bgLight },
    margin: { left: 15, right: 15 },
  })

  const finalY = doc.lastAutoTable.finalY + 10
  doc.setFontSize(8)
  doc.setTextColor(...C.textLight)
  doc.text(`Total operaciones: ${sessions.length} · Total ítems: ${allRows.length}`, 15, finalY)
  doc.text(`Generado: ${new Date().toLocaleString('es-CL')}`, W - 15, finalY, { align: 'right' })

  const suffix = desde ? desde.slice(0, 7) : 'todos'
  doc.save(`descartes-${suffix}.pdf`)
}
```

- [ ] **Paso 2: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "descarte-pdf" | head -10
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/lib/descarte-pdf.ts
git commit -m "feat(descartes): generador PDF de acta de descarte y rango"
```

---

## Task 7: Frontend — nuevo-descarte-tab.tsx

**Files:**
- Create: `frontend/src/pages/descartes/nuevo-descarte-tab.tsx`

- [ ] **Paso 1: Crear el archivo**

```typescript
import { useState, useMemo, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import {
  Trash2, Search, Calendar, PackageX, AlertTriangle,
  ShieldCheck, CheckCircle2, Download,
} from 'lucide-react'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { Area, Proveedor, DescarteVencidoItem, DescarteSession } from '@/types'
import type { DescarteRequest } from '@/types/generated'
import { toast } from 'sonner'
import { cn, formatCantidad, daysUntil, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useDescartesStock } from './use-descartes-stock'
import { exportarDescartePDF } from '@/lib/descarte-pdf'

interface DescarteItemLocal extends DescarteVencidoItem {
  cantidad_descartar: number
  motivo: 'vencido' | 'dañado' | 'contaminado' | 'otro'
}

interface NuevoDescarteTabProps {
  onDescarteCreado: () => void
}

export function NuevoDescarteTab({ onDescarteCreado }: NuevoDescarteTabProps) {
  const [search, setSearch] = useState('')
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false)
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchItemRefs = useRef<(HTMLDivElement | null)[]>([])

  const [filterAreaId, setFilterAreaId] = useState<number | null>(null)
  const [filterProveedorId, setFilterProveedorId] = useState<number | null>(null)
  const [filterIncluirProximos, setFilterIncluirProximos] = useState(false)
  const [items, setItems] = useState<Record<string, DescarteItemLocal>>({})
  const [showHealthyWarning, setShowHealthyWarning] = useState(false)
  const [healthyJustification, setHealthyJustification] = useState('')
  const [successSession, setSuccessSession] = useState<DescarteSession | null>(null)

  const queryClient = useQueryClient()

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  const { data: config } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Record<string, string>>('/configuracion').then((r) => r.data),
  })

  const { data: stock = [], isLoading } = useDescartesStock({
    diasAlerta: filterIncluirProximos ? 30 : 0,
    areaId: filterAreaId,
    proveedorId: filterProveedorId,
  })

  const filteredStock = useMemo(() => {
    if (!search) return stock
    const q = search.toLowerCase()
    return stock.filter(
      (s) =>
        s.producto_nombre.toLowerCase().includes(q) ||
        s.codigo_lote.toLowerCase().includes(q)
    )
  }, [stock, search])

  const selectedItems = Object.values(items)
  const totalSelected = selectedItems.length
  const healthyItems = selectedItems.filter((item) => {
    const days = daysUntil(item.fecha_vencimiento)
    return item.motivo !== 'vencido' && (days === null || days > 30)
  })
  const hasHealthyItems = healthyItems.length > 0

  const descarteMutation = useMutation({
    mutationFn: (data: DescarteRequest) =>
      api
        .post('/descartes', data, { headers: { 'X-Idempotency-Key': uuidv4() } })
        .then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['descartes-stock'] })
      queryClient.invalidateQueries({ queryKey: ['descartes-historial'] })
      // Build a minimal DescarteSession for the success card
      const session: DescarteSession = {
        grupo_movimiento: data.grupo_movimiento,
        fecha: new Date().toISOString(),
        usuario_nombre: '',
        total_items: selectedItems.length,
        areas: [...new Set(selectedItems.map((i) => i.area_nombre))],
        items: selectedItems.map((i) => ({
          producto_nombre: i.producto_nombre,
          codigo_lote: i.codigo_lote,
          area_nombre: i.area_nombre,
          tipo: i.motivo === 'vencido' ? 'DESCARTE_VENCIDO' : 'DESCARTE_DAÑADO',
          cantidad: i.cantidad_descartar,
          unidad_base_nombre: i.unidad_base_nombre,
          unidad_base_nombre_plural: i.unidad_base_nombre_plural,
          fecha_vencimiento: i.fecha_vencimiento,
          nota: null,
        })),
      }
      setSuccessSession(session)
      setItems({})
      onDescarteCreado()
    },
    onError: (err: unknown) => toast.error(parseApiError(err)),
  })

  const toggleItem = (loteId: string) => {
    setItems((prev) => {
      if (prev[loteId]) {
        const rest = { ...prev }
        delete rest[loteId]
        return rest
      }
      const stockItem = stock.find((s) => s.lote_id === loteId)
      if (!stockItem) return prev
      const days = daysUntil(stockItem.fecha_vencimiento)
      const isExpired = days !== null && days < 0
      return {
        ...prev,
        [loteId]: {
          ...stockItem,
          cantidad_descartar: stockItem.cantidad,
          motivo: isExpired ? 'vencido' : 'dañado',
        },
      }
    })
  }

  const updateItem = (
    loteId: string,
    field: 'cantidad_descartar' | 'motivo',
    value: number | string
  ) => {
    setItems((prev) => ({ ...prev, [loteId]: { ...prev[loteId], [field]: value } }))
  }

  const executeDescarte = (justificacion?: string) => {
    if (totalSelected === 0) return
    const payload: DescarteRequest = {
      items: selectedItems.map((i) => ({
        lote_id: i.lote_id,
        area_id: i.area_id,
        cantidad: String(i.cantidad_descartar),
        tipo: i.motivo === 'vencido' ? 'DESCARTE_VENCIDO' : 'DESCARTE_DAÑADO',
        nota:
          justificacion &&
          i.motivo !== 'vencido' &&
          (daysUntil(i.fecha_vencimiento) ?? 999) > 30
            ? justificacion
            : null,
      })),
    }
    descarteMutation.mutate(payload)
    setShowHealthyWarning(false)
    setHealthyJustification('')
  }

  const handleConfirm = () => {
    if (hasHealthyItems) {
      setShowHealthyWarning(true)
    } else {
      executeDescarte()
    }
  }

  // Keyboard nav del buscador
  useEffect(() => { setSearchActiveIndex(-1) }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node))
        setSearchDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (searchActiveIndex >= 0)
      searchItemRefs.current[searchActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [searchActiveIndex])

  const searchSuggestions = search.length >= 1 ? filteredStock.slice(0, 8) : []
  const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!searchDropdownOpen) setSearchDropdownOpen(true)
      setSearchActiveIndex((i) => (i < searchSuggestions.length - 1 ? i + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSearchActiveIndex((i) => (i > 0 ? i - 1 : searchSuggestions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchActiveIndex >= 0 && searchSuggestions[searchActiveIndex]) {
        setSearch(searchSuggestions[searchActiveIndex].producto_nombre)
        setSearchDropdownOpen(false)
        setSearchActiveIndex(-1)
      }
    } else if (e.key === 'Escape') {
      setSearchDropdownOpen(false)
      setSearch('')
    }
  }

  // Estado de éxito
  if (successSession) {
    return (
      <div className="flex items-center justify-center flex-1 py-12">
        <div className="bg-base-100 border border-success/30 rounded-3xl shadow-xl w-full max-w-md p-8 flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-success" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Descarte registrado</h2>
            <p className="text-sm opacity-50 mt-1">
              {successSession.total_items} {successSession.total_items === 1 ? 'ítem' : 'ítems'} descartados
              · {successSession.areas.join(', ')}
            </p>
            <p className="text-xs opacity-40 mt-0.5">{formatDate(successSession.fecha)}</p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Button
              className="gap-2 w-full"
              onClick={() =>
                exportarDescartePDF(
                  successSession,
                  config?.nombre_laboratorio ?? 'Laboratorio Clínico'
                )
              }
            >
              <Download className="w-4 h-4" />
              Descargar Acta PDF
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setSuccessSession(null)}>
              Nuevo descarte
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
      {/* Lista izquierda */}
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Buscador */}
          <div ref={searchContainerRef} className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 pointer-events-none z-10" />
            <Input
              placeholder="Buscar por insumo o lote..."
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchDropdownOpen(true) }}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => { if (search.length >= 1) setSearchDropdownOpen(true) }}
              aria-autocomplete="list"
              aria-expanded={showSearchDropdown}
            />
            {showSearchDropdown && (
              <div
                className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-64"
                role="listbox"
              >
                {searchSuggestions.map((item, i) => (
                  <div
                    key={item.lote_id}
                    ref={(el) => { searchItemRefs.current[i] = el }}
                    role="option"
                    aria-selected={i === searchActiveIndex}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 cursor-pointer text-sm',
                      i === searchActiveIndex ? 'bg-primary/10 text-primary' : 'hover:bg-base-200/60'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setSearch(item.producto_nombre)
                      setSearchDropdownOpen(false)
                      setSearchActiveIndex(-1)
                    }}
                  >
                    <span className="font-medium truncate">{item.producto_nombre}</span>
                    <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">{item.codigo_lote}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Área */}
          <select
            className="select select-bordered select-sm w-auto"
            value={filterAreaId ?? ''}
            onChange={(e) => setFilterAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las áreas</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>

          {/* Proveedor */}
          <select
            className="select select-bordered select-sm w-auto"
            value={filterProveedorId ?? ''}
            onChange={(e) => setFilterProveedorId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos los proveedores</option>
            {proveedores?.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>

          {/* Toggle proximos */}
          <button
            className={cn(
              'btn btn-sm gap-1.5',
              filterIncluirProximos ? 'btn-warning' : 'btn-outline'
            )}
            onClick={() => setFilterIncluirProximos((v) => !v)}
          >
            <Calendar className="w-3.5 h-3.5" />
            &lt;30d
          </button>
        </div>

        {/* Tabla */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-base-200 bg-base-100">
          <table className="table w-full">
            <thead className="sticky top-0 bg-base-100 z-10">
              <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
                <th className="w-8"></th>
                <th>Insumo / Lote</th>
                <th>Área</th>
                <th>Vencimiento</th>
                <th className="text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td colSpan={5}>
                      <div className="h-10 bg-base-200 animate-pulse rounded-lg" />
                    </td>
                  </tr>
                ))
              ) : filteredStock.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center opacity-40 italic text-sm">
                    {stock.length === 0
                      ? 'No hay ítems vencidos en este momento'
                      : 'No se encontraron ítems con ese filtro'}
                  </td>
                </tr>
              ) : (
                filteredStock.map((s) => {
                  const days = daysUntil(s.fecha_vencimiento)
                  const isExpired = days !== null && days < 0
                  const isExpiring = days !== null && days >= 0 && days <= 30
                  const isSano = days === null || days > 30
                  const isSelected = !!items[s.lote_id]
                  const item = items[s.lote_id]

                  return (
                    <>
                      <tr
                        key={s.lote_id}
                        className={cn(
                          'hover:bg-base-200/30 cursor-pointer transition-colors',
                          isSelected && 'bg-primary/5 hover:bg-primary/10'
                        )}
                        onClick={() => toggleItem(s.lote_id)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm checkbox-error"
                            checked={isSelected}
                            readOnly
                          />
                        </td>
                        <td>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-sm">{s.producto_nombre}</span>
                              {isSano && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                                  <ShieldCheck className="w-2.5 h-2.5" /> sano
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono opacity-50">
                              LOTE: {s.codigo_lote}
                            </span>
                          </div>
                        </td>
                        <td className="text-sm opacity-70">{s.area_nombre}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'text-xs font-medium',
                                isExpired ? 'text-error' : isExpiring ? 'text-warning' : ''
                              )}
                            >
                              {formatDate(s.fecha_vencimiento)}
                            </span>
                            {isExpired && (
                              <Badge variant="destructive" className="h-4 text-[8px] px-1">
                                VENCIDO
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="text-right">
                          <span className="font-mono font-bold text-sm">
                            {formatCantidad(s.cantidad, s.unidad_base_nombre, s.unidad_base_nombre_plural)}
                          </span>
                        </td>
                      </tr>
                      {isSelected && item && (
                        <tr
                          key={`${s.lote_id}-edit`}
                          className="bg-primary/5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <td />
                          <td colSpan={4}>
                            <div className="flex items-center gap-4 py-1">
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] font-bold opacity-50 uppercase tracking-wider">
                                  Cantidad
                                </label>
                                <input
                                  type="number"
                                  className="input input-bordered input-xs w-24 font-mono font-bold"
                                  value={item.cantidad_descartar}
                                  min={0.01}
                                  max={item.cantidad}
                                  step="any"
                                  onChange={(e) =>
                                    updateItem(s.lote_id, 'cantidad_descartar', Number(e.target.value))
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-[10px] font-bold opacity-50 uppercase tracking-wider">
                                  Motivo
                                </label>
                                <select
                                  className="select select-bordered select-xs text-[11px]"
                                  value={item.motivo}
                                  onChange={(e) =>
                                    updateItem(s.lote_id, 'motivo', e.target.value)
                                  }
                                >
                                  <option value="vencido">Vencido</option>
                                  <option value="dañado">Dañado</option>
                                  <option value="contaminado">Contaminado</option>
                                  <option value="otro">Otro</option>
                                </select>
                              </div>
                              <button
                                className="ml-auto text-error opacity-50 hover:opacity-100"
                                onClick={() => toggleItem(s.lote_id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Carrito derecho */}
      <div
        className={cn(
          'w-full lg:w-80 flex flex-col bg-base-100 border border-base-200 rounded-2xl shadow-lg transition-all',
          totalSelected === 0 && 'opacity-40 grayscale'
        )}
      >
        <div className="p-5 border-b border-base-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-error" />
            <h2 className="font-bold text-sm">Ítems a descartar</h2>
          </div>
          <Badge variant="outline">{totalSelected}</Badge>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {totalSelected === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 gap-2 py-12">
              <PackageX className="w-10 h-10" />
              <p className="text-xs">Seleccioná ítems de la lista</p>
            </div>
          ) : (
            selectedItems.map((item) => {
              const days = daysUntil(item.fecha_vencimiento)
              const isSano = days === null || days > 30
              return (
                <div
                  key={item.lote_id}
                  className="p-3 bg-base-200/40 rounded-xl border border-base-300 text-xs space-y-1"
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-bold line-clamp-1">{item.producto_nombre}</span>
                    {isSano && (
                      <ShieldCheck className="w-3 h-3 text-warning shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 opacity-50">
                    <span className="font-mono">{item.codigo_lote}</span>
                    <span>·</span>
                    <span>{item.area_nombre}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-60">
                    <span className="font-mono font-bold">
                      {formatCantidad(item.cantidad_descartar, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{item.motivo}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="p-4 border-t border-base-200">
          <Button
            className="w-full h-10 rounded-xl gap-2"
            variant="destructive"
            disabled={totalSelected === 0 || descarteMutation.isPending}
            onClick={handleConfirm}
          >
            {descarteMutation.isPending ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Confirmar Descarte
          </Button>
          <p className="text-[9px] text-center mt-2 opacity-30 leading-tight">
            Genera movimientos de salida tipo DESCARTE en el historial
          </p>
        </div>
      </div>

      {/* Modal advertencia sanos */}
      {showHealthyWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-base-100 rounded-3xl shadow-2xl border border-warning/30 w-full max-w-md mx-4">
            <div className="bg-warning/10 px-6 py-5 flex items-center gap-3 border-b border-warning/20 rounded-t-3xl">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
              <div>
                <h3 className="font-bold">¿Descartar insumos en buen estado?</h3>
                <p className="text-xs opacity-60 mt-0.5">
                  {healthyItems.length}{' '}
                  {healthyItems.length === 1 ? 'ítem sano requiere' : 'ítems sanos requieren'}{' '}
                  justificación
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                {healthyItems.map((item) => (
                  <li
                    key={item.lote_id}
                    className="flex items-center justify-between text-xs bg-base-200/50 rounded-xl px-3 py-2"
                  >
                    <span className="font-bold truncate">{item.producto_nombre}</span>
                    <span className="font-mono opacity-50 ml-2 shrink-0">
                      {formatCantidad(item.cantidad_descartar, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest opacity-50">
                  Justificación obligatoria
                </label>
                <textarea
                  className="textarea textarea-bordered w-full rounded-2xl resize-none text-sm h-20"
                  placeholder="Explica por qué se descarta material en buen estado..."
                  value={healthyJustification}
                  onChange={(e) => setHealthyJustification(e.target.value)}
                />
                <p className="text-[10px] opacity-40 text-right">
                  {healthyJustification.length}/10 min
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => { setShowHealthyWarning(false); setHealthyJustification('') }}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-warning flex-1 gap-2"
                  disabled={healthyJustification.trim().length < 10 || descarteMutation.isPending}
                  onClick={() => executeDescarte(healthyJustification.trim())}
                >
                  {descarteMutation.isPending && <span className="loading loading-spinner loading-sm" />}
                  Confirmar de todas formas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Paso 2: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "nuevo-descarte" | head -10
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/pages/descartes/nuevo-descarte-tab.tsx
git commit -m "feat(descartes): NuevoDescarteTab con stock vencido cross-area, inline edit, success card"
```

---

## Task 8: Frontend — historial-tab.tsx

**Files:**
- Create: `frontend/src/pages/descartes/historial-tab.tsx`

- [ ] **Paso 1: Crear el archivo**

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, Download, FileDown, Calendar,
} from 'lucide-react'
import api from '@/lib/api'
import type { Area, DescarteSession } from '@/types'
import { cn, formatCantidad, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDescartesHistorial } from './use-descartes-historial'
import { exportarDescartePDF, exportarDescartesRangoPDF } from '@/lib/descarte-pdf'

export function HistorialTab() {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [filterAreaId, setFilterAreaId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: config } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Record<string, string>>('/configuracion').then((r) => r.data),
  })

  const { data, isLoading } = useDescartesHistorial({
    desde: desde || null,
    hasta: hasta || null,
    areaId: filterAreaId,
    page,
    perPage: 20,
  })

  const nombreLab = config?.nombre_laboratorio ?? 'Laboratorio Clínico'

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExportarRango = () => {
    if (!data?.data?.length) return
    exportarDescartesRangoPDF(data.data, desde || null, hasta || null, nombreLab)
  }

  const sessions = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 20)

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 bg-base-100 p-4 rounded-2xl border border-base-200">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 opacity-40" />
          <input
            type="date"
            className="input input-bordered input-sm"
            value={desde}
            onChange={(e) => { setDesde(e.target.value); setPage(1) }}
            placeholder="Desde"
          />
          <span className="opacity-40 text-sm">→</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={hasta}
            onChange={(e) => { setHasta(e.target.value); setPage(1) }}
            placeholder="Hasta"
          />
        </div>

        <select
          className="select select-bordered select-sm"
          value={filterAreaId ?? ''}
          onChange={(e) => { setFilterAreaId(e.target.value ? Number(e.target.value) : null); setPage(1) }}
        >
          <option value="">Todas las áreas</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </select>

        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={sessions.length === 0}
            onClick={handleExportarRango}
          >
            <FileDown className="w-4 h-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* Lista de sesiones */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-base-200 animate-pulse rounded-2xl" />
          ))
        ) : sessions.length === 0 ? (
          <div className="py-20 text-center opacity-40 italic text-sm">
            No hay descartes registrados en este período
          </div>
        ) : (
          sessions.map((session: DescarteSession) => {
            const isOpen = expanded.has(session.grupo_movimiento)
            return (
              <div
                key={session.grupo_movimiento}
                className="bg-base-100 border border-base-200 rounded-2xl overflow-hidden"
              >
                {/* Cabecera de sesión */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-base-200/30 transition-colors"
                  onClick={() => toggleExpand(session.grupo_movimiento)}
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 opacity-40 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 opacity-40 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{formatDate(session.fecha)}</span>
                      <span className="text-xs opacity-50">
                        {new Date(session.fecha).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs opacity-50">·</span>
                      <span className="text-xs opacity-60">{session.usuario_nombre}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {session.areas.map((area) => (
                        <Badge key={area} variant="outline" className="text-[10px] h-4 px-1.5">
                          {area}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-bold opacity-50">
                      {session.total_items} {session.total_items === 1 ? 'ítem' : 'ítems'}
                    </span>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      title="Descargar PDF de esta sesión"
                      onClick={(e) => {
                        e.stopPropagation()
                        exportarDescartePDF(session, nombreLab)
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF
                    </button>
                  </div>
                </div>

                {/* Ítems expandidos */}
                {isOpen && (
                  <div className="border-t border-base-200">
                    <table className="table table-xs w-full">
                      <thead>
                        <tr className="bg-base-200/50 text-[10px] uppercase tracking-wider opacity-60">
                          <th>Producto</th>
                          <th>Lote</th>
                          <th>Área</th>
                          <th>Motivo</th>
                          <th className="text-right">Cantidad</th>
                          <th>Vencimiento</th>
                          <th>Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.items.map((item, i) => (
                          <tr key={i} className="hover:bg-base-200/20">
                            <td className="font-medium text-xs">{item.producto_nombre}</td>
                            <td className="font-mono text-[10px] opacity-60">{item.codigo_lote}</td>
                            <td className="text-xs opacity-70">{item.area_nombre}</td>
                            <td>
                              <Badge
                                variant={item.tipo === 'DESCARTE_VENCIDO' ? 'destructive' : 'outline'}
                                className="text-[9px] h-4 px-1"
                              >
                                {item.tipo === 'DESCARTE_VENCIDO' ? 'Vencido' : 'Dañado'}
                              </Badge>
                            </td>
                            <td className="text-right font-mono font-bold text-xs">
                              {formatCantidad(
                                Number(item.cantidad),
                                item.unidad_base_nombre,
                                item.unidad_base_nombre_plural
                              )}
                            </td>
                            <td className="text-xs opacity-60">{formatDate(item.fecha_vencimiento)}</td>
                            <td className="text-[10px] opacity-50 max-w-[120px] truncate">
                              {item.nota ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm opacity-60">
          <span>{total} sesiones en total</span>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost btn-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Paso 2: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "historial-tab" | head -10
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add frontend/src/pages/descartes/historial-tab.tsx
git commit -m "feat(descartes): HistorialTab con sesiones expandibles, filtros y export PDF"
```

---

## Task 9: Frontend — Reescribir index.tsx (shell de tabs)

**Files:**
- Modify: `frontend/src/pages/descartes/index.tsx`

- [ ] **Paso 1: Reemplazar el contenido completo de index.tsx**

```typescript
import { useState } from 'react'
import { PackageX, Plus, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NuevoDescarteTab } from './nuevo-descarte-tab'
import { HistorialTab } from './historial-tab'
import { useQueryClient } from '@tanstack/react-query'

type Tab = 'nuevo' | 'historial'

export default function DescartesPage() {
  const [tab, setTab] = useState<Tab>('nuevo')
  const queryClient = useQueryClient()

  const handleDescarteCreado = () => {
    queryClient.invalidateQueries({ queryKey: ['descartes-historial'] })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <PackageX className="w-5 h-5 text-error" />
            Gestión de Descartes
          </h1>
          <p className="text-xs opacity-40">Retiro de insumos vencidos o dañados</p>
        </div>

        <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl">
          <button
            className={cn(
              'tab gap-2 rounded-xl transition-all px-5 h-9',
              tab === 'nuevo'
                ? 'tab-active bg-error text-error-content font-bold shadow'
                : 'hover:bg-base-300'
            )}
            onClick={() => setTab('nuevo')}
          >
            <Plus className="w-4 h-4" />
            Nuevo Descarte
          </button>
          <button
            className={cn(
              'tab gap-2 rounded-xl transition-all px-5 h-9',
              tab === 'historial'
                ? 'tab-active bg-base-100 font-bold shadow'
                : 'hover:bg-base-300'
            )}
            onClick={() => setTab('historial')}
          >
            <History className="w-4 h-4" />
            Historial
          </button>
        </div>
      </div>

      {/* Contenido */}
      {tab === 'nuevo' ? (
        <NuevoDescarteTab onDescarteCreado={handleDescarteCreado} />
      ) : (
        <HistorialTab />
      )}
    </div>
  )
}
```

- [ ] **Paso 2: Verificar compilación TS completa**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Paso 3: Verificar en el navegador**

Con el backend y el frontend corriendo:
1. Ir a `http://localhost:5173/descartes`
2. Verificar que se ven los dos tabs "Nuevo Descarte" e "Historial"
3. En "Nuevo Descarte": verificar que la tabla carga los ítems vencidos de todas las áreas
4. Filtrar por área → la lista se actualiza
5. Seleccionar un ítem → la fila se expande con campos de cantidad y motivo
6. Confirmar descarte → aparece la tarjeta de éxito con botón "Descargar Acta PDF"
7. Ir al tab "Historial" → se ve la sesión recién creada
8. Expandir la sesión → se ven los ítems
9. Presionar PDF → se descarga el acta
10. Presionar "Exportar PDF" → se descarga el historial

- [ ] **Paso 4: Commit final**

```bash
git add frontend/src/pages/descartes/index.tsx
git commit -m "feat(descartes): reescribir index.tsx como shell de dos tabs (Nuevo/Historial)"
```

---

## Self-Review

**Cobertura del spec:**
- ✅ Tab "Nuevo Descarte" con lista cross-área → Task 7
- ✅ Filtros opcionales: área, proveedor, toggle próximos → Task 7
- ✅ Expand inline de cantidad y motivo → Task 7
- ✅ Panel carrito derecho → Task 7
- ✅ Tarjeta de éxito post-confirmación con PDF → Task 7
- ✅ Tab "Historial" con sesiones expandibles → Task 8
- ✅ Filtros por fecha y área → Task 8
- ✅ PDF por sesión → Tasks 6 + 8
- ✅ PDF rango de fechas → Tasks 6 + 8
- ✅ Backend GET /stock/lotes-vencidos → Task 1
- ✅ Backend GET /descartes → Task 2
- ✅ Tipos TypeScript → Task 3

**Consistencia de tipos:**
- `DescarteVencidoItem.lote_id` (string) → usado en `items` Record keyed by lote_id ✅
- `DescarteSession.items` es `DescarteSessionItem[]` → usado en historial-tab y descarte-pdf ✅
- `useDescartesHistorial` retorna `PaginatedResponse<DescarteSession>` → accedido como `data.data` ✅
- `exportarDescartePDF(session, nombreLab)` → llamado con DescarteSession en tasks 7 y 8 ✅
