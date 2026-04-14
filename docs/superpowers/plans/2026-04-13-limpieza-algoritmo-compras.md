# Limpieza y Rediseño del Sistema de Compras — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limpiar código muerto, simplificar el flujo de solicitudes a 2 estados, rediseñar el algoritmo de recomendaciones con lógica correcta, mejorar la importación CSV y corregir el PDF exportado.

**Architecture:** Cambios secuenciales por capa: primero eliminar (sin riesgo), luego migrar estados, luego reescribir el algoritmo de recomendaciones que depende de `estado = 'guardada'`, finalmente mejoras independientes (CSV, PDF, autoPlural). Cada tarea compila y el sistema funciona al terminarla.

**Tech Stack:** Rust + Axum + SQLx (backend), React 19 + TypeScript + Vite (frontend), PostgreSQL 16, jsPDF + autotable (PDF).

---

## Mapa de archivos

| Archivo | Acción |
|---|---|
| `frontend/src/pages/kiosk/` | **Eliminar** directorio completo |
| `frontend/src/pages/modo-qr/` | **Eliminar** directorio completo |
| `frontend/src/App.tsx` | Modificar — quitar imports y rutas kiosk/qr |
| `frontend/package.json` | Modificar — quitar `qrcode`, `html5-qrcode` |
| `frontend/src/lib/utils.ts` | Modificar — corregir `autoPlural` |
| `frontend/src/lib/solicitud-pdf.ts` | Modificar — 5 columnas, firma simplificada |
| `frontend/src/pages/solicitudes-compra/index.tsx` | Modificar — flujo `guardar`, indicador de confianza |
| `frontend/src/types/generated.ts` | Regenerar con `cargo run --bin export_types` |
| `backend/src/handlers/solicitudes_compra.rs` | Modificar — quitar `revisar`/`en_camino`, rename `enviar`→`guardar`, reescribir query |
| `backend/src/dto/solicitud.rs` | Modificar — actualizar `ItemRecomendado` |
| `backend/src/handlers/setup.rs` | Modificar — mejorar `importar_productos` |
| `backend/src/handlers/configuracion.rs` | Modificar — exponer nuevos campos |
| `backend/migrations/040_simplificar_estados_solicitudes.sql` | **Crear** |
| `backend/migrations/041_configuracion_recomendaciones.sql` | **Crear** |
| `backend/migrations/042_drop_solicitud_items.sql` | **Crear** |

---

## Tarea 1: Audit antes de eliminar

**Archivos:** Solo lectura / búsqueda.

- [ ] **Paso 1: Verificar que solicitud_items no tiene referencias en código Rust**

```bash
cd "C:\Users\Desarrollo\Documents\14 marzo inventario"
grep -r "solicitud_items" backend/src/
```

Resultado esperado: sin coincidencias (0 matches).

- [ ] **Paso 2: Verificar que en_camino no se llama desde el frontend**

```bash
grep -r "en-camino\|en_camino" frontend/src/
```

Resultado esperado: sin coincidencias.

- [ ] **Paso 3: Verificar que revisar no se llama desde el frontend**

```bash
grep -r "\/revisar" frontend/src/
```

Resultado esperado: sin coincidencias (solo aparecería en solicitudes_compra handler que vamos a editar).

- [ ] **Paso 4: Verificar que KioskPage y ModoQrPage solo se usan en App.tsx**

```bash
grep -r "KioskPage\|ModoQrPage\|from.*kiosk\|from.*modo-qr" frontend/src/
```

Resultado esperado: solo aparece en `frontend/src/App.tsx`.

Si algún grep retorna referencias inesperadas, **no continuar** — eliminarlas primero o rediseñar ese componente.

---

## Tarea 2: Eliminar páginas kiosk y modo-qr

**Archivos:**
- Eliminar: `frontend/src/pages/kiosk/`
- Eliminar: `frontend/src/pages/modo-qr/`
- Modificar: `frontend/src/App.tsx`
- Modificar: `frontend/package.json`

- [ ] **Paso 1: Eliminar directorios**

```bash
rm -rf "frontend/src/pages/kiosk"
rm -rf "frontend/src/pages/modo-qr"
```

- [ ] **Paso 2: Actualizar App.tsx — quitar imports y rutas**

En `frontend/src/App.tsx`, eliminar líneas 24-25:
```tsx
// Eliminar estas dos líneas:
import KioskPage from '@/pages/kiosk'
import ModoQrPage from '@/pages/modo-qr'
```

Y eliminar las rutas en el JSX (líneas 74-75):
```tsx
// Eliminar estas dos líneas:
<Route path="/kiosk" element={<KioskPage />} />
<Route path="/qr" element={<ModoQrPage />} />
```

- [ ] **Paso 3: Desinstalar paquetes**

```bash
cd frontend
npm uninstall qrcode html5-qrcode @types/qrcode
```

- [ ] **Paso 4: Verificar que compila**

```bash
npm run build 2>&1 | tail -20
```

Resultado esperado: `✓ built in` sin errores. Si hay errores de import no encontrado, hay referencias adicionales — búscalas con grep y elimínalas.

- [ ] **Paso 5: Commit**

```bash
cd ..
git add frontend/src/App.tsx frontend/package.json frontend/package-lock.json
git add -u frontend/src/pages/kiosk/ frontend/src/pages/modo-qr/
git commit -m "chore: eliminar páginas kiosk y modo-qr + dependencias qrcode/html5-qrcode"
```

---

## Tarea 3: Eliminar endpoints muertos del backend

**Archivos:**
- Modificar: `backend/src/handlers/solicitudes_compra.rs`

- [ ] **Paso 1: Eliminar función `revisar` (líneas 487-493)**

En `backend/src/handlers/solicitudes_compra.rs`, eliminar completamente:

