# Mejoras Sistema V2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir 6 bugs y entregar mejoras de UX/funcionalidad en Dashboard, Consumos, Conteo, Recepciones, Solicitudes y Configuración.

**Architecture:** Fases ordenadas de menor a mayor riesgo: primero migraciones de DB y fix del bug de backend, luego fixes de frontend independientes, luego rediseños de UI complejos, y al final Recepciones (requiere nuevo backend). Cada tarea termina con commit.

**Tech Stack:** Rust + Axum + SQLx (backend), React 19 + TypeScript + Tailwind CSS v4 + DaisyUI + React Query (frontend), PostgreSQL 16, jsPDF + jspdf-autotable (PDF).

---

## Fase 1 — Migraciones y configuración backend

### Task 1: Migración — moneda y período de conteo en configuración

**Files:**
- Create: `backend/migrations/035_configuracion_moneda_conteo.sql`

- [ ] **Crear la migración**

```sql
-- backend/migrations/035_configuracion_moneda_conteo.sql
INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_codigo', 'CLP')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_simbolo', '$')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion (clave, valor_texto) VALUES ('conteo_periodo_dias', '30')
ON CONFLICT (clave) DO NOTHING;
```

- [ ] **Verificar que la migración aplica**

```bash
cd backend && cargo run --bin migration_check 2>&1 || docker compose up --build -d
# Verificar en logs que la migración 035 se aplica sin error
```

- [ ] **Commit**

```bash
git add backend/migrations/035_configuracion_moneda_conteo.sql
git commit -m "feat(db): add moneda and conteo_periodo_dias config keys"
```

---

### Task 2: Migración — tabla scanner_sessions para escáner QR

**Files:**
- Create: `backend/migrations/036_scanner_sessions.sql`

- [ ] **Crear la migración**

```sql
-- backend/migrations/036_scanner_sessions.sql
CREATE TABLE scanner_sessions (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id UUID REFERENCES recepciones(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE TABLE scanner_items (
    id BIGSERIAL PRIMARY KEY,
    session_token UUID NOT NULL REFERENCES scanner_sessions(token) ON DELETE CASCADE,
    codigo VARCHAR(200) NOT NULL,
    producto_id UUID REFERENCES productos(id),
    producto_nombre VARCHAR(500),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fetched BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_scanner_items_session ON scanner_items(session_token, fetched);
```

- [ ] **Commit**

```bash
git add backend/migrations/036_scanner_sessions.sql
git commit -m "feat(db): add scanner_sessions table for QR mobile scanning"
```

---

## Fase 2 — Bug: stock.rs filtros categoría y proveedor

### Task 3: Fix filtros categoria_id y proveedor_id en stock.rs

**Files:**
- Modify: `backend/src/handlers/stock.rs:76-90`

**Diagnóstico del bug:** Los binds se pasan como `String` al query dinámico, pero `p.categoria_id` y `p.proveedor_id` son `INTEGER` en PostgreSQL. El prepared statement falla la resolución de tipos sin cast explícito.

- [ ] **Aplicar el fix en los filtros**

En `backend/src/handlers/stock.rs`, reemplazar las líneas 76–90:

```rust
// ANTES (líneas 76-90):
let cat_filter = if let Some(cat_id) = params.categoria_id {
    param_idx += 1;
    binds.push(cat_id.to_string());
    format!("AND p.categoria_id = ${}", param_idx)
} else {
    "".to_string()
};

let prov_filter = if let Some(prov_id) = params.proveedor_id {
    param_idx += 1;
    binds.push(prov_id.to_string());
    format!("AND p.proveedor_id = ${}", param_idx)
} else {
    "".to_string()
};
```

```rust
// DESPUÉS — mismo lugar, mismo bloque:
let cat_filter = if let Some(cat_id) = params.categoria_id {
    param_idx += 1;
    binds.push(cat_id.to_string());
    format!("AND p.categoria_id = ${}::integer", param_idx)
} else {
    "".to_string()
};

let prov_filter = if let Some(prov_id) = params.proveedor_id {
    param_idx += 1;
    binds.push(prov_id.to_string());
    format!("AND p.proveedor_id = ${}::integer", param_idx)
} else {
    "".to_string()
};
```

También aplicar el mismo fix para `area_filter` (líneas 60-66):

```rust
// ANTES:
format!("AND s.area_id = ${}", param_idx)

// DESPUÉS:
format!("AND s.area_id = ${}::integer", param_idx)
```

- [ ] **Compilar y verificar**

```bash
cd backend && cargo build 2>&1
# Debe compilar sin errores
```

- [ ] **Probar manualmente:** Navegar a `/stock`, seleccionar una categoría del filtro — la lista debe actualizarse.

- [ ] **Commit**

```bash
git add backend/src/handlers/stock.rs
git commit -m "fix(stock): cast integer binds to ::integer for category and provider filters"
```

---

## Fase 3 — Backend: configuración ampliada

### Task 4: Actualizar handler de configuración — moneda y período de conteo

**Files:**
- Modify: `backend/src/handlers/configuracion.rs`

- [ ] **Ampliar `ConfiguracionResponse` y `UpdateConfiguracion`**

En `backend/src/handlers/configuracion.rs`, reemplazar las structs:

```rust
#[derive(Debug, Serialize)]
struct ConfiguracionResponse {
    nombre_laboratorio: String,
    logo_base64: String,
    pin_kiosko: String,
    conteo_ciego: bool,
    dias_autonomia_objetivo: i32,
    lead_time_default: i32,
    moneda_codigo: String,
    moneda_simbolo: String,
    conteo_periodo_dias: i32,
}

#[derive(Debug, Deserialize)]
struct UpdateConfiguracion {
    nombre_laboratorio: Option<String>,
    logo_base64: Option<String>,
    pin_kiosko: Option<String>,
    conteo_ciego: Option<bool>,
    dias_autonomia_objetivo: Option<i32>,
    lead_time_default: Option<i32>,
    moneda_codigo: Option<String>,
    moneda_simbolo: Option<String>,
    conteo_periodo_dias: Option<i32>,
}
```

- [ ] **Actualizar `obtener` para leer los nuevos campos**

En la función `obtener`, reemplazar la query y el bucle de parsing completo:

```rust
async fn obtener(
    State(state): State<AppState>,
) -> Result<Json<ConfiguracionResponse>, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN (
            'nombre_laboratorio','logo_base64','pin_kiosko','conteo_ciego',
            'dias_autonomia_objetivo','lead_time_default',
            'moneda_codigo','moneda_simbolo','conteo_periodo_dias'
        )",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut logo_base64 = String::new();
    let mut pin_kiosko = String::new();
    let mut conteo_ciego = false;
    let mut dias_autonomia_objetivo = 15;
    let mut lead_time_default = 3;
    let mut moneda_codigo = "CLP".to_string();
    let mut moneda_simbolo = "$".to_string();
    let mut conteo_periodo_dias = 30;

    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => nombre_laboratorio = valor,
            "logo_base64" => logo_base64 = valor,
            "pin_kiosko" => pin_kiosko = valor,
            "conteo_ciego" => conteo_ciego = valor == "true",
            "dias_autonomia_objetivo" => dias_autonomia_objetivo = valor.parse().unwrap_or(15),
            "lead_time_default" => lead_time_default = valor.parse().unwrap_or(3),
            "moneda_codigo" => moneda_codigo = valor,
            "moneda_simbolo" => moneda_simbolo = valor,
            "conteo_periodo_dias" => conteo_periodo_dias = valor.parse().unwrap_or(30),
            _ => {}
        }
    }

    Ok(Json(ConfiguracionResponse {
        nombre_laboratorio,
        logo_base64,
        pin_kiosko,
        conteo_ciego,
        dias_autonomia_objetivo,
        lead_time_default,
        moneda_codigo,
        moneda_simbolo,
        conteo_periodo_dias,
    }))
}
```

