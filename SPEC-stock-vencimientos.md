# Especificaciones — Rediseño PDF, bugfix Áreas y alerta de vencimientos

Tres frentes acordados con decisiones de diseño tomadas (una pregunta por vez,
con benchmark contra la competencia). Este documento es la **especificación**,
no la implementación. Cada feature describe: problema, decisión + benchmark,
spec técnica (DB / backend / frontend), criterios de aceptación y no-goals.

**Estado de decisiones:** todas confirmadas por el usuario el 2026-06-22.

| # | Feature | Área | Prioridad | Alcance |
|---|---------|------|-----------|---------|
| 1 | Rediseño del PDF de stock (3 estados + monocromo) | Exportación PDF | 🟡 Media | Frontend (+ posible regen de tipos) |
| 2 | Bugfix: tab de Áreas se congela | Creador de productos | 🔴 Alta | Frontend (1 archivo) |
| 3 | Alerta de vencimiento no-consumible + módulo de notificaciones | Recepción / Config / Notificaciones | 🟢 Media-Alta | Full-stack (módulo nuevo) |

---

## Feature 1 — Rediseño del PDF de stock

### Problema
- Un insumo activo **sin stock** (`agotado`) aparece etiquetado como **"Stock Bajo"**.
  Causa raíz: `frontend/src/lib/stock-pdf.ts:82-91` (`getAlerta`) y `:125`
  (`itemsBajo`) meten `agotado` en el mismo balde que `critico`/`reponer`.
- El PDF usa el enum legado `estado_alerta` (de `fn_estado_stock`, migration 001),
  ignorando el **modelo de dos ejes** ya disponible (migration 002):
  `estado_cantidad` y `estado_vencimiento`, ortogonales.
- Estética: fondos de fila de color (rojo/ámbar claro), puntitos y pills de colores
  que el usuario rechaza. Pide algo **completamente sobrio**.

### Decisión + benchmark
1. **Taxonomía: tres estados separados** (`Sin stock` / `Stock bajo` / `Por vencer`).
   - *Benchmark:* Sortly/Cheqroom usan un único nivel genérico ("low"); los LIMS
     clínicos serios (LabWare, QBench) separan "out of stock" de "reorder" porque
     **la acción es distinta**: comprar YA vs planificar compra. Adoptamos lo segundo.
2. **Visual monocromo puro, cero color.** El estado se comunica por **tipografía**
   (peso/tamaño), no por color.
   - *Benchmark:* los exportables de Sortly/Quartzy se ven "de software" (coloridos);
     los reportes premium (estilo Stripe / informes médicos formales) son monocromos.
   - *Implicación obligatoria:* al quitar el color hay que **agregar una columna
     "Estado"** con texto; si no, el estado deja de ser legible.

### Spec técnica

**Fuente de datos (sin tocar backend si los tipos ya lo exponen):**
- Reemplazar el uso de `estado_alerta` por el modelo de dos ejes:
  - `Sin stock` ⟸ `estado_cantidad === 'agotado'`.
  - `Stock bajo` ⟸ `estado_cantidad ∈ {'critico','reponer'}`.
  - `Por vencer` ⟸ `estado_vencimiento ∈ {'riesgo_venc','por_vencer'}` (≤30 días para
    el resumen, igual que hoy).
  - `Vencidos` ⟸ `estado_vencimiento === 'vencido'` (KPI separado, ya existe).
- **Verificar** que `StockItem` (TS) exponga `estado_cantidad` / `estado_vencimiento` /
  `stock_usable`. El `StockItemRow` de Rust ya los tiene (`stock_service.rs:96-101`).
  Si `frontend/src/types/generated.ts` no los trae → regenerar con
  `cargo run --bin export_types`.

**`stock-pdf.ts` — cambios:**
- `getAlerta(item)` → devolver `'sin_stock' | 'bajo' | 'vencer' | null` usando los
  dos ejes (no `estado_alerta`).
- Resumen ejecutivo (`drawResumen`): el KPI strip pasa de 4 a **5 columnas**:
  `Insumos activos · Sin stock · Stock bajo · Por vencer 30d · Vencidos`. Recalcular
  `kpiW` y los separadores. Todos los números en negro/gris (sin `C.red`/`C.amber`).
- Columnas de alertas (`drawAlertCol`): quitar los círculos de color (`dotColor`) y
  los bordes de color; usar línea negra/gris fina. Mantener la lista, monocroma.
- Tabla por área (`drawAreaPage`):
  - **Agregar columna "Estado"** (texto). Estado por fila: `SIN STOCK` (negrita) /
    `Bajo` / `Por vencer` / `—`. Reajustar anchos de columna (hoy 8 columnas; sumar
    Estado y comprimir las menos críticas).
  - `didParseCell`: eliminar `fillColor` de color (`redLight`/`amberLight`) y
    `textColor` de color. El único recurso es **peso tipográfico** (bold para SIN STOCK).
  - Quitar las pills de color del encabezado de área (`amberLight`/`redLight`
    `roundedRect`): reemplazar por texto sobrio ("1 sin stock · 3 bajo · 2 por vencer").
