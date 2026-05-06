# Índice — Mejoras Generales 2026-04-16

**Fecha:** 2026-04-16
**Origen:** análisis sección por sección del sistema (frontend + backend).
**Estado global:** Specs propuestos, pendientes de revisión.

---

## Resumen

Tras una revisión de las secciones del sistema, se identificaron problemas de orden lógico, UX inconsistente y oportunidades de mejora. Cada problema se documenta en un spec independiente. Los specs son autocontenidos: se pueden priorizar, aprobar e implementar por separado.

---

## Specs por prioridad

### Alta

| # | Spec | Sección |
|---|------|---------|
| 1 | [consumos-validacion-y-feedback](./2026-04-16-consumos-validacion-y-feedback-design.md) | Consumos |
| 2 | [solicitudes-restauracion-y-feedback](./2026-04-16-solicitudes-restauracion-y-feedback-design.md) | Solicitudes-Compra |
| 3 | [stock-filtros-y-accion-solicitud](./2026-04-16-stock-filtros-y-accion-solicitud-design.md) | Stock |

### Media

| # | Spec | Sección |
|---|------|---------|
| 4 | [recepciones-visibilidad-lotes](./2026-04-16-recepciones-visibilidad-lotes-design.md) | Recepciones |
| 5 | [descartes-warning-sanos](./2026-04-16-descartes-warning-sanos-design.md) | Descartes |
| 6 | [conteo-urgencia-y-estados](./2026-04-16-conteo-urgencia-y-estados-design.md) | Conteo |
| 7 | [creador-productos-arquitectura](./2026-04-16-creador-productos-arquitectura-design.md) | Creador-Productos |
| 8 | [navegacion-global-area-breadcrumb](./2026-04-16-navegacion-global-area-breadcrumb-design.md) | Navegación global |

### Baja

| # | Spec | Sección |
|---|------|---------|
| 9 | [backend-consistencia-rutas](./2026-04-16-backend-consistencia-rutas-design.md) | Backend |
| 10 | [cleanup-bundle-menores](./2026-04-16-cleanup-bundle-menores-design.md) | Varios (4 items) |

---

## Dependencias entre specs

- `stock-filtros-y-accion-solicitud` pre-pobla carrito de `solicitudes-compra` → si se implementa primero, el prefill quedará a medias hasta que solicitudes soporte `?prefill=`.
- `navegacion-global-area-breadcrumb` toca `descartes` (filtro área) → coordinar con el spec de descartes si se implementan en paralelo.
- `solicitudes-restauracion-y-feedback` asume la rama `feat/solicitudes-compra-redesign` fusionada.

Los demás son independientes.

---

## Mejoras menores

Agrupadas en [cleanup-bundle-menores](./2026-04-16-cleanup-bundle-menores-design.md):

- Dashboard: `producto_id` como key al mapear alertas.
- Usuarios: buscador en selector de áreas.
- Movimientos: detección de signo via `cantidad < 0`.
- Configuración: sección destacada para PIN de kiosko.

---

## Cómo usar este índice

1. Revisar el spec de mayor prioridad aprobado.
2. Crear un plan con `writing-plans` a partir del spec.
3. Implementar en rama independiente por spec.
4. Marcar el spec como `Implementado` en el encabezado al hacer merge.