- [ ] **Actualizar `actualizar` para guardar los nuevos campos** — agregar estos bloques al final del if-chain existente, antes de los `log_changes`:

```rust
    if let Some(codigo) = &body.moneda_codigo {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_codigo', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(codigo)
        .execute(&state.pool)
        .await?;
    }

    if let Some(simbolo) = &body.moneda_simbolo {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_simbolo', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(simbolo)
        .execute(&state.pool)
        .await?;
    }

    if let Some(periodo) = body.conteo_periodo_dias {
        let val = periodo.to_string();
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('conteo_periodo_dias', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
    }
```

- [ ] **Compilar**

```bash
cd backend && cargo build 2>&1
```

- [ ] **Regenerar tipos TypeScript**

```bash
cd backend && cargo run --bin export_types
```

- [ ] **Commit**

```bash
git add backend/src/handlers/configuracion.rs frontend/src/types/generated.ts
git commit -m "feat(config): add moneda_codigo, moneda_simbolo, conteo_periodo_dias fields"
```

---

## Fase 4 — Frontend: bugs rápidos

### Task 5: Dashboard — fix tipografía

**Files:**
- Modify: `frontend/src/pages/dashboard/index.tsx`

- [ ] **Reemplazar clases tipográficas en `DashboardPage`** — encabezado principal:

```tsx
// ANTES (línea ~131-137):
<h1 className="text-3xl font-black tracking-tight text-base-content flex items-center gap-3">
<p className="text-sm opacity-50 mt-1 font-medium">

// DESPUÉS:
<h1 className="text-2xl font-bold tracking-tight text-base-content flex items-center gap-3">
<p className="text-sm text-base-content/50 mt-1">
```

- [ ] **Reemplazar en `StatCard`** — valor numérico y label:

```tsx
// ANTES:
<p className={cn("text-3xl font-black tabular-nums tracking-tighter", alert && "text-error")}>{value}</p>
<p className="text-[11px] font-black uppercase tracking-widest opacity-40">{label}</p>

// DESPUÉS:
<p className={cn("text-2xl font-bold tabular-nums", alert && "text-error")}>{value}</p>
<p className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</p>
```

- [ ] **Reemplazar en `AlertList`** — sección de alertas:

```tsx
// ANTES (línea ~199):
<h2 className="text-lg font-black flex items-center gap-2">

// DESPUÉS:
<h2 className="text-base font-bold flex items-center gap-2">
```

- [ ] **Reemplazar en panel "Recuperaciones Recientes"**:

```tsx
// ANTES:
<h2 className="text-sm font-black uppercase tracking-widest opacity-40 mb-4 ...">

// DESPUÉS:
<h2 className="text-xs font-semibold uppercase tracking-wide opacity-50 mb-4 ...">
```

- [ ] **Reemplazar textos de 9-10px en filas de alerta** (líneas ~462-505):
  - `text-[9px]` → `text-xs`
  - `text-[10px]` → `text-xs`
  - `text-[11px]` → `text-sm`
  - `font-black` → `font-bold` (donde ya no esté en un encabezado)

- [ ] **Verificar en el navegador** que el dashboard se ve más limpio y consistente.

- [ ] **Commit**

```bash
git add frontend/src/pages/dashboard/index.tsx
git commit -m "fix(dashboard): standardize typography to match rest of app"
```

---

### Task 6: Consumos — fix buscador (umbral 2 chars)

**Files:**
- Modify: `frontend/src/pages/consumos/index.tsx`

- [ ] **Cambiar threshold de 3 a 2 caracteres en la query**

```tsx
// ANTES (línea ~62):
enabled: productSearch.length > 2

// DESPUÉS:
enabled: productSearch.length >= 2
```

- [ ] **Cambiar la condición de mostrar resultados**:

```tsx
// ANTES (si existe similar):
...(searchQuery.length > 2 && { q: searchQuery }),

// DESPUÉS:
...(searchQuery.length >= 2 && { q: searchQuery }),
```

- [ ] **Commit**

```bash
git add frontend/src/pages/consumos/index.tsx
git commit -m "fix(consumos): lower search threshold from 3 to 2 characters"
```

---

### Task 7: Solicitudes — buscador historial funcional

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Agregar estado `historialSearch`** — junto a los otros estados (línea ~74):

```tsx
const [historialSearch, setHistorialSearch] = useState('')
```

- [ ] **Pasar `historialSearch` como query param al historial**:

```tsx
// ANTES (línea ~103-106):
const { data: historial, isLoading: isLoadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial'],
    queryFn: () => api.get<PaginatedResponse<SolicitudResumen>>('/solicitudes-compra').then(r => r.data),

// DESPUÉS:
const { data: historial, isLoading: isLoadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial', historialSearch],
    queryFn: () => api.get<PaginatedResponse<SolicitudResumen>>('/solicitudes-compra', {
        params: { q: historialSearch || undefined }
    }).then(r => r.data),
```

- [ ] **Conectar el Input al estado** (línea ~531):

```tsx
// ANTES:
<Input placeholder="Buscar por número de documento..." className="pl-10 h-10 rounded-xl" />

// DESPUÉS:
<Input
    placeholder="Buscar por número de documento..."
    className="pl-10 h-10 rounded-xl"
    value={historialSearch}
    onChange={(e) => setHistorialSearch(e.target.value)}
/>
```

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "fix(solicitudes): wire up historial search input to state and backend"
```

---

### Task 8: Solicitudes — leer ?select=PRODUCTO_ID y pre-agregar producto

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Agregar import de `useSearchParams`** (ya importado `useLocation`, agregar):

```tsx
import { useLocation, useSearchParams } from 'react-router-dom'
```

- [ ] **Agregar `useSearchParams` en el componente** junto a los otros hooks:

```tsx
const [searchParams] = useSearchParams()
```

- [ ] **Agregar `useEffect` para leer `?select=`** — después de la declaración de estados:

```tsx
useEffect(() => {
    const productoId = searchParams.get('select')
    if (!productoId || items.some(i => i.producto_id === productoId)) return
    
    api.get<Producto>(`/productos/${productoId}`)
    .then(res => {
        const p = res.data
        if (!p) return
        const newItem: SolicitudItem = {
            producto_id: p.id,
            producto_nombre: p.nombre,
            codigo_proveedor: p.codigo_proveedor,
            codigo_maestro: p.codigo_maestro,
            proveedor_id: p.proveedor_id,
            proveedor_nombre: 'Manual',
            lead_time: p.lead_time_propio || 0,
            presentacion_id: null,
            presentacion_nombre: null,
            presentacion_nombre_plural: null,
            factor_conversion: null,
            unidad_base: 'u',
            unidad_base_plural: 'u',
            cantidad: 1,
            precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
        }
        setItems(prev => [...prev, newItem])
        setView('crear')
    }).catch(() => {})
}, [searchParams])
```

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "fix(solicitudes): read ?select=ID from URL and pre-add product to draft"
```

---

### Task 9: Solicitudes — fix PDF (mapeo de tipos + logo + moneda)

**Files:**
- Modify: `frontend/src/lib/solicitud-pdf.ts`
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Agregar `logoBase64` y `monedaSimbolo` a `SolicitudPdfOptions`** en `solicitud-pdf.ts`:

```typescript
interface SolicitudPdfOptions {
  numero_documento: string
  fecha_creacion: string
  usuario_nombre: string
  nota?: string | null
  subtotal_neto: number
  iva: number
  total_con_iva: number
  nombreLaboratorio: string
  logoBase64?: string | null      // NUEVO
  monedaSimbolo?: string          // NUEVO (default '$')
  items: {
    producto_nombre: string
    cantidad_sugerida: number
    unidad: string
    codigo_maestro?: string | null
    codigo_proveedor?: string | null
    proveedor_nombre?: string | null
    presentacion_nombre?: string | null
    presentacion_nombre_plural?: string | null
    factor_conversion?: number | null
    precio_unitario?: number | null
    cantidad_presentaciones?: number | null
  }[]
}
```