- Paleta `C`: dejar solo grises/negro/blanco. Eliminar `red*`, `amber*`, `green*`
  del rendering (se pueden borrar o dejar sin uso).

### Criterios de aceptación
- [ ] Un insumo activo con `stock_usable = 0` aparece como **"Sin stock"**, nunca "Stock bajo".
- [ ] El resumen ejecutivo muestra 5 KPIs separados, todos monocromos.
- [ ] La tabla por área tiene columna **Estado** legible sin color.
- [ ] No queda ningún fondo de fila, punto, pill ni texto de color en el PDF.
- [ ] El PDF sigue generando bien con logo PNG transparente (no regresar #1 previo).

### No-goals
- No se toca la valorización ni la agrupación por categoría (ya cerradas).

---

## Feature 2 — Bugfix: tab de Áreas se congela 🔴

### Problema
Navegar a `/creador-productos?tab=areas` congela la pestaña.

### Causa raíz (confirmada)
`frontend/src/pages/creador-productos/areas-tab.tsx:82-92`:
```ts
const { data: productosArea = [] } = useQuery({ ..., enabled: !!configArea })
useEffect(() => { setProductosConfig(productosArea) }, [productosArea])
```
Con `configArea = null` la query está deshabilitada → `data` es `undefined` → el
default `= []` crea un **array nuevo en cada render**. El `useEffect([productosArea])`
ve una referencia nueva siempre → `setProductosConfig` → re-render → loop infinito.

### Spec técnica (fix)
- Quitar el default `= []` y guardar el efecto:
```ts
const { data: productosArea } = useQuery({ ..., enabled: !!configArea })
useEffect(() => {
  if (productosArea) setProductosConfig(productosArea)
}, [productosArea])
```
React Query mantiene una **referencia estable** de `data` entre renders cuando no
refetchea; `undefined` (estable) + el guard `if` cortan el loop. Donde se consume
`productosArea` para render, usar `productosArea ?? []`.

### Criterios de aceptación
- [ ] Entrar a `?tab=areas` y cambiar de tab no congela ni dispara renders infinitos.
- [ ] El modal "Stock por área" sigue cargando y guardando igual que antes.

### No-goals
- No rediseñar la tab; es solo el fix del loop.

---

## Feature 3 — Alerta de vencimiento no-consumible + módulo de notificaciones

### Problema
A veces llegan lotes con vencimiento próximo que **no se alcanzarán a consumir**
antes de vencer → desperdicio. Hoy nada lo advierte en la recepción.

### Decisiones + benchmark
1. **Detección híbrida** (velocidad de consumo + umbral fijo de respaldo).
   - *Benchmark:* la competencia usa regla fija de vida útil mínima ("≥6 meses",
     "85% de vida útil"); poquísimos cruzan velocidad real de consumo. Hacemos ambas.
2. **Aviso no bloqueante + registro** en la recepción (en vivo al cargar la línea).
   - *Benchmark:* farmacia a veces bloquea (cuarentena); Sortly solo muestra aviso
     pasivo sin traza. Elegimos el punto medio: avisar, dejar continuar, **registrar**.
3. **Configurable**: checkbox on/off + **umbral de vida útil mínima** + **margen de
   tolerancia %**.
   - *Benchmark:* el umbral lo exponen los sistemas de farmacia; el margen de
     tolerancia (perdonar excedentes mínimos) casi nadie lo tiene → diferenciador.
4. **Avisar al administrador = bandeja in-app (campanita) nueva.**
   - *Benchmark:* la mayoría solo deja registro interno; push real al responsable
     es raro y se valora. Construimos un **módulo de notificaciones reutilizable**
     (no solo para vencimientos), sembrado con este primer productor.

### Lógica de detección (núcleo)
Para una línea de recepción: producto `P`, cantidad entrante `Q` (en unidad base),
`fecha_vencimiento F`. `dias_hasta_venc = F − hoy`.

- **Con historial** (`dias_con_consumo ≥ dias_min_historia` y `consumo_diario > 0`):
  - `consumo_proyectado = consumo_diario_ajustado × dias_hasta_venc`
  - `desperdicio ≈ max(0, (stock_usable_actual + Q) − consumo_proyectado)`, **acotado a `Q`**.
    (Conservador y atribuible al lote entrante; respeta que FEFO consume primero lo
    más próximo a vencer — el stock que vence antes que `F` compite por el consumo.)
  - **Alertar si** `desperdicio > Q × (margen_tolerancia / 100)`.
- **Sin historial** (producto nuevo o `consumo_diario ≈ 0`):
  - **Alertar si** `dias_hasta_venc < vida_util_minima_dias`.
- La respuesta indica el `modo` usado (`'velocidad' | 'umbral'`), `unidades_desperdicio`
  estimadas y un `mensaje` listo para UI.

### Spec técnica — Base de datos
- **Config (tabla `configuracion`, clave/valor):** agregar a la whitelist de
  `configuracion_service.rs` y al struct de settings:
  - `vencimiento_alerta_activa` (bool, default `true`)
  - `vencimiento_vida_util_minima_dias` (int, default `90`)
  - `vencimiento_margen_tolerancia_pct` (int, default `10`)
- **Tabla `notificaciones`** (migración nueva `NNN_notificaciones.sql`):
  - `id UUID PK`, `tipo TEXT` (enum lógico, primer valor `'vencimiento_recepcion'`),
    `titulo TEXT`, `mensaje TEXT`, `payload JSONB` (ej. `{recepcion_id, producto_id,
    unidades_desperdicio}`), `destinatario_rol TEXT` (`'admin'`) o
    `destinatario_usuario_id UUID NULL`, `leida BOOLEAN DEFAULT false`,
    `recepcion_id UUID NULL` (FK trazabilidad), `created_at TIMESTAMPTZ DEFAULT now()`.
  - Índice por `(destinatario_rol, leida, created_at DESC)`.
- **Recepción:** registrar que una línea se recibió con alerta. Opción simple:
  columna `alerta_vencimiento BOOLEAN DEFAULT false` en `recepcion_detalle`
  (+ entrada en `audit_log`). La notificación cubre el push; esto cubre la traza.

### Spec técnica — Backend
- **Endpoint de validación (para el aviso en vivo):**
  `POST /recepciones/validar-vencimiento`
  body `{ producto_id, cantidad_base, fecha_vencimiento }` →
  `{ alerta: bool, modo: 'velocidad'|'umbral', unidades_desperdicio: number, mensaje: string }`.
  Vive en `recepcion_service.rs` (reglas + SQL). Lee `consumo_diario_ajustado`,
  `dias_con_consumo`, `stock_usable` del producto (mismo cálculo que stock) y la config.
  Respeta `vencimiento_alerta_activa` (si está off → `alerta: false` siempre).
- **Al confirmar recepción** con líneas marcadas: setear `alerta_vencimiento`, escribir
  `audit_log`, y **crear notificación** (`tipo='vencimiento_recepcion'`, destinatario
  rol `admin`) vía un `notificacion_service`.
- **Módulo de notificaciones** (`handlers/notificaciones.rs` + `services/notificacion_service.rs`):
  - `GET /notificaciones?solo_no_leidas=&page=` → lista paginada del rol del usuario.
  - `GET /notificaciones/conteo` → `{ no_leidas: number }`.
  - `POST /notificaciones/:id/leer` → marca leída.
  - `POST /notificaciones/leer-todas` → marca todas leídas.
  - Registrar rutas en `routes.rs`; DTOs en `dto/`. Seguir convención handler→service.

### Spec técnica — Frontend
- **Recepción** (componente de línea): al cambiar `fecha_vencimiento` o `cantidad`
  (debounce ~400ms), llamar a `/recepciones/validar-vencimiento`. Si `alerta`:
  mostrar bloque inline sobrio sobre la línea con `unidades_desperdicio` y el mensaje
  + acciones `[ Recibir igual ]` `[ Quitar ítem ]`. No bloquea la confirmación.
  Marcar la línea para enviar el flag al confirmar.
- **Configuración** (`pages/configuracion/index.tsx`): sección nueva con el checkbox
  `vencimiento_alerta_activa` + dos inputs numéricos (`vida_util_minima_dias`,
  `margen_tolerancia_pct`). Respetar reglas de selects/labels del CLAUDE.md (DaisyUI,
  fondos sólidos).
- **Campanita** (layout/header): ícono con badge de no-leídas (polling React Query,
  ~30–60s o `refetchInterval`), dropdown con la lista, click → marca leída y navega a
  la recepción relacionada. Solo visible para rol `admin` (destinatario actual).

### Criterios de aceptación
- [ ] Con la alerta activa, cargar un lote de vencimiento próximo con excedente sobre
      la tolerancia muestra el aviso inline con unidades estimadas correctas (modo velocidad).
- [ ] Un producto sin historial dispara el aviso si `dias_hasta_venc < umbral` (modo umbral).
- [ ] El aviso **no bloquea**: se puede "Recibir igual" y la recepción se confirma.
- [ ] Recibir con alerta deja traza (`recepcion_detalle.alerta_vencimiento` + `audit_log`)
      y crea una notificación para admin.
- [ ] La campanita muestra el conteo de no-leídas y permite marcarlas leídas.
- [ ] Con `vencimiento_alerta_activa = false`, no aparece ningún aviso ni notificación.
- [ ] La tolerancia funciona: un excedente por debajo del % configurado NO alerta.

### No-goals (primer slice)
- No surfacing del warning fuera de la recepción (dashboard/stock) — futuro.
- No canal WhatsApp/email para la notificación — la campanita in-app es el alcance.
- Notificaciones dirigidas por usuario individual (solo por rol `admin` por ahora).

### Diferenciadores vs competencia (resumen)
- **Predicción de desperdicio por velocidad de consumo** (no solo umbral de fecha).
- **Margen de tolerancia configurable** para no saturar de alertas triviales.
- **Aviso no bloqueante con traza + push in-app**, en vez de aviso pasivo que se ignora.