```rust
// ELIMINAR este bloque:
async fn revisar(
    State(_state): State<AppState>,
    Path(_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // TODO
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Paso 2: Eliminar función `en_camino` (líneas 413-436)**

```rust
// ELIMINAR este bloque:
async fn en_camino(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items = sqlx::query_as::<_, EnCaminoItem>(
        // ...
    )
    // ...
}
```

- [ ] **Paso 3: Eliminar struct `EnCaminoItem` (líneas 401-412)**

```rust
// ELIMINAR este bloque:
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EnCaminoItem {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub cantidad_total: Decimal,
    pub unidad: String,
    pub proveedor_nombre: Option<String>,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
}
```

- [ ] **Paso 4: Actualizar `routes()` — quitar las rutas eliminadas**

Reemplazar la función `routes()` al final del archivo:

```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/borrador", get(get_borrador))
        .route("/recomendaciones", get(recomendaciones))
        .route("/{id}", get(obtener).put(actualizar))
        .route("/{id}/guardar", post(guardar))
}
```

*(La función `guardar` se crea en Tarea 5 — por ahora el código no compilará hasta entonces.)*

- [ ] **Paso 5: Compilar para verificar solo errores esperados**

```bash
cd backend && cargo build 2>&1 | grep "^error"
```

Resultado esperado: solo errores sobre `guardar` no definida y `enviar` referenciada pero no en routes. No debe haber errores sobre tipos no encontrados.

---

## Tarea 4: Migración 040 — simplificar estados

**Archivos:**
- Crear: `backend/migrations/040_simplificar_estados_solicitudes.sql`

- [ ] **Paso 1: Crear archivo de migración**

Crear `backend/migrations/040_simplificar_estados_solicitudes.sql` con:

```sql
-- Migración 040: Simplificar estados de solicitudes_compra a borrador | guardada
-- Elimina workflow de aprobación — el sistema solo guarda registros históricos.

-- 1. Normalizar registros existentes antes de cambiar el constraint
UPDATE solicitudes_compra
SET estado = 'guardada'
WHERE estado NOT IN ('borrador', 'guardada');

-- 2. Reemplazar el check constraint
ALTER TABLE solicitudes_compra
    DROP CONSTRAINT IF EXISTS solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN ('borrador', 'guardada'));

-- 3. Limpiar columnas de revisión que ya no tienen sentido
ALTER TABLE solicitudes_compra
    DROP COLUMN IF EXISTS nota_revision,
    DROP COLUMN IF EXISTS fecha_revision,
    DROP COLUMN IF EXISTS revisado_por;
```

- [ ] **Paso 2: Aplicar migración**

```bash
cd ..
docker compose up --build -d
```

Verificar en los logs que la migración se aplica sin error:

```bash
docker compose logs backend 2>&1 | grep -E "migration|040|error" | head -20
```

Resultado esperado: `Applied migration 040_simplificar_estados_solicitudes` sin errores.

- [ ] **Paso 3: Verificar en base de datos**

```bash
docker compose exec db psql -U postgres -d inventario -c "\d solicitudes_compra"
```

Verificar que las columnas `nota_revision`, `fecha_revision`, `revisado_por` ya no existen y que el check constraint dice `(estado = ANY (ARRAY['borrador'::varchar, 'guardada'::varchar]))`.

- [ ] **Paso 4: Commit**

```bash
git add backend/migrations/040_simplificar_estados_solicitudes.sql
git commit -m "feat(db): simplificar estados solicitudes_compra a borrador|guardada"
```

---

## Tarea 5: Renombrar enviar → guardar en el handler

**Archivos:**
- Modificar: `backend/src/handlers/solicitudes_compra.rs`
- Modificar: `backend/src/dto/solicitud.rs`

- [ ] **Paso 1: Renombrar función `enviar` a `guardar` y actualizar estado**

En `backend/src/handlers/solicitudes_compra.rs`, reemplazar la función `enviar`:

```rust
async fn guardar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "UPDATE solicitudes_compra SET estado = 'guardada' WHERE id = $1 AND estado = 'borrador'"
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Solo se puede guardar una solicitud en borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Paso 2: Limpiar structs y campos huérfanos en DTO**

En `backend/src/dto/solicitud.rs`, actualizar `SolicitudResumen` — eliminar `nota_revision` que ya no existe en la tabla:

```rust
#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct SolicitudResumen {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub items_count: i32,
}
```

Y actualizar `SolicitudDetalle` — eliminar campos de revisión:

```rust
#[derive(Debug, Serialize, Type)]
pub struct SolicitudDetalle {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub nota: Option<String>,
    pub items: Vec<SolicitudDetalleItem>,
}
```

- [ ] **Paso 3: Actualizar query `listar` — eliminar `nota_revision` del SELECT**

En la función `listar`, actualizar el SQL:

```rust
let list_sql = format!(
    r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado,
            u.nombre as usuario_nombre,
            (SELECT COUNT(*)::integer FROM solicitud_compra_detalle WHERE solicitud_id = s.id) as items_count
       FROM solicitudes_compra s
       JOIN usuarios u ON u.id = s.usuario_id
       {} ORDER BY s.fecha_creacion DESC
       LIMIT ${} OFFSET ${}"#,
    where_sql, bind_idx, bind_idx + 1
);
```

- [ ] **Paso 4: Actualizar query `obtener_solicitud_por_id` — eliminar campos de revisión del SELECT**

```rust
let solicitud = sqlx::query_as::<_, SolicitudDetalleRow>(
    r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado, s.nota,
              u.nombre as usuario_nombre
       FROM solicitudes_compra s
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.id = $1"#
)
```

Y actualizar `SolicitudDetalleRow`:

```rust
#[derive(Debug, Serialize, sqlx::FromRow)]
struct SolicitudDetalleRow {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub nota: Option<String>,
    pub usuario_nombre: String,
}
```

Y en la construcción de `SolicitudDetalle`:

```rust
Ok(SolicitudDetalle {
    id: solicitud.id,
    numero_documento: solicitud.numero_documento,
    fecha_creacion: solicitud.fecha_creacion,
    estado: solicitud.estado,
    usuario_nombre: solicitud.usuario_nombre,
    nota: solicitud.nota,
    items,
})
```

- [ ] **Paso 5: Compilar backend**

```bash
cd backend && cargo build 2>&1 | grep "^error"
```

Resultado esperado: sin errores.

- [ ] **Paso 6: Commit**

```bash
cd ..
git add backend/src/handlers/solicitudes_compra.rs backend/src/dto/solicitud.rs
git commit -m "feat(solicitudes): rename enviar→guardar, simplificar DTOs post-migración 040"
```

---

## Tarea 6: Actualizar frontend — flujo guardar

**Archivos:**
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Paso 1: Cambiar `enviarMutation` para llamar a `/guardar`**