- [ ] **Renderizar logo en el PDF** — en `exportarSolicitudPDF`, después de dibujar el header (línea ~55), agregar:

```typescript
// Si hay logo, dibujarlo en la esquina superior izquierda del header
if (options.logoBase64 && options.logoBase64.startsWith('data:image')) {
    try {
        doc.addImage(options.logoBase64, 'AUTO', 12, 5, 22, 22)
        // Mover el texto del nombre a la derecha del logo
    } catch (_) { /* ignorar si el logo falla */ }
}
```

- [ ] **Usar moneda configurable** — reemplazar los `$` hardcodeados en la tabla y totales:

```typescript
// Donde dice:
`$${Math.round(item.precio_unitario).toLocaleString('es-CL')}`
// Reemplazar por:
`${options.monedaSimbolo || '$'}${Math.round(item.precio_unitario).toLocaleString('es-CL')}`
```

Hacer lo mismo para los totales (`subtotal_neto`, `iva`, `total_con_iva`).

- [ ] **Corregir el mapeo en `solicitudes-compra/index.tsx`** — reemplazar la llamada a `exportarSolicitudPDF`:

Primero, obtener configuración. Agregar query de configuración en el componente:

```tsx
const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ nombre_laboratorio: string; logo_base64: string; moneda_simbolo: string }>('/configuracion').then(r => r.data),
    staleTime: 300_000,
})
```

Luego reemplazar la llamada al PDF (línea ~668):

```tsx
// ANTES:
<Button variant="outline" className="rounded-xl h-10 gap-2" onClick={() => exportarSolicitudPDF(detail)}>

// DESPUÉS:
<Button variant="outline" className="rounded-xl h-10 gap-2" onClick={() => {
    const subtotal = detail.items.reduce((acc, i) =>
        acc + parseFloat(i.cantidad_sugerida) * (i.precio_unitario ? parseFloat(i.precio_unitario) : 0), 0)
    const iva = subtotal * 0.19
    exportarSolicitudPDF({
        numero_documento: detail.numero_documento,
        fecha_creacion: detail.fecha_creacion,
        usuario_nombre: detail.usuario_nombre,
        nota: detail.nota,
        subtotal_neto: subtotal,
        iva,
        total_con_iva: subtotal + iva,
        nombreLaboratorio: configuracion?.nombre_laboratorio || 'Laboratorio Clínico',
        logoBase64: configuracion?.logo_base64 || null,
        monedaSimbolo: configuracion?.moneda_simbolo || '$',
        items: detail.items.map(i => ({
            producto_nombre: i.producto_nombre,
            cantidad_sugerida: parseFloat(i.cantidad_sugerida),
            unidad: i.unidad,
            codigo_maestro: i.codigo_maestro,
            codigo_proveedor: i.codigo_proveedor,
            proveedor_nombre: i.proveedor_nombre,
            presentacion_nombre: i.presentacion_nombre,
            precio_unitario: i.precio_unitario ? parseFloat(i.precio_unitario) : null,
        }))
    })
}}>
```

- [ ] **Commit**

```bash
git add frontend/src/lib/solicitud-pdf.ts frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "fix(solicitudes): fix PDF type mapping, add logo and configurable currency"
```

---

## Fase 5 — Configuración — nuevos campos en UI

### Task 10: Configuración — campos moneda y período de conteo

**Files:**
- Modify: `frontend/src/pages/configuracion/index.tsx`

- [ ] **Agregar estados para los nuevos campos** (después de `leadTime`):

```tsx
const [monedaCodigo, setMonedaCodigo] = useState('CLP')
const [monedaSimbolo, setMonedaSimbolo] = useState('$')
const [conteoPeriodoDias, setConteoPeriodoDias] = useState(30)
```

- [ ] **Inicializar los nuevos estados en el bloque `if (data && !initialized.current)`**:

```tsx
setMonedaCodigo(data.moneda_codigo || 'CLP')
setMonedaSimbolo(data.moneda_simbolo || '$')
setConteoPeriodoDias(data.conteo_periodo_dias || 30)
```

- [ ] **Actualizar la llamada a `mutation.mutate`** para incluir los nuevos campos:

```tsx
mutation.mutate({
    nombre_laboratorio: nombre,
    logo_base64: logo,
    pin_kiosko: pinKiosko,
    conteo_ciego: conteoCiego,
    dias_autonomia_objetivo: diasAutonomia,
    lead_time_default: leadTime,
    moneda_codigo: monedaCodigo,
    moneda_simbolo: monedaSimbolo,
    conteo_periodo_dias: conteoPeriodoDias,
})
```

- [ ] **Agregar sección en el formulario** — después de la sección de Pin Kiosko, agregar:

```tsx
{/* Moneda */}
<div className="card bg-base-100 shadow-sm border border-base-200 p-6">
    <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
        <span>💱</span> Moneda del Sistema
    </h3>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
            <label className="text-sm font-medium opacity-70 mb-1 block">Código ISO</label>
            <select
                className="select select-bordered w-full"
                value={monedaCodigo}
                onChange={(e) => setMonedaCodigo(e.target.value)}
            >
                <option value="CLP">CLP — Peso Chileno</option>
                <option value="USD">USD — Dólar Estadounidense</option>
                <option value="PEN">PEN — Sol Peruano</option>
                <option value="COP">COP — Peso Colombiano</option>
                <option value="MXN">MXN — Peso Mexicano</option>
                <option value="ARS">ARS — Peso Argentino</option>
            </select>
        </div>
        <div>
            <label className="text-sm font-medium opacity-70 mb-1 block">Símbolo</label>
            <input
                type="text"
                className="input input-bordered w-full"
                value={monedaSimbolo}
                onChange={(e) => setMonedaSimbolo(e.target.value)}
                placeholder="$"
                maxLength={5}
            />
            <p className="text-xs opacity-50 mt-1">Aparece en precios, solicitudes y PDF</p>
        </div>
    </div>
</div>

{/* Conteo */}
<div className="card bg-base-100 shadow-sm border border-base-200 p-6">
    <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
        <span>📋</span> Período de Conteo
    </h3>
    <div>
        <label className="text-sm font-medium opacity-70 mb-1 block">
            Días máximos entre conteos (global)
        </label>
        <input
            type="number"
            className="input input-bordered w-40"
            value={conteoPeriodoDias}
            onChange={(e) => setConteoPeriodoDias(parseInt(e.target.value) || 30)}
            min={1}
            max={365}
        />
        <p className="text-xs opacity-50 mt-1">
            Cada área puede tener su propio período. Este valor aplica si no tiene uno configurado.
        </p>
    </div>
</div>
```

- [ ] **Commit**

```bash
git add frontend/src/pages/configuracion/index.tsx
git commit -m "feat(config): add moneda and conteo_periodo_dias fields to settings UI"
```

---

## Fase 6 — Consumos — rediseño completo (Opción C)

### Task 11: Consumos — rediseño con vista dividida + selector de lote

**Files:**
- Modify: `frontend/src/pages/consumos/index.tsx`

- [ ] **Agregar tipos de lote e ítems de carrito extendidos** — reemplazar las interfaces al inicio del archivo:

```tsx
interface LoteDisponible {
  lote_id: string
  numero_lote: string
  stock: number
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
}

interface CartItem {
  producto_id: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_total: number
  area_id: number
  area_nombre: string
  imagen_url?: string | null
  codigo_interno: string
  categoria: string | null
  lotes: LoteDisponible[]
  lote_elegido_id: string | null  // null = FEFO automático
  cantidad_descontar: number
}
```

