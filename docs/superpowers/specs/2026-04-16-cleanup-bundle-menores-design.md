# Cleanup Bundle — Mejoras Menores — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Baja
**Estado:** Propuesto

---

## Resumen

Conjunto de 4 mejoras menores detectadas en el análisis del 2026-04-16 que no justifican specs individuales. Se agrupan para ser implementadas en un solo PR pequeño de limpieza.

Cada item es independiente; se puede descartar cualquiera sin afectar los demás.

---

## Items

### 1. Dashboard — key estable al mapear alertas

**Archivo:** `frontend/src/pages/dashboard/index.tsx`

**Problema:** Las alertas agrupadas por `producto_id` se renderizan usando el índice del grupo como `key`. Si la lista de alertas cambia (polling, refresh), React puede reusar nodos con estado desalineado.

**Cambio:** Usar `producto_id` como `key`.

```tsx
// antes
{grupos.map((g, i) => <AlertaCard key={i} ... />)}

// después
{grupos.map((g) => <AlertaCard key={g.producto_id} ... />)}
```

**Criterio de aceptación:**
- [ ] Las tarjetas de alertas usan `producto_id` como key.
- [ ] Un refresh de alertas no provoca desajustes visuales.

---

### 2. Usuarios — buscador en selector de áreas

**Archivo:** `frontend/src/pages/usuarios/` (modal de edición).

**Problema:** La asignación de áreas a un usuario se hace con un panel scrollable de checkboxes. Con 12 áreas actuales es tolerable; con 20+ se vuelve tedioso.

**Cambio:** Input de texto encima del listado que filtra áreas por nombre (client-side, case-insensitive).

```tsx
const [busqueda, setBusqueda] = useState('')
const filtradas = areas.filter(a => 
  a.nombre.toLowerCase().includes(busqueda.toLowerCase())
)
```

UI:
- Input `Buscar área…` encima del listado.
- Si la búsqueda no coincide con ninguna: mensaje `Sin áreas que coincidan`.
- Al limpiar el input, vuelve el listado completo.

**Criterio de aceptación:**
- [ ] El modal de edición de usuario tiene input de búsqueda sobre el listado de áreas.
- [ ] El filtro es case-insensitive y en tiempo real.
- [ ] Las áreas ya marcadas se mantienen seleccionadas aunque se filtren (aunque no se vean).

---

### 3. Movimientos — detección de signo simplificada

**Archivo:** `frontend/src/pages/movimientos/index.tsx` (o similar)

**Problema:** La UI detecta si un movimiento es "negativo" con una whitelist:
```ts
const esNegativo = ['salida', 'descarte', 'ajuste_neg'].includes(mov.tipo)
```

Esto es frágil: si aparece un nuevo tipo que resta (ej: `transferencia_salida`), hay que acordarse de añadirlo. El dato ya está en `cantidad` (que es negativa en esos casos si el modelo lo refleja).

**Cambio:** Verificar si `cantidad < 0` basta. Si sí:
```ts
const esNegativo = mov.cantidad < 0
```

Si el modelo guarda siempre `cantidad > 0` y el signo está solo implícito en `tipo`, **entonces no cambiar**: la whitelist es necesaria. En ese caso, documentar arriba de la constante por qué.

**Criterio de aceptación:**
- [ ] Verificar en `backend/src/models/` si `cantidad` puede ser negativa.
- [ ] Si puede: cambiar a `cantidad < 0` y eliminar whitelist.
- [ ] Si no puede: añadir comentario explicando la whitelist y listar todos los tipos que restan.

---

### 4. Configuración — destacar PIN de kiosko

**Archivo:** `frontend/src/pages/configuracion/index.tsx`

**Problema:** El PIN que protege el modo kiosko está en la página de Configuración junto a otros settings. Si es olvidado o mal seteado, se pierde el acceso. Actualmente no tiene tratamiento visual especial.

**Cambio:**
- Agrupar "Seguridad kiosko" en su propia sección con encabezado claro.
- Junto al input: texto explicativo `"Este PIN se pide al salir del modo kiosko. Si lo olvidas, un admin puede resetearlo desde aquí."`
- Mostrar un indicador de "PIN configurado ✓" vs "PIN no configurado ⚠" para que el admin sepa el estado sin revelar el valor.

**Criterio de aceptación:**
- [ ] Sección "Seguridad kiosko" visible en Configuración.
- [ ] Indicador de estado visible sin exponer el PIN.
- [ ] Texto explicativo acompaña el input.

---

## Archivos afectados (totales)

- `frontend/src/pages/dashboard/index.tsx`
- `frontend/src/pages/usuarios/` (modal edición)
- `frontend/src/pages/movimientos/index.tsx`
- `frontend/src/pages/configuracion/index.tsx`
- `backend/src/models/movimiento.rs` (solo verificación, sin cambios necesariamente)

Sin migraciones. Sin cambios de API.

## Preguntas abiertas

Ninguna significativa. Cada item es autocontenido y reversible.
