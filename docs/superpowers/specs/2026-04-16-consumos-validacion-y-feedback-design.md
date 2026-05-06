# Consumos — Validación de Lote y Feedback de Carga — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Alta
**Estado:** Propuesto

---

## Problema

Tres problemas en el flujo de registrar consumos (`frontend/src/pages/consumos/index.tsx`):

1. **Lotes cargan async sin feedback.** Al agregar un producto al carrito, el fetch de lotes disponibles (~líneas 113–125) corre sin estado visible. El usuario puede confirmar antes de que carguen y el selector de lote queda vacío o con un valor incorrecto.
2. **Sin validación frontend de stock por lote.** La cantidad ingresada en el drawer se envía al backend aunque supere el stock del lote seleccionado. El rechazo solo llega al confirmar el batch, lo que hace que se pierda el contexto del ítem con error.
3. **Carrito mezcla áreas sin advertir.** El filtro global de área en el header determina de dónde se descuenta. Si el usuario cambia el filtro mientras hay items en el carrito, no hay indicación de que los items existentes quedan "huérfanos" del área actual.

## Objetivo

Que el operador nunca confirme un consumo con datos ambiguos: lote cargado, cantidad válida contra stock real, y área consistente con los items del carrito.

## Alcance

**Incluido:**
- Skeleton/loader en selector de lote mientras carga.
- Botón "Confirmar consumo" deshabilitado hasta que todos los items del carrito tengan lote seleccionado.
- Validación `cantidad <= stock_disponible_lote` en el drawer, con mensaje inline y bloqueo de "Agregar".
- Badge por item indicando su área de origen; warning visible si el área global cambia y hay items de otras áreas.

**Fuera de alcance:**
- Cambiar el modelo de stock o el FEFO.
- Reemplazar el bottom drawer por otro componente.

## Diseño propuesto

### UI

**Selector de lote (consumo-drawer):**
- Estado `cargando_lotes: boolean` por item.
- Mientras `true`: select muestra "Cargando lotes…" con spinner, deshabilitado.
- Si devuelve vacío: "Sin lotes disponibles para esta área" + botón "Agregar" deshabilitado.

**Validación de cantidad:**
- Debajo del input de cantidad: `Stock disponible en lote: N <unidad>`.
- Si `cantidad > disponible`: borde rojo + texto `Excede stock del lote (máx N)`.
- Botón "Agregar" deshabilitado si inválido.

**Badge de área en items del carrito:**
- Cada card del carrito muestra chip compacto con el área de origen.
- Si el filtro global cambia y hay items con área diferente: banner amarillo sobre el carrito:
  `"Hay N items de otras áreas. Cambia el filtro o elimínalos antes de confirmar."`
- Botón "Confirmar" deshabilitado mientras exista desajuste.

### Lógica

- Al agregar item: disparar fetch de lotes con `loading=true`; habilitar "Agregar" solo tras respuesta.
- Al cambiar el lote seleccionado: recalcular `stock_disponible_lote` para validación inline.
- Al cambiar área global: marcar items del carrito con `area_origen !== area_global` como "desajustados"; mostrar banner.

## Archivos afectados

- `frontend/src/pages/consumos/index.tsx` (carga de lotes, estado carrito)
- `frontend/src/pages/consumos/components/consumo-drawer.tsx` (validación cantidad, skeleton lote)
- `frontend/src/pages/consumos/components/cart-item.tsx` (badge de área)

Sin cambios en backend.

## Criterios de aceptación

- [ ] Al agregar un producto, el selector de lote muestra loader visible y "Agregar" está deshabilitado hasta cargar.
- [ ] Ingresar cantidad mayor al stock del lote muestra error inline y bloquea "Agregar".
- [ ] Items del carrito muestran chip con su área.
- [ ] Cambiar el filtro de área con items en carrito muestra banner y deshabilita "Confirmar".
- [ ] El backend no recibe nunca un consumo con `cantidad > stock_lote`.

## Preguntas abiertas

- ¿Qué ocurre si un lote se agota entre carga y confirmación (otro usuario consumió)? → Propongo: dejar que el backend falle y mostrar el error del item puntual (fuera de este spec).