En `frontend/src/pages/solicitudes-compra/index.tsx`, buscar la mutación `enviarMutation` y actualizar el endpoint:

```ts
const guardarMutation = useMutation({
  mutationFn: async () => {
    const saveData: UpdateSolicitudRequest = {
      nota: null,
      items: items.map(i => ({
        producto_id: i.producto_id,
        cantidad_sugerida: i.cantidad.toString(),
        unidad: i.unidad_base,
        precio_unitario: i.precio_unitario.toString(),
        presentacion_id: i.presentacion_id,
        cantidad_presentaciones: i.cantidad.toString(),
      })),
    }
    let id = solicitudId
    if (id) {
      await api.put(`/solicitudes-compra/${id}`, saveData)
    } else {
      const res = await api.post('/solicitudes-compra', saveData)
      id = res.data.id
      setSolicitudId(id)
    }
    return api.post(`/solicitudes-compra/${id}/guardar`)
  },
  onSuccess: () => {
    toast.success('Solicitud guardada correctamente')
    setItems([])
    setSolicitudId(null)
    setSelectedProveedor(null)
    borradorCargado.current = false
    setView('historial')
    queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
  },
  onError: (err: unknown) => {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    toast.error(msg ?? 'Error al guardar solicitud')
  },
})
```

- [ ] **Paso 2: Actualizar todos los usos de `enviarMutation` por `guardarMutation`**

```bash
grep -n "enviarMutation" frontend/src/pages/solicitudes-compra/index.tsx
```

Reemplazar cada referencia a `enviarMutation` por `guardarMutation` en el JSX (botones, estados `isPending`, etc.).

- [ ] **Paso 3: Actualizar el botón de acción — cambiar texto**

Buscar el botón "Enviar" y cambiar a "Guardar solicitud":

```tsx
<Button
  onClick={() => guardarMutation.mutate()}
  disabled={items.length === 0 || guardarMutation.isPending}
>
  {guardarMutation.isPending ? 'Guardando...' : 'Guardar solicitud'}
</Button>
```

- [ ] **Paso 4: Eliminar referencias a `nota_revision` y campos de revisión en la UI del historial**

```bash
grep -n "nota_revision\|revisado_por\|fecha_revision" frontend/src/pages/solicitudes-compra/index.tsx
```

Eliminar los JSX que muestran esos campos.

- [ ] **Paso 5: Verificar que compila**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Resultado esperado: `✓ built in` sin errores.

- [ ] **Paso 6: Commit**

```bash
cd ..
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(solicitudes): actualizar frontend a flujo guardar, eliminar UI de revisión"
```

---

## Tarea 7: Corregir autoPlural

**Archivos:**
- Modificar: `frontend/src/lib/utils.ts`

- [ ] **Paso 1: Buscar todos los usos de autoPlural para entender el impacto**

```bash
grep -rn "autoPlural" frontend/src/
```

Anotar los lugares donde se usa. La función solo debe llamarse desde helpers internos de `utils.ts`, no directamente en componentes.

- [ ] **Paso 2: Reemplazar la función `autoPlural`**

En `frontend/src/lib/utils.ts`, reemplazar:

```ts
/** Plural automático para español: vocal final → +s, consonante → +es. */
export function autoPlural(s: string): string {
  const last = s.slice(-1).toLowerCase()
  return 'aeiouáéíóú'.includes(last) ? s + 's' : s + 'es'
}
```

por:

```ts
/**
 * Plural automático para español.
 * - Vocal final → +s (tira → tiras)
 * - Terminada en 'z' → quitar z, +ces (lápiz → lápices)
 * - Terminada en 's' o 'x' → invariable (tórax → tórax)
 * - Lista explícita de excepciones para préstamos del inglés comunes en labs
 * - Vocal + consonante final → +s (kit→kits, test→tests, gel→geles*)
 * - Consonante + consonante final → +es (default español)
 *
 * * gel es excepción explícita porque 'geles' no sigue la regla vocal+consonante
 */
const PLURAL_EXCEPTIONS: Record<string, string> = {
  kit: 'kits',
  test: 'tests',
  set: 'sets',
  film: 'films',
  strip: 'strips',
  scan: 'scans',
  gel: 'geles',
  vial: 'viales',
  panel: 'paneles',
}

export function autoPlural(s: string): string {
  if (!s) return s
  const lower = s.toLowerCase()
  if (PLURAL_EXCEPTIONS[lower]) return PLURAL_EXCEPTIONS[lower]
  const last = lower.slice(-1)
  if ('aeiouáéíóú'.includes(last)) return s + 's'
  if (last === 'z') return s.slice(0, -1) + 'ces'
  if (last === 's' || last === 'x') return s
  // Vocal + consonante final (loanwords) → +s
  const secondLast = lower.slice(-2, -1)
  if ('aeiouáéíóú'.includes(secondLast)) return s + 's'
  return s + 'es'
}
```

- [ ] **Paso 3: Verificar casos críticos manualmente**

En la consola del browser o con un test rápido en Node:

```ts
// Esperado:
autoPlural('kit')    // 'kits'    ✓
autoPlural('test')   // 'tests'   ✓
autoPlural('tira')   // 'tiras'   ✓
autoPlural('tubo')   // 'tubos'   ✓
autoPlural('lápiz')  // 'lápices' ✓
autoPlural('gel')    // 'geles'   ✓
autoPlural('tórax')  // 'tórax'   ✓
autoPlural('frasco') // 'frascos' ✓
```

- [ ] **Paso 4: Build y commit**

```bash
cd frontend && npm run build 2>&1 | tail -5
cd ..
git add frontend/src/lib/utils.ts
git commit -m "fix(utils): corregir autoPlural para préstamos del inglés (kit→kits, test→tests)"
```

---

## Tarea 8: Migración 041 — campos de configuración para recomendaciones

**Archivos:**
- Crear: `backend/migrations/041_configuracion_recomendaciones.sql`

- [ ] **Paso 1: Crear archivo de migración**

Crear `backend/migrations/041_configuracion_recomendaciones.sql`:

```sql
-- Migración 041: Parámetros configurables para el algoritmo de recomendaciones
-- ventana_consumo_dias: cuántos días de historial usar para calcular consumo promedio
-- periodo_revision_dias: cada cuántos días se realiza una compra (ciclo de pedido)

INSERT INTO configuracion (clave, valor_texto) VALUES ('ventana_consumo_dias', '30')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO configuracion (clave, valor_texto) VALUES ('periodo_revision_dias', '30')
ON CONFLICT (clave) DO NOTHING;
```