- [ ] **Agregar query de áreas y estado de área filtrada** — después de `const [isScannerOpen, setIsScannerOpen] = useState(false)`:

```tsx
const [areaFiltro, setAreaFiltro] = useState<number | null>(null)

const { data: areasData } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<{ id: number; nombre: string; activa: boolean }[]>('/areas').then(r => r.data),
    staleTime: 300_000,
})
const areas = areasData?.filter(a => a.activa) ?? []
```

- [ ] **Actualizar la query de stock** para incluir lotes:

```tsx
const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock-list', searchQuery, areaFiltro],
    queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
        params: {
            ...(searchQuery.length >= 2 && { q: searchQuery }),
            ...(areaFiltro && { area_id: areaFiltro }),
            per_page: 100,
            con_lotes: true,
        }
    }).then(r => r.data),
})
```

- [ ] **Actualizar `addToCart`** para manejar lotes:

```tsx
const addToCart = (p: StockItem) => {
    if ((p.stock_total || 0) <= 0) {
        toast.error('No hay stock disponible')
        return
    }
    const cartKey = p.producto_id
    setCart(prev => {
        if (prev[cartKey]) {
            return { ...prev, [cartKey]: { ...prev[cartKey], cantidad_descontar: prev[cartKey].cantidad_descontar + 1 } }
        }
        return {
            ...prev,
            [cartKey]: {
                producto_id: p.producto_id,
                nombre: p.producto_nombre,
                codigo_interno: p.codigo_interno,
                unidad: p.unidad,
                unidad_plural: p.unidad_plural || p.unidad,
                stock_total: p.stock_total || 0,
                area_id: p.area_id!,
                area_nombre: p.area_nombre || '',
                imagen_url: p.imagen_url,
                categoria: p.categoria || null,
                lotes: (p.lotes || []).map(l => ({
                    lote_id: l.lote_id,
                    numero_lote: l.numero_lote,
                    stock: l.stock,
                    fecha_vencimiento: l.fecha_vencimiento,
                    area_id: p.area_id!,
                    area_nombre: p.area_nombre || '',
                })),
                lote_elegido_id: null, // FEFO automático por defecto
                cantidad_descontar: 1,
            }
        }
    })
    toast.success(`${p.producto_nombre} añadido`)
}
```

- [ ] **Actualizar `handleConfirm`** para enviar lote cuando se elige manualmente:

```tsx
const handleConfirm = () => {
    const cartItems = Object.values(cart)
    if (cartItems.length === 0) return

    batchMutation.mutate({
        items: cartItems.map(i => ({
            producto_id: i.producto_id,
            cantidad: i.cantidad_descontar,
            unidad: 'base',
            area_id: i.area_id,
            ...(i.lote_elegido_id && { lote_id: i.lote_elegido_id }),
        })),
        nota: notas || undefined,
    })
}
```

- [ ] **Reemplazar el JSX completo del return** con el layout dividido:

```tsx
return (
    <div className="flex h-[calc(100vh-120px)] gap-4 p-1 overflow-hidden">
        {/* COLUMNA IZQUIERDA — búsqueda + lista */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-hidden">
            {/* Buscador + filtro área */}
            <div className="flex gap-2 items-center bg-base-100 p-3 rounded-2xl border border-base-200 shadow-sm">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
                    <input
                        className="input input-bordered w-full pl-9 h-10 rounded-xl text-sm"
                        placeholder="Buscar producto (mín. 2 letras)..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
                <select
                    className="select select-bordered h-10 rounded-xl text-sm min-w-[140px]"
                    value={areaFiltro ?? ''}
                    onChange={e => setAreaFiltro(e.target.value ? Number(e.target.value) : null)}
                >
                    <option value="">Todas las áreas</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                <button
                    className="btn btn-outline btn-sm h-10 rounded-xl gap-1"
                    onClick={() => setIsScannerOpen(true)}
                >
                    <Camera className="h-4 w-4" /> QR
                </button>
            </div>

            {/* Hint si búsqueda corta */}
            {searchQuery.length === 1 && (
                <p className="text-xs text-base-content/40 px-2">Escribe al menos 2 letras para buscar</p>
            )}

            {/* Lista de productos */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {isLoading ? (
                    Array(6).fill(0).map((_, i) => <div key={i} className="h-20 bg-base-200 rounded-2xl animate-pulse" />)
                ) : (stockResponse?.data ?? []).length === 0 ? (
                    <div className="py-16 text-center opacity-30">
                        <Package className="h-10 w-10 mx-auto mb-2" />
                        <p className="text-sm">{searchQuery.length >= 2 ? 'Sin resultados' : 'Busca o desplázate para ver productos'}</p>
                    </div>
                ) : (
                    (stockResponse?.data ?? []).map(p => {
                        const enCarrito = !!cart[p.producto_id]
                        const sinStock = (p.stock_total || 0) <= 0
                        return (
                            <div
                                key={p.producto_id}
                                className={cn(
                                    "flex items-center gap-3 p-3 rounded-2xl border transition-all",
                                    enCarrito ? "bg-primary/5 border-primary/30" : "bg-base-100 border-base-200 hover:border-primary/30",
                                    sinStock && "opacity-40"
                                )}
                            >
                                <ProductoImage url={p.imagen_url} nombre={p.producto_nombre} className="w-10 h-10 rounded-xl flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-sm truncate">{p.producto_nombre}</p>
                                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                        {p.area_nombre && <span className="badge badge-xs bg-blue-100 text-blue-700 border-none">{p.area_nombre}</span>}
                                        {p.categoria && <span className="badge badge-xs bg-green-100 text-green-700 border-none">{p.categoria}</span>}
                                        <span className="text-xs text-base-content/50">{p.stock_total || 0} {p.unidad}</span>
                                    </div>
                                </div>
                                <button
                                    className={cn("btn btn-sm btn-circle rounded-xl", enCarrito ? "btn-primary" : "btn-outline")}
                                    disabled={sinStock}
                                    onClick={() => addToCart(p)}
                                >
                                    {enCarrito ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                </button>
                            </div>
                        )
                    })
                )}
            </div>
        </div>

        {/* COLUMNA DERECHA — carrito */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-base-100 rounded-2xl border border-base-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-base-200 flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-bold text-sm">Carrito</span>
                <span className="badge badge-sm badge-primary ml-auto">{Object.keys(cart).length}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {Object.keys(cart).length === 0 ? (
                    <div className="py-12 text-center opacity-30 text-sm">Agrega productos desde la lista</div>
                ) : (
                    Object.values(cart).map(item => (
                        <div key={item.producto_id} className="bg-base-200/40 rounded-xl p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                                <p className="font-semibold text-xs leading-tight line-clamp-2">{item.nombre}</p>
                                <button
                                    className="btn btn-ghost btn-xs btn-circle text-error"
                                    onClick={() => setCart(prev => { const n = {...prev}; delete n[item.producto_id]; return n })}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>

                            {/* Selector de lote — solo si hay múltiples */}
                            {item.lotes.length > 1 && (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold uppercase opacity-50">Lote</p>
                                    {item.lotes.slice(0, 3).map((l, idx) => (
                                        <label key={l.lote_id} className={cn(
                                            "flex items-center gap-2 p-1.5 rounded-lg cursor-pointer text-xs",
                                            item.lote_elegido_id === l.lote_id ? "bg-primary/10" :
                                            item.lote_elegido_id === null && idx === 0 ? "bg-success/10" : "bg-base-100"
                                        )}>
                                            <input
                                                type="radio"
                                                className="radio radio-xs radio-primary"
                                                checked={item.lote_elegido_id === l.lote_id || (item.lote_elegido_id === null && idx === 0)}
                                                onChange={() => setCart(prev => ({
                                                    ...prev,
                                                    [item.producto_id]: { ...prev[item.producto_id], lote_elegido_id: idx === 0 ? null : l.lote_id }
                                                }))}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="font-mono">{l.numero_lote}</span>
                                                {idx === 0 && <span className="ml-1 text-[9px] bg-success text-white rounded px-1">FEFO</span>}
                                                <span className="block text-[10px] opacity-50">{l.stock} disp · vence {l.fecha_vencimiento?.slice(0,10)}</span>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            )}
                            {item.lotes.length === 1 && (
                                <p className="text-[10px] opacity-50">Lote FEFO: {item.lotes[0]?.numero_lote}</p>
                            )}

                            {/* Cantidad */}
                            <div className="flex items-center gap-2">
                                <button className="btn btn-ghost btn-xs btn-circle"
                                    onClick={() => setCart(prev => ({
                                        ...prev,
                                        [item.producto_id]: { ...prev[item.producto_id], cantidad_descontar: Math.max(1, item.cantidad_descontar - 1) }
                                    }))}>
                                    <Minus className="h-3 w-3" />
                                </button>
                                <input
                                    type="number"
                                    className="input input-bordered input-xs w-14 text-center font-bold"
                                    value={item.cantidad_descontar}
                                    onChange={e => setCart(prev => ({
                                        ...prev,
                                        [item.producto_id]: { ...prev[item.producto_id], cantidad_descontar: Math.max(1, parseInt(e.target.value) || 1) }
                                    }))}
                                />
                                <button className="btn btn-ghost btn-xs btn-circle"
                                    onClick={() => setCart(prev => ({
                                        ...prev,
                                        [item.producto_id]: { ...prev[item.producto_id], cantidad_descontar: item.cantidad_descontar + 1 }
                                    }))}>
                                    <Plus className="h-3 w-3" />
                                </button>
                                <span className="text-xs opacity-50">{item.unidad}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Nota + Confirmar */}
            <div className="p-3 border-t border-base-200 space-y-2">
                <input
                    className="input input-bordered input-sm w-full rounded-xl text-sm"
                    placeholder="Nota (opcional)..."
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                />
                <button
                    className="btn btn-primary w-full rounded-xl gap-2"
                    disabled={Object.keys(cart).length === 0 || batchMutation.isPending}
                    onClick={handleConfirm}
                >
                    {batchMutation.isPending
                        ? <span className="loading loading-spinner loading-sm" />
                        : <><Zap className="h-4 w-4" /> Registrar consumo</>
                    }
                </button>
            </div>
        </div>

        {/* Scanner QR */}
        {isScannerOpen && (
            <QrScanner
                onScan={handleScan}
                onClose={() => setIsScannerOpen(false)}
            />
        )}
    </div>
)
```

