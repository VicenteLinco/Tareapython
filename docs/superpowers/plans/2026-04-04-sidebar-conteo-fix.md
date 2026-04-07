# Sidebar Reagrupación + Conteo Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reagrupar las pestañas del sidebar en grupos lógicos (Consulta / Operaciones / Compras) y corregir el bug del conteo donde la confirmación aplica un delta sobre un snapshot desactualizado en lugar de usar el conteo físico como fuente de verdad.

**Architecture:** Dos cambios independientes. El sidebar es puramente frontend: se agregan separadores con etiquetas de sección en `sidebar.tsx`. El fix del conteo es puramente backend: en `conteo_service.rs`, la query de confirmación cambia de `stock.cantidad + diferencia` a `cant_fisica` directamente. Sin migraciones, sin cambios de API.

**Tech Stack:** React + TypeScript (sidebar), Rust + SQLx + PostgreSQL (conteo fix).

---

## Files

- Modify: `frontend/src/components/layout/sidebar.tsx` — reestructurar `navItems` en grupos con separadores
- Modify: `backend/src/services/conteo_service.rs:236-246` — cambiar lógica de UPDATE en `confirmar_sesion`

---

### Task 1: Reagrupar el sidebar en secciones con etiquetas

**Files:**
- Modify: `frontend/src/components/layout/sidebar.tsx`

El sidebar actual tiene un array plano `navItems`. Lo reemplazamos por grupos con separador y etiqueta, igual al patrón que ya existe para `adminItems`.

- [ ] **Step 1: Leer el archivo actual**

Abrir `frontend/src/components/layout/sidebar.tsx` y confirmar que `navItems` es un array plano (líneas 26-35).

- [ ] **Step 2: Reemplazar `navItems` por grupos**

Eliminar la constante `navItems` (líneas 26-35) y reemplazarla con esta estructura:

```typescript
const navGroups = [
  {
    label: null, // sin etiqueta para el primero
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Consulta',
    items: [
      { to: '/stock', icon: Package, label: 'Inventario' },
      { to: '/movimientos', icon: History, label: 'Movimientos' },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { to: '/consumos', icon: ClipboardList, label: 'Consumos' },
      { to: '/descartes', icon: Trash2, label: 'Descartes' },
      { to: '/conteo', icon: ClipboardCheck, label: 'Conteo' },
    ],
  },
  {
    label: 'Compras',
    items: [
      { to: '/recepciones', icon: ArrowDownToLine, label: 'Recepciones' },
      { to: '/solicitudes-compra', icon: ShoppingCart, label: 'Solicitudes' },
    ],
  },
]
```

- [ ] **Step 3: Actualizar el JSX del `<nav>` para iterar sobre `navGroups`**

Reemplazar el bloque `<div className="space-y-0.5">` que itera `navItems` (dentro de `<nav>`) con:

```tsx
{navGroups.map((group, i) => (
  <div key={i}>
    {i > 0 && <div className="my-3 mx-2 h-px bg-base-200" />}
    {group.label && (
      <p className={cn(
        'px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest opacity-40 transition-all duration-300',
        expanded ? 'opacity-40' : 'opacity-0'
      )}>
        {group.label}
      </p>
    )}
    <div className="space-y-0.5">
      {group.items.map((item) => (
        <SidebarLink key={item.to} {...item} expanded={expanded} />
      ))}
    </div>
  </div>
))}
```

El bloque de `adminItems` (más abajo, después del `<div className="my-3 mx-2 h-px bg-base-200" />`) permanece igual.

- [ ] **Step 4: Verificar en el navegador**

Abrir la app. El sidebar debe mostrar:
- Dashboard (sin etiqueta de grupo)
- separador + "Consulta" → Inventario, Movimientos
- separador + "Operaciones" → Consumos, Descartes, Conteo
- separador + "Compras" → Recepciones, Solicitudes
- separador + "Admin" → (solo visible para admin)

