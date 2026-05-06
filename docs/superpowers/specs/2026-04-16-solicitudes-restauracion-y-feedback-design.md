# Solicitudes-Compra — Restauración de Borrador y Feedback de Horizonte — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Alta
**Rama relacionada:** `feat/solicitudes-compra-redesign`
**Estado:** Propuesto

---

## Problema

Dos problemas en `frontend/src/pages/solicitudes-compra/index.tsx`:

1. **Restauración de borrador frágil.** El borrador se carga en un `useEffect` (~línea 227) y el `pendingProveedorId` se aplica en otro `useEffect` separado (~línea 246). Entre ambos efectos hay una "dead zone" donde el estado parcial puede disparar renders intermedios, limpieza del carrito, o pérdida del proveedor seleccionado si el orden de ejecución varía.
2. **Horizonte global vs personalizado sin feedback.** Existe un chip global (7/15/30/90/180/365d) que recalcula todos los items, salvo aquellos con `horizonte_personalizado: true`. La distinción no se comunica: cambiar el global parece "no hacer nada" en items personalizados, confundiendo al usuario.

## Objetivo

- Restauración determinística y completa del borrador antes del primer render "usable".
- Al cambiar el horizonte global, el usuario sabe exactamente qué se recalculó y qué quedó intacto.

## Alcance

**Incluido:**
- Refactor de restauración: un único efecto que rehidrata borrador + proveedor + items en orden fijo.
- Estado `restaurando: boolean` que muestra un skeleton del layout hasta terminar.
- Toast/feedback al cambiar horizonte global.
- Indicador visual en items con horizonte personalizado ("pinned" o similar).

**Fuera de alcance:**
- Cambiar la lógica del algoritmo de horizonte por ítem (ya especificada en `2026-04-15-horizonte-cobertura-por-item-design.md`).
- Persistencia del borrador (ya existe).

## Diseño propuesto

### UI

**Skeleton de restauración:**
- Mientras `restaurando === true`: mostrar layout con placeholders grises en panel izquierdo, carrito y header.
- Duración esperada: <500ms en caso normal.

**Feedback al cambiar horizonte global:**
- Toast: `"Horizonte actualizado a Nd. M items recalculados, K items conservan su horizonte personalizado."`
- Si `K === 0`: omitir la segunda frase.
- Si `K === M + K`: toast dice solo `"Todos los items tienen horizonte personalizado. Cambia el pin por item para afectarlos."` (el global no tuvo efecto).

**Indicador de horizonte personalizado:**
- Pill del horizonte por item muestra un icono `📌` (o similar) cuando `horizonte_personalizado === true`.
- Tooltip: `"Horizonte pinneado — no se actualiza al cambiar el global"`.
- Acción "Resetear al global" en el popover.

### Lógica

**Restauración unificada:**

```ts
useEffect(() => {
  async function restaurar() {
    setRestaurando(true)
    const borrador = await api.get('/solicitudes-compra/borrador')
    if (!borrador) { setRestaurando(false); return }

    // Orden fijo: proveedor primero, luego carrito
    setProveedor(borrador.proveedor)
    setHorizonteGlobal(borrador.horizonte_global)
    setItems(borrador.items) // ya incluyen horizonte_personalizado
    setRestaurando(false)
  }
  restaurar()
}, []) // mount only
```

Eliminar el efecto separado de `pendingProveedorId`.

**Cambio de horizonte global:**

```ts
function onHorizonteGlobalChange(nuevo: number) {
  const recalculados = items.filter(i => !i.horizonte_personalizado)
  const conservados = items.length - recalculados.length

  setHorizonteGlobal(nuevo)
  setItems(items.map(i => 
    i.horizonte_personalizado 
      ? i 
      : { ...i, horizonte: nuevo, cantidad_sugerida: recalcular(i, nuevo) }
  ))

  toast.success(mensajeFeedback(nuevo, recalculados.length, conservados))
}
```

## Archivos afectados

- `frontend/src/pages/solicitudes-compra/index.tsx` (efectos + handler horizonte)
- `frontend/src/pages/solicitudes-compra/components/item-row.tsx` o similar (icono pin en pill)
- `frontend/src/pages/solicitudes-compra/components/solicitud-buscador.tsx` (si tiene el popover de horizonte)

Sin cambios en backend.

## Criterios de aceptación

- [ ] Recargar la página con borrador existente muestra skeleton y luego restaura proveedor + items + horizonte global sin estados intermedios visibles.
- [ ] Cambiar horizonte global muestra toast con el desglose correcto.
- [ ] Items con `horizonte_personalizado === true` muestran icono pin.
- [ ] Al cambiar el global, los items pinneados no cambian su cantidad sugerida.
- [ ] Opción "Resetear al global" en el popover limpia el flag y aplica el global actual.

## Preguntas abiertas

- ¿El backend ya expone `horizonte_personalizado` por item en el borrador restaurado? Verificar en `backend/src/dto/solicitud.rs`.