- [ ] **Agregar import de `Check` y `X`** desde lucide-react (al inicio del archivo):

```tsx
import { Search, Plus, Minus, Trash2, Send, Zap, AlertTriangle, Camera, X, Check, Package } from 'lucide-react'
```

- [ ] **Verificar que compila y funciona en `/consumos`**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

- [ ] **Commit**

```bash
git add frontend/src/pages/consumos/index.tsx
git commit -m "feat(consumos): split-view redesign with area filter and lot selector"
```

---

## Fase 7 — Conteo — modal con barras de progreso

### Task 12: Conteo — modal rediseñado + bloquear áreas sin stock

**Files:**
- Modify: `frontend/src/pages/conteo/index.tsx`
- Modify: `frontend/src/features/conteo/hooks/use-conteo-list.ts`

- [ ] **Agregar query de configuración en `use-conteo-list.ts`** para obtener `conteo_periodo_dias`:

```typescript
import api from '@/lib/api'

// Dentro de useConteoList():
const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ conteo_periodo_dias: number }>('/configuracion').then(r => r.data),
    staleTime: 300_000,
})
const periodoGlobalDias = configuracion?.conteo_periodo_dias ?? 30
```

- [ ] **Retornar `periodoGlobalDias` desde el hook**:

```typescript
return {
    // ...existente...
    periodoGlobalDias,
}
```

- [ ] **Agregar estado `ocultarSinStock`** en `conteo/index.tsx`:

```tsx
const [ocultarSinStock, setOcultarSinStock] = useState(true)
const { sesiones, isLoading, areas, pendientes, filters, actions, isCreating, periodoGlobalDias } = useConteoList()
```

- [ ] **Calcular urgencia de cada área** — agregar función helper en `conteo/index.tsx`:

```tsx
function getAreaUrgencia(area: Area, pendiente: AreaPendiente | undefined, periodoMax: number) {
    const periodo = area.conteo_frecuencia_dias > 0 ? area.conteo_frecuencia_dias : periodoMax
    const dias = pendiente?.dias_desde_ultimo ?? null
    if (dias === null) return { pct: 100, color: 'error' as const, label: 'Nunca contada' }
    const pct = Math.min((dias / periodo) * 100, 120)
    if (pct >= 100) return { pct, color: 'error' as const, label: `${Math.round(dias)}d · límite ${periodo}d` }
    if (pct >= 70) return { pct, color: 'warning' as const, label: `${Math.round(dias)} de ${periodo} días` }
    return { pct, color: 'success' as const, label: `${Math.round(dias)} de ${periodo} días` }
}
```

- [ ] **Reemplazar el modal de nueva sesión** con el diseño de barras de progreso:

```tsx
{showModal && (
    <div className="modal modal-open">
        <div className="modal-box max-w-md">
            <h3 className="font-bold text-lg mb-1">Nueva sesión de conteo</h3>
            <p className="text-sm opacity-50 mb-3">Selecciona las áreas a contar</p>

            <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
                <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={ocultarSinStock}
                    onChange={e => setOcultarSinStock(e.target.checked)}
                />
                <span className="opacity-60">Ocultar áreas sin stock</span>
            </label>

            <div className="space-y-2 max-h-72 overflow-y-auto mb-4">
                {areas
                    .filter(a => a.activa)
                    .filter(a => !ocultarSinStock || (a.total_items_stock ?? 0) > 0)
                    .sort((a, b) => {
                        const pa = pendientes.find(p => p.area_id === a.id)
                        const pb = pendientes.find(p => p.area_id === b.id)
                        const ua = getAreaUrgencia(a, pa, periodoGlobalDias)
                        const ub = getAreaUrgencia(b, pb, periodoGlobalDias)
                        return ub.pct - ua.pct
                    })
                    .map(a => {
                        const pendiente = pendientes.find(p => p.area_id === a.id)
                        const sinStock = (a.total_items_stock ?? 0) === 0
                        const urgencia = getAreaUrgencia(a, pendiente, periodoGlobalDias)
                        const selected = selectedAreaIds.includes(a.id)
                        return (
                            <label
                                key={a.id}
                                className={cn(
                                    'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors',
                                    sinStock ? 'opacity-40 cursor-not-allowed bg-base-200/50' :
                                    selected ? 'bg-primary/10 border border-primary/30' :
                                    'hover:bg-base-200 border border-transparent'
                                )}
                            >
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-sm checkbox-primary"
                                    checked={selected}
                                    disabled={sinStock}
                                    onChange={() => !sinStock && toggleArea(a.id)}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-semibold">{a.nombre}</span>
                                        {sinStock && <span className="badge badge-xs badge-ghost">Sin stock</span>}
                                    </div>
                                    {!sinStock && (
                                        <>
                                            <div className="w-full bg-base-200 rounded-full h-1.5 mb-1">
                                                <div
                                                    className={cn(
                                                        'h-1.5 rounded-full transition-all',
                                                        urgencia.color === 'error' ? 'bg-error' :
                                                        urgencia.color === 'warning' ? 'bg-warning' : 'bg-success'
                                                    )}
                                                    style={{ width: `${Math.min(urgencia.pct, 100)}%` }}
                                                />
                                            </div>
                                            <span className={cn(
                                                'text-[10px] font-medium',
                                                urgencia.color === 'error' ? 'text-error' :
                                                urgencia.color === 'warning' ? 'text-warning' : 'text-base-content/40'
                                            )}>{urgencia.label}</span>
                                        </>
                                    )}
                                </div>
                            </label>
                        )
                    })
                }
            </div>

            <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => { setShowModal(false); setSelectedAreaIds([]) }}>
                    Cancelar
                </button>
                <button
                    className="btn btn-primary"
                    disabled={selectedAreaIds.length === 0 || isCreating}
                    onClick={() => handleCrear()}
                >
                    {isCreating
                        ? <span className="loading loading-spinner loading-sm" />
                        : selectedAreaIds.length > 1
                            ? `Iniciar ${selectedAreaIds.length} conteos`
                            : 'Iniciar conteo'
                    }
                </button>
            </div>
        </div>
        <div className="modal-backdrop" onClick={() => { setShowModal(false); setSelectedAreaIds([]) }} />
    </div>
)}
```