Las etiquetas de sección deben desaparecer cuando el sidebar está colapsado (ya lo maneja la clase `opacity-0`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/sidebar.tsx
git commit -m "feat(sidebar): reagrupar pestañas en Consulta / Operaciones / Compras"
```

---

### Task 2: Corregir la lógica de confirmación del conteo

**Files:**
- Modify: `backend/src/services/conteo_service.rs` (función `confirmar_sesion`, líneas ~230-246)

**El bug:** Al confirmar, el código calcula `diferencia = cant_fisica - stock_sis` (donde `stock_sis` es el snapshot capturado al crear la sesión) y aplica `stock.cantidad + diferencia`. Si entre la creación de la sesión y la confirmación hubo movimientos (consumos, etc.), `stock.cantidad` ya cambió pero `stock_sis` es viejo, por lo que el delta produce un resultado incorrecto.

**La fix:** El conteo físico es la fuente de verdad. En lugar de aplicar el delta, SET la cantidad directamente a `cant_fisica`.

- [ ] **Step 1: Localizar la query de actualización de stock en `confirmar_sesion`**

En `backend/src/services/conteo_service.rs`, buscar el INSERT ON CONFLICT dentro del loop `for (lote_id, stock_sis, cant_fisica) in items_discrepancia`. Actualmente se ve así (líneas ~236-246):

```rust
sqlx::query(
    r#"INSERT INTO stock (lote_id, area_id, cantidad)
       VALUES ($1, $2, GREATEST(0, $3))
       ON CONFLICT (lote_id, area_id)
       DO UPDATE SET cantidad = GREATEST(0, stock.cantidad + $4), updated_at = NOW()"#,
)
.bind(lote_id)
.bind(area_id)
.bind(cant_fisica)
.bind(diferencia)
.execute(&mut *tx)
.await?;
```

- [ ] **Step 2: Cambiar la query para usar el conteo físico como valor absoluto**

Reemplazar esa query por:

```rust
sqlx::query(
    r#"INSERT INTO stock (lote_id, area_id, cantidad)
       VALUES ($1, $2, GREATEST(0, $3))
       ON CONFLICT (lote_id, area_id)
       DO UPDATE SET cantidad = GREATEST(0, $3), updated_at = NOW()"#,
)
.bind(lote_id)
.bind(area_id)
.bind(cant_fisica)
.execute(&mut *tx)
.await?;
```

Notar que:
- Se eliminó el `.bind(diferencia)` (ya no se usa $4)
- `DO UPDATE SET cantidad = GREATEST(0, $3)` usa `cant_fisica` directamente en lugar del delta

- [ ] **Step 3: Eliminar el cálculo de `diferencia` si quedó sin usar**

Verificar si la variable `diferencia` sigue usándose en otro lugar del mismo bloque. Solo se usaba para:
1. Determinar el tipo de ajuste (`AJUSTE_POSITIVO` / `AJUSTE_NEGATIVO`) — sigue siendo necesaria
2. Calcular `cant_mov` — sigue siendo necesaria

Por tanto `diferencia` y `cant_mov` se mantienen. Solo se eliminó su uso en la query de stock.

El bloque completo del loop debe quedar así:

```rust
for (lote_id, stock_sis, cant_fisica) in items_discrepancia {
    let diferencia = cant_fisica - stock_sis;
    let tipo = if diferencia > Decimal::ZERO { "AJUSTE_POSITIVO" } else { "AJUSTE_NEGATIVO" };
    let cant_mov = diferencia.abs();

    sqlx::query(
        r#"INSERT INTO stock (lote_id, area_id, cantidad)
           VALUES ($1, $2, GREATEST(0, $3))
           ON CONFLICT (lote_id, area_id)
           DO UPDATE SET cantidad = GREATEST(0, $3), updated_at = NOW()"#,
    )
    .bind(lote_id)
    .bind(area_id)
    .bind(cant_fisica)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, nota)
           SELECT $1, $2, $3, $4, $5, s.cantidad, $6, 'conteo', $7
           FROM stock s WHERE s.lote_id = $2 AND s.area_id = $3"#,
    )
    .bind(grupo_movimiento)
    .bind(lote_id)
    .bind(area_id)
    .bind(tipo)
    .bind(cant_mov)
    .bind(usuario_id)
    .bind(nota.as_deref())
    .execute(&mut *tx)
    .await?;

    ajustes_cont += 1;
}
```

- [ ] **Step 4: Compilar el backend**

```bash
cd backend
cargo build
```

Resultado esperado: compilación exitosa sin errores ni warnings sobre variables sin usar.

- [ ] **Step 5: Verificar el comportamiento manualmente**

Escenario de prueba:
1. Crear sesión de conteo para un área → snapshot captura stock = 100 para un lote
2. Consumir 80 unidades de ese lote fuera del conteo → stock actual = 20
3. Volver a la sesión de conteo, ingresar `cantidad_contada = 20`
4. Confirmar la sesión
5. Verificar en `/stock` que el stock del lote sigue siendo 20 (no 0 ni negativo)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/conteo_service.rs
git commit -m "fix(conteo): usar conteo físico como fuente de verdad al confirmar, no delta sobre snapshot"
```

---

## Notas adicionales

- El campo `stock_sistema` en `conteo_items` sigue siendo útil: muestra al técnico la discrepancia entre lo que el sistema esperaba y lo que encontró físicamente. No cambia.
- La variable `diferencia` se mantiene porque determina el tipo de movimiento registrado (AJUSTE_POSITIVO/NEGATIVO) y la cantidad registrada en el audit trail. Solo se elimina su uso para modificar el stock.
- No hay migraciones ni cambios de API en este plan.