- [ ] **Paso 2: Aplicar migración**

```bash
docker compose up --build -d
docker compose logs backend 2>&1 | grep -E "migration|041|error" | head -10
```

Resultado esperado: `Applied migration 041_configuracion_recomendaciones` sin errores.

- [ ] **Paso 3: Commit**

```bash
git add backend/migrations/041_configuracion_recomendaciones.sql
git commit -m "feat(db): agregar ventana_consumo_dias y periodo_revision_dias a configuracion"
```

---

## Tarea 9: Exponer nuevos campos en el handler de configuración

**Archivos:**
- Modificar: `backend/src/handlers/configuracion.rs`

- [ ] **Paso 1: Leer el handler actual**

```bash
cat backend/src/handlers/configuracion.rs
```

Identificar cómo se construye la respuesta (probablemente un SELECT de múltiples claves y se arma un JSON).

- [ ] **Paso 2: Agregar los nuevos campos a la respuesta GET /configuracion**

En el handler que retorna la configuración completa, agregar la lectura de los nuevos campos. El patrón es igual al resto de claves existentes. Si el handler usa un HashMap o construye el JSON a mano, agregar:

```rust
// Dentro de donde se leen las claves de configuracion:
let ventana_consumo_dias: i32 = sqlx::query_scalar(
    "SELECT COALESCE(valor_texto, '30')::int FROM configuracion WHERE clave = 'ventana_consumo_dias'"
)
.fetch_optional(&state.pool)
.await?
.unwrap_or(30);

let periodo_revision_dias: i32 = sqlx::query_scalar(
    "SELECT COALESCE(valor_texto, '30')::int FROM configuracion WHERE clave = 'periodo_revision_dias'"
)
.fetch_optional(&state.pool)
.await?
.unwrap_or(30);
```

Y agregar al JSON de respuesta:
```rust
"ventana_consumo_dias": ventana_consumo_dias,
"periodo_revision_dias": periodo_revision_dias,
```

- [ ] **Paso 3: Compilar**

```bash
cd backend && cargo build 2>&1 | grep "^error"
```

- [ ] **Paso 4: Commit**

```bash
cd ..
git add backend/src/handlers/configuracion.rs
git commit -m "feat(configuracion): exponer ventana_consumo_dias y periodo_revision_dias"
```

---

## Tarea 10: Actualizar DTO e implementar nuevo algoritmo de recomendaciones

**Archivos:**
- Modificar: `backend/src/dto/solicitud.rs`
- Modificar: `backend/src/handlers/solicitudes_compra.rs`

- [ ] **Paso 1: Actualizar struct `ItemRecomendado` en dto/solicitud.rs**

Reemplazar el struct completo:

```rust
#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct ItemRecomendado {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_id: Option<i32>,
    pub proveedor_nombre: Option<String>,
    pub lead_time: i32,
    pub autonomia_dias: Option<f64>,
    pub nivel_urgencia: String,
    pub stock_actual: Decimal,
    pub stock_seguridad: Decimal,       // antes: stock_minimo
    pub consumo_diario: Decimal,         // antes: consumo_diario_30d
    pub dias_historia: i32,              // NUEVO: para indicador de confianza
    pub cantidad_sugerida_base: Decimal,
    pub presentacion_id: Option<i32>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub cantidad_sugerida_presentacion: Option<Decimal>,
    pub precio_ultima_recepcion: Option<Decimal>,
    pub unidad_base: String,
    pub unidad_base_plural: Option<String>,
    pub imagen_url: Option<String>,
}
```

- [ ] **Paso 2: Reemplazar la función `recomendaciones` en solicitudes_compra.rs**

Reemplazar la función completa `pub async fn recomendaciones(...)`:

```rust
pub async fn recomendaciones(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items = sqlx::query_as::<_, ItemRecomendado>(
        r#"WITH
cfg AS (
    SELECT
        COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'ventana_consumo_dias'), 30)  AS ventana_dias,
        COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'periodo_revision_dias'), 30) AS revision_dias
),
consumo AS (
    SELECT
        l.producto_id,
        (SUM(m.cantidad)::float
            / GREATEST(DATE_PART('day', NOW() - MIN(m.created_at)), 1)
        )::DECIMAL(15,6)                                              AS consumo_diario,
        DATE_PART('day', NOW() - MIN(m.created_at))::INT              AS dias_historia
    FROM movimientos m
    JOIN lotes l ON l.id = m.lote_id
    WHERE m.tipo = 'CONSUMO'
      AND m.created_at >= NOW() - ((SELECT ventana_dias FROM cfg) * INTERVAL '1 day')
    GROUP BY l.producto_id
),
stock_total AS (
    SELECT producto_id, SUM(cantidad) AS stock_actual
    FROM stock
    GROUP BY producto_id
),
pedidos_en_vuelo AS (
    SELECT
        scd.producto_id,
        SUM(scd.cantidad_sugerida) AS cantidad_pedida
    FROM solicitud_compra_detalle scd
    JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
    JOIN productos p2 ON p2.id = scd.producto_id
    LEFT JOIN proveedores prov2 ON prov2.id = p2.proveedor_id
    WHERE sc.estado = 'guardada'
      AND sc.fecha_creacion >= NOW() - (
          COALESCE(prov2.dias_despacho_tierra, prov2.dias_despacho_aereo, 7)::int
          * 2 * INTERVAL '1 day'
      )
    GROUP BY scd.producto_id
),
ultimo_precio AS (
    SELECT DISTINCT ON (rd.producto_id)
        rd.producto_id,
        rd.precio_unitario
    FROM recepcion_detalle rd
    JOIN recepciones r ON r.id = rd.recepcion_id
    WHERE rd.precio_unitario IS NOT NULL
      AND r.estado IN ('completa', 'parcial')
    ORDER BY rd.producto_id, r.fecha_recepcion DESC
),
pres AS (
    SELECT DISTINCT ON (producto_id)
        producto_id, id, nombre, nombre_plural, factor_conversion
    FROM presentaciones
    WHERE activa = true
    ORDER BY producto_id, factor_conversion DESC
),
base AS (
    SELECT
        p.id                                                                    AS producto_id,
        p.nombre                                                                AS producto_nombre,
        p.codigo_proveedor,
        p.codigo_maestro,
        prov.id                                                                 AS proveedor_id,
        prov.nombre                                                             AS proveedor_nombre,
        COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)::INT  AS lead_time,
        COALESCE(st.stock_actual, 0)                                            AS stock_actual,
        COALESCE(p.stock_minimo, 0)                                             AS stock_seguridad,
        COALESCE(c.consumo_diario, 0)                                           AS consumo_diario,
        COALESCE(c.dias_historia, 0)::INT                                       AS dias_historia,
        CASE
            WHEN COALESCE(c.consumo_diario, 0) > 0
            THEN (COALESCE(st.stock_actual, 0)::float / c.consumo_diario::float)
            ELSE NULL
        END                                                                     AS autonomia_dias,
        CASE
            WHEN COALESCE(st.stock_actual, 0) < COALESCE(p.stock_minimo, 0)
                THEN 'critico'
            WHEN COALESCE(c.consumo_diario, 0) > 0
              AND COALESCE(st.stock_actual, 0) < (
                  COALESCE(p.stock_minimo, 0)
                  + COALESCE(c.consumo_diario, 0)
                  * COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
              )
                THEN 'planificar'
            ELSE NULL
        END                                                                     AS nivel_urgencia,
        GREATEST(0, CEIL(
            COALESCE(p.stock_minimo, 0)
            + COALESCE(c.consumo_diario, 0) * (
                COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                + cfg.revision_dias
            )
            - COALESCE(st.stock_actual, 0)
            - COALESCE(pev.cantidad_pedida, 0)
        ))                                                                      AS cantidad_sugerida_base,
        pres.id                                                                 AS presentacion_id,
        pres.nombre                                                             AS presentacion_nombre,
        pres.nombre_plural                                                      AS presentacion_nombre_plural,
        pres.factor_conversion,
        CASE
            WHEN pres.factor_conversion IS NOT NULL AND pres.factor_conversion > 0
            THEN CEIL(
                GREATEST(0,
                    COALESCE(p.stock_minimo, 0)
                    + COALESCE(c.consumo_diario, 0) * (
                        COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                        + cfg.revision_dias
                    )
                    - COALESCE(st.stock_actual, 0)
                    - COALESCE(pev.cantidad_pedida, 0)
                ) / pres.factor_conversion
            )
            ELSE NULL
        END                                                                     AS cantidad_sugerida_presentacion,
        COALESCE(up.precio_unitario, p.precio_unidad)                           AS precio_ultima_recepcion,
        ub.nombre                                                               AS unidad_base,
        ub.nombre_plural                                                        AS unidad_base_plural,
        p.imagen_url
    FROM productos p
    CROSS JOIN cfg
    LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
    LEFT JOIN consumo c ON c.producto_id = p.id
    LEFT JOIN stock_total st ON st.producto_id = p.id
    LEFT JOIN ultimo_precio up ON up.producto_id = p.id
    LEFT JOIN pres ON pres.producto_id = p.id
    LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
    LEFT JOIN pedidos_en_vuelo pev ON pev.producto_id = p.id
    WHERE p.activo = true
      AND p.deleted_at IS NULL
)
SELECT *
FROM base
WHERE nivel_urgencia IS NOT NULL
ORDER BY
    CASE nivel_urgencia
        WHEN 'critico'    THEN 1
        WHEN 'planificar' THEN 2
        ELSE 3
    END,
    COALESCE(autonomia_dias, 0)"#
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "data": items })))
}
```

- [ ] **Paso 3: Compilar backend**

```bash
cd backend && cargo build 2>&1 | grep "^error"
```

Resultado esperado: sin errores. Si hay error de tipo en `consumo_diario` o `stock_seguridad` (cambio de nombre desde `consumo_diario_30d`/`stock_minimo`), verificar que el alias SQL coincide exactamente con el nombre del campo Rust.

- [ ] **Paso 4: Probar el endpoint manualmente**

```bash
# Con el sistema corriendo:
curl -s -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/solicitudes-compra/recomendaciones | jq '.data | length'
```

Si retorna un número (aunque sea 0), el query funciona. Si retorna error de DB, revisar el SQL.

- [ ] **Paso 5: Commit**

```bash
cd ..
git add backend/src/dto/solicitud.rs backend/src/handlers/solicitudes_compra.rs
git commit -m "feat(recomendaciones): rediseñar algoritmo — stock_seguridad, ventana configurable, pedidos_en_vuelo"
```

---

## Tarea 11: Regenerar tipos TypeScript

**Archivos:**
- Regenerar: `frontend/src/types/generated.ts`

- [ ] **Paso 1: Exportar tipos**

```bash
cd backend && cargo run --bin export_types 2>&1 | tail -5
```

Resultado esperado: `Types exported to ../frontend/src/types/generated.ts` sin errores.

- [ ] **Paso 2: Verificar cambios en generated.ts**

```bash
git diff frontend/src/types/generated.ts | grep "^[+-]" | grep -v "^---\|^+++"
```

Verificar que:
- `ItemRecomendado` ahora tiene `dias_historia: number` y `stock_seguridad` en lugar de `stock_minimo`
- `SolicitudDetalle` no tiene `nota_revision`, `fecha_revision`, `revisado_por_nombre`
- `SolicitudResumen` no tiene `nota_revision`

- [ ] **Paso 3: Verificar que el frontend compila con los nuevos tipos**

```bash
cd frontend && npm run build 2>&1 | grep "error TS" | head -20
```

Si hay errores de TypeScript sobre campos que ya no existen (ej: `nota_revision`), localizarlos con grep y eliminar su uso del frontend.

- [ ] **Paso 4: Commit**

```bash
cd ..
git add frontend/src/types/generated.ts
git commit -m "chore: regenerar tipos TypeScript post-rediseño solicitudes y recomendaciones"
```

---

## Tarea 12: Actualizar UI — indicador de confianza en recomendaciones

**Archivos:**
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Paso 1: Agregar función helper para el indicador**

Al inicio del archivo (sección de helpers), agregar:

```ts
function confianzaLabel(diasHistoria: number): { label: string; color: string } {
  if (diasHistoria === 0)  return { label: 'Sin historial — revisa la cantidad', color: 'text-error' }
  if (diasHistoria <= 30)  return { label: 'Estimación preliminar', color: 'text-warning' }
  if (diasHistoria <= 90)  return { label: 'Estimación moderada', color: 'text-info' }
  return { label: 'Estimación confiable', color: 'text-success' }
}
```

- [ ] **Paso 2: Mostrar el indicador en cada ítem recomendado**

En el componente donde se renderiza cada `ItemRecomendado`, agregar el indicador debajo del nombre o de la cantidad sugerida:

```tsx
{(() => {
  const conf = confianzaLabel(rec.dias_historia)
  return (
    <span className={`text-[10px] font-medium ${conf.color}`}>
      {conf.label}
    </span>
  )
})()}
```

- [ ] **Paso 3: Para ítems sin historial, hacer la cantidad editable por defecto**

Cuando `rec.dias_historia === 0`, la cantidad sugerida en el carrito debe iniciar con el campo de edición abierto (o con un hint visual). Buscar donde se agrega el ítem al carrito y agregar lógica:

```ts
// Al agregar un ítem recomendado al carrito:
const cantidadInicial = rec.dias_historia === 0
  ? parseFloat(rec.stock_seguridad.toString()) * 2  // hint: 2× stock_seguridad
  : parseFloat(rec.cantidad_sugerida_base.toString())
```

- [ ] **Paso 4: Build y verificar**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

- [ ] **Paso 5: Commit**

```bash
cd ..
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(recomendaciones): agregar indicador de confianza y cantidad editable para ítems sin historial"
```

---

## Tarea 13: Migración 042 — eliminar solicitud_items

**Archivos:**
- Crear: `backend/migrations/042_drop_solicitud_items.sql`

- [ ] **Paso 1: Verificar una última vez que no hay referencias**

```bash
grep -r "solicitud_items" backend/src/
```

Resultado esperado: 0 matches. Si hay alguno, eliminarlo antes de continuar.

- [ ] **Paso 2: Crear migración**

```sql
-- Migración 042: Eliminar tabla solicitud_items y columna recepcion_id
-- Estos fueron agregados en migration 037 para un workflow de reconciliación
-- que fue descartado en el rediseño.

DROP TABLE IF EXISTS solicitud_items;

ALTER TABLE solicitudes_compra
    DROP COLUMN IF EXISTS recepcion_id;
```

- [ ] **Paso 3: Aplicar y verificar**

```bash
docker compose up --build -d
docker compose logs backend 2>&1 | grep -E "042|error" | head -5
```

- [ ] **Paso 4: Commit**

```bash
git add backend/migrations/042_drop_solicitud_items.sql
git commit -m "chore(db): eliminar tabla solicitud_items y columna recepcion_id (workflow descartado)"
```

---

## Tarea 14: Mejorar importar_productos en setup.rs

El handler `importar_productos` ya existe. Los cambios son:
1. Deduplicar por `codigo_interno` (no por nombre)
2. Soportar columnas `proveedor`, `codigo_proveedor`, `unidad_base_plural`
3. Permitir importación parcial (saltar filas con error, no rollback total)
4. Retornar `omitidos` separado de `errores`

**Archivos:**
- Modificar: `backend/src/handlers/setup.rs`

- [ ] **Paso 1: Actualizar `ImportResult` para incluir `omitidos`**

```rust
#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total_filas: usize,
    pub importados: usize,
    pub omitidos: usize,   // filas que ya existían (codigo_interno duplicado)
    pub errores: Vec<ImportError>,
    pub preview: Vec<serde_json::Value>,
    pub valido: bool,
}
```

- [ ] **Paso 2: Reescribir el loop de importación en `importar_productos`**

Reemplazar el bloque del loop `for (idx, result) in reader.records().enumerate()` con:

```rust
let mut importados = 0usize;
let mut omitidos = 0usize;
let mut errores = Vec::new();
let mut preview = Vec::new();
let mut total_filas = 0usize;

// Usar una conexión directa para no perder toda la importación si hay errores parciales
for (idx, result) in reader.records().enumerate() {
    total_filas += 1;
    let fila_num = idx + 2;
    let record = match result {
        Ok(r) => r,
        Err(e) => {
            errores.push(ImportError { fila: fila_num, mensaje: format!("Error de formato: {}", e) });
            continue;
        }
    };

    let get_val = |key: &str| col_map.get(key).and_then(|&i| record.get(i)).unwrap_or("").trim();

    let nombre = get_val("nombre");
    let codigo_interno = get_val("codigo_interno");
    let unidad_nombre = get_val("unidad_base");
    let unidad_plural = get_val("unidad_base_plural");
    let stock_minimo_str = get_val("stock_seguridad");
    let precio_str = get_val("precio_unitario");
    let cod_proveedor = get_val("codigo_proveedor");
    let proveedor_nombre = get_val("proveedor");
    let categoria_nombre = get_val("categoria");

    // Validaciones
    if nombre.is_empty() {
        errores.push(ImportError { fila: fila_num, mensaje: "nombre es obligatorio".into() });
        continue;
    }
    if codigo_interno.is_empty() {
        errores.push(ImportError { fila: fila_num, mensaje: "codigo_interno es obligatorio".into() });
        continue;
    }

    // Preview (primeras 5 filas)
    if preview.len() < 5 {
        preview.push(serde_json::json!({
            "fila": fila_num,
            "nombre": nombre,
            "codigo_interno": codigo_interno,
            "unidad_base": unidad_nombre,
            "stock_seguridad": stock_minimo_str,
            "proveedor": proveedor_nombre
        }));
    }

    if config.dry_run { continue; }

    // Verificar duplicado por codigo_interno
    let existe: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM productos WHERE codigo_interno = $1)"
    )
    .bind(codigo_interno)
    .fetch_one(&state.pool)
    .await?;

    if existe {
        omitidos += 1;
        continue;
    }

    // Buscar/crear unidad
    let unidad_id: Option<i32> = sqlx::query_scalar(
        "SELECT id FROM unidades_basicas WHERE nombre = $1 OR nombre_plural = $1"
    )
    .bind(unidad_nombre)
    .fetch_optional(&state.pool)
    .await?;

    let u_id = match unidad_id {
        Some(id) => id,
        None if !unidad_nombre.is_empty() => {
            sqlx::query_scalar(
                "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2) RETURNING id"
            )
            .bind(unidad_nombre)
            .bind(if unidad_plural.is_empty() { None } else { Some(unidad_plural) })
            .fetch_one(&state.pool)
            .await?
        }
        None => {
            errores.push(ImportError { fila: fila_num, mensaje: "unidad_base es obligatoria".into() });
            continue;
        }
    };

    // Buscar/crear categoría
    let cat_id: Option<i32> = if !categoria_nombre.is_empty() {
        let id: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM categorias WHERE nombre = $1"
        )
        .bind(categoria_nombre)
        .fetch_optional(&state.pool)
        .await?;
        match id {
            Some(id) => Some(id),
            None => Some(sqlx::query_scalar(
                "INSERT INTO categorias (nombre) VALUES ($1) RETURNING id"
            )
            .bind(categoria_nombre)
            .fetch_one(&state.pool)
            .await?),
        }
    } else { None };

    // Buscar/crear proveedor
    let prov_id: Option<i32> = if !proveedor_nombre.is_empty() {
        let id: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM proveedores WHERE nombre = $1"
        )
        .bind(proveedor_nombre)
        .fetch_optional(&state.pool)
        .await?;
        match id {
            Some(id) => Some(id),
            None => Some(sqlx::query_scalar(
                "INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id"
            )
            .bind(proveedor_nombre)
            .fetch_one(&state.pool)
            .await?),
        }
    } else { None };

    let stock_min = Decimal::from_str(stock_minimo_str).unwrap_or(Decimal::ZERO);
    let precio = Decimal::from_str(precio_str).ok();

    sqlx::query(
        "INSERT INTO productos
         (codigo_interno, nombre, unidad_base_id, categoria_id, proveedor_id,
          stock_minimo, precio_unidad, codigo_proveedor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
    )
    .bind(codigo_interno)
    .bind(nombre)
    .bind(u_id)
    .bind(cat_id)
    .bind(prov_id)
    .bind(stock_min)
    .bind(precio)
    .bind(if cod_proveedor.is_empty() { None } else { Some(cod_proveedor) })
    .execute(&state.pool)
    .await?;

    importados += 1;
}
```