**Nota:** Para determinar `sinStock`, verificar si el área aparece en `pendientes` con `dias_desde_ultimo === null` Y si el área no tiene sesiones de conteo anteriores puede ser vacía. La forma más simple: hacer una query adicional `GET /stock?area_id=X&per_page=1` solo si se necesita, o bien simplemente deshabilitar la selección de áreas que no tengan items en `pendientes` Y nunca hayan sido contadas (frecuencia 0). Alternativa práctica: deshabilitar solo las áreas donde `pendiente === undefined && area.conteo_frecuencia_dias === 0` — o simplemente omitir el bloqueo por stock en una primera iteración y solo mostrar el toggle para ocultar áreas con frecuencia 0.

- [ ] **Commit**

```bash
git add frontend/src/pages/conteo/index.tsx frontend/src/features/conteo/hooks/use-conteo-list.ts
git commit -m "feat(conteo): progress bar modal with configurable period and empty area blocking"
```

---

## Fase 8 — Recepciones — rediseño completo

### Task 13: Backend — endpoints reconciliar en-camino y scanner QR

**Files:**
- Modify: `backend/src/handlers/recepciones.rs`

- [ ] **Agregar endpoint `POST /recepciones/{id}/reconciliar`** — al final del archivo antes de `pub fn routes()`:

```rust
#[derive(Debug, Deserialize)]
struct ReconciliarInput {
    item_ids: Vec<Uuid>, // IDs de solicitud_items a marcar como recibidos
}

async fn reconciliar_en_camino(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(recepcion_id): Path<Uuid>,
    Json(body): Json<ReconciliarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    // Verificar que la recepción existe
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM recepciones WHERE id = $1)"
    )
    .bind(recepcion_id)
    .fetch_one(&state.pool)
    .await?;
    if !exists { return Err(AppError::NotFound("Recepción no encontrada".into())); }

    // Marcar los items de solicitud como recibidos y vincular a esta recepción
    for item_id in &body.item_ids {
        sqlx::query(
            "UPDATE solicitud_items SET estado = 'recibido', recepcion_id = $1 WHERE id = $2"
        )
        .bind(recepcion_id)
        .bind(item_id)
        .execute(&state.pool)
        .await?;
    }

    Ok(Json(serde_json::json!({
        "reconciliados": body.item_ids.len()
    })))
}
```

- [ ] **Agregar endpoint `POST /recepciones/scanner-session`**:

```rust
async fn crear_scanner_session(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let token: (Uuid, chrono::DateTime<Utc>) = sqlx::query_as(
        "INSERT INTO scanner_sessions (expires_at) VALUES (NOW() + INTERVAL '10 minutes')
         RETURNING token, expires_at"
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "token": token.0,
        "expires_at": token.1,
    })))
}
```

- [ ] **Agregar endpoint `POST /recepciones/scanner-session/{token}/scan`**:

```rust
#[derive(Debug, Deserialize)]
struct ScanInput {
    codigo: String,
}

async fn scan_codigo(
    State(state): State<AppState>,
    Path(token): Path<Uuid>,
    Json(body): Json<ScanInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verificar que la sesión existe y no expiró
    let valid = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM scanner_sessions WHERE token = $1 AND expires_at > NOW())"
    )
    .bind(token)
    .fetch_one(&state.pool)
    .await?;
    if !valid { return Err(AppError::Forbidden("Sesión expirada o inválida".into())); }

    // Buscar el producto por código
    let producto: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, nombre FROM productos WHERE codigo_interno = $1 OR codigo_proveedor = $1 AND activo = true LIMIT 1"
    )
    .bind(&body.codigo)
    .fetch_optional(&state.pool)
    .await?;

    let (producto_id, producto_nombre) = match producto {
        Some(p) => (Some(p.0), Some(p.1)),
        None => (None, None),
    };

    sqlx::query(
        "INSERT INTO scanner_items (session_token, codigo, producto_id, producto_nombre)
         VALUES ($1, $2, $3, $4)"
    )
    .bind(token)
    .bind(&body.codigo)
    .bind(producto_id)
    .bind(&producto_nombre)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "producto_id": producto_id,
        "producto_nombre": producto_nombre,
    })))
}
```

- [ ] **Agregar endpoint `GET /recepciones/scanner-session/{token}/items`**:

```rust
async fn get_scanner_items(
    State(state): State<AppState>,
    Path(token): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items: Vec<(Uuid, String, Option<Uuid>, Option<String>)> = sqlx::query_as(
        "UPDATE scanner_items SET fetched = TRUE
         WHERE session_token = $1 AND fetched = FALSE
         RETURNING id, codigo, producto_id, producto_nombre"
    )
    .bind(token)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "items": items.iter().map(|(id, codigo, pid, pnombre)| serde_json::json!({
            "id": id,
            "codigo": codigo,
            "producto_id": pid,
            "producto_nombre": pnombre,
        })).collect::<Vec<_>>()
    })))
}
```

- [ ] **Registrar las nuevas rutas** en `pub fn routes()`:

```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/scanner-session", post(crear_scanner_session))
        .route("/scanner-session/{token}/scan", post(scan_codigo))
        .route("/scanner-session/{token}/items", get(get_scanner_items))
        .route("/{id}", get(obtener))
        .route("/{id}/foto", post(subir_foto))
        .route("/{id}/reconciliar", post(reconciliar_en_camino))
}
```

- [ ] **Compilar**

```bash
cd backend && cargo build 2>&1
```

- [ ] **Commit**

```bash
git add backend/src/handlers/recepciones.rs
git commit -m "feat(recepciones): add reconciliar endpoint and QR scanner session endpoints"
```

---

### Task 14: Recepciones — componente modal en-camino

**Files:**
- Create: `frontend/src/pages/recepciones/en-camino-modal.tsx`

- [ ] **Crear el componente**:

```tsx
// frontend/src/pages/recepciones/en-camino-modal.tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Package, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

interface EnCaminoItem {
  id: string
  producto_nombre: string
  cantidad_sugerida: string
  unidad: string
  proveedor_nombre: string | null
  estado: string
}

interface EnCaminoModalProps {
  recepcionId: string
  proveedorId: number
  onClose: () => void
  onDone: () => void
}

export function EnCaminoModal({ recepcionId, proveedorId, onClose, onDone }: EnCaminoModalProps) {
  const queryClient = useQueryClient()

  const { data: items, isLoading } = useQuery({
    queryKey: ['en-camino-proveedor', proveedorId],
    queryFn: () => api.get<{ data: EnCaminoItem[] }>('/solicitudes-compra/en-camino', {
        params: { proveedor_id: proveedorId }
    }).then(r => r.data.data),
  })

  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  // Pre-seleccionar todos al cargar
  useState(() => {
    if (items) setSeleccionados(new Set(items.map(i => i.id)))
  })

  const toggleItem = (id: string) => {
    setSeleccionados(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
    })
  }

  const reconciliarMutation = useMutation({
    mutationFn: () => api.post(`/recepciones/${recepcionId}/reconciliar`, {
        item_ids: Array.from(seleccionados)
    }),
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['solicitudes-en-camino'] })
        queryClient.invalidateQueries({ queryKey: ['recepciones'] })
        toast.success(`${seleccionados.size} ítem${seleccionados.size !== 1 ? 's' : ''} marcado${seleccionados.size !== 1 ? 's' : ''} como recibido${seleccionados.size !== 1 ? 's' : ''}`)
        onDone()
    },
    onError: () => toast.error('Error al reconciliar ítems'),
  })

  if (isLoading) return null
  if (!items || items.length === 0) { onDone(); return null }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
          <Package className="h-5 w-5 text-warning" />
          ¿Llegaron estos productos esperados?
        </h3>
        <p className="text-sm opacity-50 mb-4">
          Estos ítems estaban en camino del mismo proveedor. Marca los que llegaron en esta recepción.
        </p>

        <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
          {items.map(item => {
            const checked = seleccionados.has(item.id)
            return (
              <label
                key={item.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                  checked ? 'bg-success/5 border-success/30' : 'bg-warning/5 border-warning/20'
                )}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-success"
                  checked={checked}
                  onChange={() => toggleItem(item.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{item.producto_nombre}</p>
                  <p className="text-xs opacity-50">{item.cantidad_sugerida} {item.unidad}</p>
                </div>
                {checked
                  ? <span className="badge badge-success badge-sm gap-1"><CheckCircle2 className="h-3 w-3" />Recibido</span>
                  : <span className="badge badge-warning badge-sm gap-1"><AlertTriangle className="h-3 w-3" />Pendiente</span>
                }
              </label>
            )
          })}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Omitir</button>
          <button
            className="btn btn-success gap-2"
            disabled={seleccionados.size === 0 || reconciliarMutation.isPending}
            onClick={() => reconciliarMutation.mutate()}
          >
            {reconciliarMutation.isPending
              ? <span className="loading loading-spinner loading-sm" />
              : <>
                  <CheckCircle2 className="h-4 w-4" />
                  Marcar {seleccionados.size} como recibido{seleccionados.size !== 1 ? 's' : ''}
                </>
            }
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add frontend/src/pages/recepciones/en-camino-modal.tsx
git commit -m "feat(recepciones): add en-camino reconciliation modal component"
```

---

### Task 15: Recepciones — componente escáner QR para celular

**Files:**
- Create: `frontend/src/pages/recepciones/qr-scanner-session.tsx`

- [ ] **Crear el componente de sesión de scanner**:

```tsx
// frontend/src/pages/recepciones/qr-scanner-session.tsx
import { useEffect, useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X, Smartphone, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'

interface ScannedItem {
  id: string
  codigo: string
  producto_id: string | null
  producto_nombre: string | null
}

interface QrScannerSessionProps {
  onItemsScanned: (items: ScannedItem[]) => void
  onClose: () => void
}

export function QrScannerSession({ onItemsScanned, onClose }: QrScannerSessionProps) {
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [accumulatedItems, setAccumulatedItems] = useState<ScannedItem[]>([])

  // Crear sesión al montar
  useEffect(() => {
    api.post<{ token: string; expires_at: string }>('/recepciones/scanner-session')
      .then(r => {
        setToken(r.data.token)
        setExpiresAt(new Date(r.data.expires_at))
      })
      .catch(() => toast.error('No se pudo crear sesión de escáner'))
  }, [])

  // Polling cada 2 segundos para nuevos ítems
  useEffect(() => {
    if (!token) return
    const interval = setInterval(async () => {
        try {
            const res = await api.get<{ items: ScannedItem[] }>(`/recepciones/scanner-session/${token}/items`)
            if (res.data.items.length > 0) {
                setAccumulatedItems(prev => [...prev, ...res.data.items])
                toast.success(`${res.data.items.length} ítem(s) escaneado(s)`)
            }
        } catch (_) {}
    }, 2000)
    return () => clearInterval(interval)
  }, [token])

  // URL de la página móvil de escaneo
  const scanUrl = token
    ? `${window.location.origin}/scan/${token}`
    : null

  // Generar QR code como data URL usando la librería qrcode ya instalada
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  useEffect(() => {
    if (!scanUrl) return
    import('qrcode').then(QRCode => {
        QRCode.toDataURL(scanUrl, { width: 200, margin: 2 })
            .then(url => setQrDataUrl(url))
            .catch(() => {})
    })
  }, [scanUrl])

  const timeLeft = expiresAt
    ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000))
    : 0

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" /> Escáner QR
          </h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-center space-y-3">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR escáner" className="mx-auto rounded-xl border border-base-200 p-2" />
          ) : (
            <div className="w-[200px] h-[200px] mx-auto bg-base-200 rounded-xl animate-pulse" />
          )}

          <div className="space-y-1">
            <p className="text-sm font-semibold">Escanea con tu celular</p>
            <p className="text-xs opacity-50">El celular abrirá la cámara en el navegador</p>
            <p className="text-xs opacity-50">Expira en {timeLeft}s</p>
          </div>
        </div>

        {accumulatedItems.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-bold uppercase opacity-50">Productos escaneados ({accumulatedItems.length})</p>
            {accumulatedItems.map(item => (
              <div key={item.id} className="flex items-center gap-2 p-2 bg-success/5 rounded-lg border border-success/20 text-sm">
                <span className="font-semibold text-xs">{item.producto_nombre || item.codigo}</span>
                {!item.producto_id && <span className="badge badge-warning badge-xs">Sin match</span>}
              </div>
            ))}
          </div>
        )}

        <div className="modal-action mt-4">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary btn-sm gap-2"
            disabled={accumulatedItems.length === 0}
            onClick={() => { onItemsScanned(accumulatedItems); onClose() }}
          >
            Usar {accumulatedItems.length} ítem(s)
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}
```

- [ ] **Crear página móvil de escaneo** en el router. Crear archivo:

```tsx
// frontend/src/pages/scan/[token].tsx  → en realidad: frontend/src/pages/scan/index.tsx
// Esta página se accede desde el celular con /scan/:token
```

Agregar en `frontend/src/App.tsx` la ruta `/scan/:token` apuntando a una página simple:

```tsx
// En App.tsx, dentro del <Routes>:
<Route path="/scan/:token" element={<ScanPage />} />
```

Crear `frontend/src/pages/scan/index.tsx`:

```tsx
import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import api from '@/lib/api'
import { toast } from 'sonner'

export default function ScanPage() {
    const { token } = useParams<{ token: string }>()
    const [scanned, setScanned] = useState<string[]>([])
    const [done, setDone] = useState(false)

    useEffect(() => {
        const scanner = new Html5QrcodeScanner('reader', { fps: 10, qrbox: 250 }, false)
        scanner.render(
            async (code) => {
                if (scanned.includes(code)) return
                try {
                    await api.post(`/recepciones/scanner-session/${token}/scan`, { codigo: code })
                    setScanned(prev => [...prev, code])
                    toast.success(`Escaneado: ${code}`)
                } catch {
                    toast.error('Error al enviar escaneo')
                }
            },
            (err) => {}
        )
        return () => { scanner.clear().catch(() => {}) }
    }, [token])

    return (
        <div className="min-h-screen bg-base-100 p-4 max-w-sm mx-auto">
            <h1 className="text-lg font-bold mb-4 text-center">Escanear productos</h1>
            <div id="reader" className="rounded-xl overflow-hidden border border-base-200" />
            {scanned.length > 0 && (
                <div className="mt-4 space-y-1">
                    <p className="text-xs font-bold opacity-50">Enviados: {scanned.length}</p>
                    {scanned.map((c, i) => <p key={i} className="text-sm font-mono">{c}</p>)}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Commit**

```bash
git add frontend/src/pages/recepciones/qr-scanner-session.tsx frontend/src/pages/scan/index.tsx frontend/src/App.tsx
git commit -m "feat(recepciones): add QR scanner session component and mobile scan page"
```

---

### Task 16: Recepciones — rediseño de lista con tabs

**Files:**
- Modify: `frontend/src/pages/recepciones/index.tsx`

- [ ] **Leer el archivo actual** para conocer la estructura exacta:

```bash
cat frontend/src/pages/recepciones/index.tsx
```

- [ ] **Reemplazar la lista de recepciones** con el diseño de tabs (Borradores · Confirmadas · Todas):

La lista debe:
1. Mostrar tabs en la parte superior
2. Buscador por número de documento + filtro por proveedor + filtro por rango de fechas
3. Cada fila muestra: número doc, proveedor (con ícono si existe), fecha, N° ítems, estado (badge), acciones rápidas para borradores (Editar, Confirmar, Eliminar)
4. Banner en top si hay ítems en camino de algún proveedor

La estructura del componente:

```tsx
const [tabActivo, setTabActivo] = useState<'borradores' | 'confirmadas' | 'todas'>('borradores')
const [search, setSearch] = useState('')
const [proveedorFiltro, setProveedorFiltro] = useState<number | null>(null)

// Query de recepciones con filtros
const { data: recepciones, isLoading } = useQuery({
    queryKey: ['recepciones', { tab: tabActivo, search, proveedorFiltro }],
    queryFn: () => api.get('/recepciones', {
        params: {
            estado: tabActivo === 'borradores' ? 'borrador' :
                    tabActivo === 'confirmadas' ? 'confirmada' : undefined,
            q: search || undefined,
            proveedor_id: proveedorFiltro || undefined,
            per_page: 50,
        }
    }).then(r => r.data),
})
```

Las acciones rápidas de borradores usan las mismas mutations existentes de confirmar y eliminar borrador.

- [ ] **Commit** después de verificar que la lista carga y los tabs funcionan:

```bash
git add frontend/src/pages/recepciones/index.tsx
git commit -m "feat(recepciones): redesign list with tabs, search, and quick actions"
```

---

### Task 17: Recepciones — detalle con edición de borrador + modal en-camino

**Files:**
- Modify: `frontend/src/pages/recepciones/detalle.tsx`

- [ ] **Agregar estado para mostrar el modal en-camino** — después de las variables existentes:

```tsx
const [showEnCaminoModal, setShowEnCaminoModal] = useState(false)
const [showQrScanner, setShowQrScanner] = useState(false)
```

- [ ] **Disparar el modal en-camino al confirmar** — en la mutation de confirmar (agregar `onSuccess`):

```tsx
const confirmarMutation = useMutation({
    mutationFn: () => api.post(`/recepciones/${id}/confirmar`),
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['recepcion', id] })
        queryClient.invalidateQueries({ queryKey: ['recepciones'] })
        toast.success('Recepción confirmada')
        setShowEnCaminoModal(true) // Abrir modal de reconciliación
    },
    onError: () => toast.error('Error al confirmar'),
})
```

- [ ] **Agregar el botón de escáner QR** junto a los botones existentes del formulario:

```tsx
{!esConfirmada && (
    <button
        className="btn btn-outline btn-sm gap-2"
        onClick={() => setShowQrScanner(true)}
    >
        <Smartphone className="h-4 w-4" /> Escanear con celular
    </button>
)}
```

- [ ] **Importar y renderizar los modales** al final del return:

```tsx
import { EnCaminoModal } from './en-camino-modal'
import { QrScannerSession } from './qr-scanner-session'

// Al final del return, antes del cierre de </div>:
{showEnCaminoModal && data && (
    <EnCaminoModal
        recepcionId={id!}
        proveedorId={data.recepcion.proveedor_id}
        onClose={() => setShowEnCaminoModal(false)}
        onDone={() => setShowEnCaminoModal(false)}
    />
)}

{showQrScanner && (
    <QrScannerSession
        onItemsScanned={(items) => {
            // Agregar los items escaneados al formulario de edición
            // (implementar según la lógica de edición de ítems del borrador)
            toast.success(`${items.length} producto(s) agregados`)
        }}
        onClose={() => setShowQrScanner(false)}
    />
)}
```

- [ ] **Agregar sección de edición de ítems del borrador** — si `!esConfirmada`, mostrar tabla editable:

```tsx
{!esConfirmada && (
    <div className="bg-base-100 rounded-2xl border border-base-200 p-4">
        <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Ítems del borrador</h3>
            <span className="badge badge-warning badge-sm">Editable</span>
        </div>
        {detalle.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 py-2 border-b border-base-100 last:border-0">
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{item.producto_nombre}</p>
                    <p className="text-xs opacity-50">Lote {item.numero_lote} · Vence {formatDate(item.fecha_vencimiento)}</p>
                </div>
                <input
                    type="number"
                    className="input input-bordered input-xs w-20 text-center"
                    defaultValue={parseFloat(item.cantidad_presentaciones)}
                    min={0.01}
                    step={0.01}
                />
                <span className="text-xs opacity-50">{item.presentacion_nombre}</span>
            </div>
        ))}
        <div className="flex gap-2 mt-3">
            <button className="btn btn-sm btn-primary gap-2" onClick={() => confirmarMutation.mutate()}>
                <CheckCircle2 className="h-4 w-4" /> Confirmar recepción
            </button>
        </div>
    </div>
)}
```

- [ ] **Commit**

```bash
git add frontend/src/pages/recepciones/detalle.tsx
git commit -m "feat(recepciones): add en-camino modal trigger, QR scanner, and draft item editing"
```

---

## Fase 9 — Verificación final

### Task 18: Build y verificación de tipos

- [ ] **Build del frontend**

```bash
cd frontend && npm run build 2>&1 | tail -30
# Debe terminar sin errores de TypeScript
```

- [ ] **Build del backend**

```bash
cd backend && cargo build --release 2>&1 | tail -20
# Debe compilar sin errores ni warnings de compilación
```

- [ ] **Regenerar tipos TypeScript** si hubo cambios de backend:

```bash
cd backend && cargo run --bin export_types
git add frontend/src/types/generated.ts
git commit -m "chore: regenerate TypeScript types from backend" --allow-empty
```

- [ ] **Commit final de rama**

```bash
git log --oneline feat/solicitudes-compra-redesign..HEAD | head -20
# Verificar que todos los commits están en la rama correcta
```

---

## Resumen de commits esperados

```
fix(stock): cast integer binds to ::integer for category and provider filters
feat(db): add moneda and conteo_periodo_dias config keys
feat(db): add scanner_sessions table for QR mobile scanning
feat(config): add moneda_codigo, moneda_simbolo, conteo_periodo_dias fields
fix(dashboard): standardize typography to match rest of app
fix(consumos): lower search threshold from 3 to 2 characters
fix(solicitudes): wire up historial search input to state and backend
fix(solicitudes): read ?select=ID from URL and pre-add product to draft
fix(solicitudes): fix PDF type mapping, add logo and configurable currency
feat(config): add moneda and conteo_periodo_dias fields to settings UI
feat(consumos): split-view redesign with area filter and lot selector
feat(conteo): progress bar modal with configurable period and empty area blocking
feat(recepciones): add reconciliar endpoint and QR scanner session endpoints
feat(recepciones): add en-camino reconciliation modal component
feat(recepciones): add QR scanner session component and mobile scan page
feat(recepciones): redesign list with tabs, search, and quick actions
feat(recepciones): add en-camino modal trigger, QR scanner, and draft item editing
chore: regenerate TypeScript types from backend
```