- [ ] **Paso 3: Actualizar el retorno para incluir `omitidos`**

```rust
Ok(Json(ImportResult {
    total_filas,
    importados,
    omitidos,
    errores: errores.clone(),
    preview,
    valido: total_filas > 0 && errores.is_empty(),
}))
```

- [ ] **Paso 4: Eliminar el bloque de transacción — ahora se inserta directamente**

Remover `let mut tx = state.pool.begin().await?;` y los `tx.commit()/tx.rollback()` al final. Las inserciones ahora van directo contra `&state.pool`. Esta es la decisión de diseño que permite importación parcial.

- [ ] **Paso 5: Compilar**

```bash
cd backend && cargo build 2>&1 | grep "^error"
```

- [ ] **Paso 6: Commit**

```bash
cd ..
git add backend/src/handlers/setup.rs
git commit -m "feat(setup): mejorar importar_productos — codigo_interno, proveedor/categoria auto-crear, importación parcial"
```

---

## Tarea 15: Mejoras al PDF exportado

**Archivos:**
- Modificar: `frontend/src/lib/solicitud-pdf.ts`

- [ ] **Paso 1: Actualizar la interfaz `SolicitudPdfOptions`**

Reemplazar los campos de firma del autorizador por un solo campo:

```ts
interface SolicitudPdfOptions {
  numero_documento: string
  fecha_creacion: string
  usuario_nombre: string
  nota?: string | null
  subtotal_neto: number
  iva: number
  total_con_iva: number
  items: {
    producto_nombre: string
    cantidad_sugerida: number
    unidad: string
    codigo_maestro?: string | null
    codigo_proveedor?: string | null
    presentacion_nombre?: string | null
    presentacion_nombre_plural?: string | null
    factor_conversion?: number | null
    precio_unitario?: number | null
    cantidad_presentaciones?: number | null
  }[]
  nombreLaboratorio: string
  logoBase64?: string | null
  monedaSimbolo?: string
  // Firma simplificada — solo el solicitante
  firma_solicitante_label?: string | null
}
```

- [ ] **Paso 2: Actualizar el subtítulo del header**

En la función `exportarSolicitudPDF`, reemplazar la línea del subtítulo:

```ts
// Reemplazar:
doc.text('SISTEMA DE GESTIÓN DE INVENTARIO E INSUMOS CLÍNICOS', textX, 25)
// Por:
doc.text(nombreLaboratorio.toUpperCase(), textX, 25)
```

- [ ] **Paso 3: Reemplazar la tabla de 7 columnas por 5 columnas**

Reemplazar el bloque `autoTable(doc, {...})` completo:

```ts
autoTable(doc, {
  startY: y,
  margin: { left: 12, right: 12 },
  head: [[
    '#',
    'Producto',
    'Cantidad',
    'Precio unitario',
    'Total neto',
  ]],
  body: items.map((item, index) => {
    const usaPresentacion = !!(item.presentacion_nombre && item.factor_conversion && item.cantidad_presentaciones)

    const baseEquiv = usaPresentacion
      ? Math.round(item.cantidad_presentaciones! * item.factor_conversion!)
      : Math.round(item.cantidad_sugerida)
    const presLabel = usaPresentacion
      ? (item.cantidad_presentaciones === 1
        ? item.presentacion_nombre!
        : (item.presentacion_nombre_plural ?? item.presentacion_nombre + 's'))
      : ''
    const cantDisplay = usaPresentacion
      ? `${item.cantidad_presentaciones} ${presLabel}\n= ${baseEquiv} ${item.unidad}`
      : `${Math.round(item.cantidad_sugerida)} ${item.unidad}`

    const precioBase = item.precio_unitario ?? 0
    const precioPres = (usaPresentacion && item.factor_conversion)
      ? precioBase * item.factor_conversion
      : null
    const qty = usaPresentacion ? item.cantidad_presentaciones! : item.cantidad_sugerida
    const precioEfectivo = precioPres ?? precioBase
    const hasPrice = item.precio_unitario != null
    const neto = hasPrice ? qty * precioEfectivo : 0

    // Una sola columna de precio: mostrar precio de presentación si aplica, si no precio base
    const precioDisplay = hasPrice
      ? fmtMonto(precioPres ?? precioBase)
      : '—'

    return [
      index + 1,
      item.producto_nombre,
      { content: cantDisplay, styles: { fontSize: 6.5 } },
      precioDisplay,
      hasPrice ? fmtMonto(neto) : '—',
    ]
  }),
  theme: 'grid',
  headStyles: {
    fillColor: C.primary,
    textColor: C.white,
    fontSize: 6.5,
    fontStyle: 'bold',
    halign: 'center',
    cellPadding: { top: 3, right: 2, bottom: 3, left: 2 },
  },
  styles: { fontSize: 7.5, cellPadding: { top: 3, right: 2, bottom: 3, left: 2 }, valign: 'middle' },
  columnStyles: {
    0: { halign: 'center', cellWidth: 6 },
    1: { cellWidth: 80, cellPadding: { top: 3, right: 2, bottom: 3, left: 3 } },
    2: { halign: 'center', cellWidth: 30 },
    3: { halign: 'right', cellWidth: 32 },
    4: { halign: 'right', cellWidth: 38 },
  },
  alternateRowStyles: { fillColor: C.bgLight },
  didParseCell: (data: any) => {
    if (data.section !== 'body' || data.column.index !== 1) return
    const item = items[data.row.index]
    if (!item) return
    if (item.codigo_proveedor || item.codigo_maestro) {
      data.cell.styles.cellPadding = { top: 3, right: 2, bottom: 11, left: 3 }
    }
  },
  didDrawCell: (data: any) => {
    if (data.section !== 'body' || data.column.index !== 1) return
    const item = items[data.row.index]
    if (!item) return
    const codigos = [
      item.codigo_proveedor ? `Prv: ${item.codigo_proveedor}` : null,
      item.codigo_maestro   ? `Bod: ${item.codigo_maestro}`   : null,
    ].filter(Boolean).join('   ·   ')
    if (!codigos) return
    const prevSize = doc.getFontSize()
    const prevFont = doc.getFont()
    doc.setFontSize(5.5)
    doc.setTextColor(120, 130, 150)
    doc.setFont('helvetica', 'normal')
    doc.text(codigos, data.cell.x + 3, data.cell.y + data.cell.height - 3.5)
    doc.setFontSize(prevSize)
    doc.setTextColor(...C.textMain)
    doc.setFont(prevFont.fontName, prevFont.fontStyle)
  },
})
```

- [ ] **Paso 4: Simplificar la sección de firma**

Reemplazar el bloque de firmas completo:

```ts
// --- SECCIÓN RESPONSABLE ---
const firmasStartY = tableEndY + 38
const signY = firmasStartY + 36 > H - 20
  ? (doc.addPage(), 45)
  : firmasStartY

doc.setFillColor(...C.bgLight)
doc.roundedRect(15, signY - 4, W - 30, 28, 2, 2, 'F')
doc.setDrawColor(...C.muted)
doc.setLineWidth(0.3)
doc.roundedRect(15, signY - 4, W - 30, 28, 2, 2, 'S')

doc.setFontSize(6.5)
doc.setTextColor(...C.textLight)
doc.setFont('helvetica', 'bold')
doc.text('RESPONSABLE', W / 2, signY + 2, { align: 'center' })

const lineY = signY + 16
const centerX = W / 2
doc.setDrawColor(...C.primary)
doc.setLineWidth(0.4)
doc.line(centerX - 50, lineY, centerX + 50, lineY)

doc.setFontSize(6.5)
doc.setTextColor(...C.textLight)
doc.setFont('helvetica', 'normal')
doc.text('GENERADO POR', centerX, lineY + 4, { align: 'center' })
doc.setTextColor(...C.textMain)
doc.setFont('helvetica', 'bold')
doc.text(
  (firma_solicitante_label || usuario_nombre).toUpperCase(),
  centerX, lineY + 9, { align: 'center' }
)
```

- [ ] **Paso 5: Actualizar el llamado a `exportarSolicitudPDF` en index.tsx**

Buscar donde se llama `exportarSolicitudPDF` en `frontend/src/pages/solicitudes-compra/index.tsx` y eliminar los campos `firma_autorizador_nombre` y `firma_autorizador_cargo` que ya no existen en la interfaz.

- [ ] **Paso 6: Build final y verificar**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|✓"
```

Resultado esperado: `✓ built in` sin errores TS.

- [ ] **Paso 7: Commit final**

```bash
cd ..
git add frontend/src/lib/solicitud-pdf.ts frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(pdf): 5 columnas, header dinámico, sección responsable simplificada"
```

---

## Verificación final del sistema

- [ ] Levantar el sistema completo: `./iniciar.ps1`
- [ ] Navegar a `/solicitudes-compra` — debe cargar sin errores de consola
- [ ] Verificar que `/kiosk` y `/qr` redirigen a `/` (catch-all route)
- [ ] Abrir recomendaciones — deben mostrar indicador de confianza en cada ítem
- [ ] Agregar ítems al carrito, presionar "Guardar solicitud" — debe aparecer en historial con estado `guardada`
- [ ] Exportar PDF desde el historial — debe tener 5 columnas y sección "RESPONSABLE"
- [ ] Ir a `/setup/importar-productos` — intentar subir CSV con columnas mínimas (`nombre`, `codigo_interno`, `unidad_base`)

---

## Checklist de spec vs plan

| Req. del spec | Tarea |
|---|---|
| Eliminar kiosk, modo-qr, qrcode, html5-qrcode | Tarea 2 |
| Eliminar endpoints revisar, en-camino | Tarea 3 |
| Eliminar CTE pendientes (reemplazado) | Tarea 10 |
| Migración: 2 estados borrador/guardada | Tarea 4 |
| Rename enviar → guardar | Tarea 5 |
| Actualizar frontend flujo guardar | Tarea 6 |
| Fix autoPlural (kites → kits) | Tarea 7 |
| Migración: ventana_consumo_dias, periodo_revision_dias | Tarea 8 |
| Exponer nuevos campos en /configuracion | Tarea 9 |
| Nuevo algoritmo de recomendaciones | Tarea 10 |
| Indicador de confianza en UI | Tarea 12 |
| Migración: drop solicitud_items | Tarea 13 |
| CSV: codigo_interno, proveedor auto-crear, importación parcial | Tarea 14 |
| PDF: 5 columnas, header dinámico, firma simplificada | Tarea 15 |
