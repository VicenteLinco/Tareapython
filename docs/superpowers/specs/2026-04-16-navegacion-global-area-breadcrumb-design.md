# Navegación Global — Filtro de Área Consistente y Breadcrumb — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Media
**Estado:** Propuesto

---

## Problema

1. **Filtro global de área aplica de forma inconsistente.** El `use-area-store` provee un filtro global que se usa en Stock, Recepciones (parcial), Consumos, Movimientos y Conteo. **No aplica** en Descartes ni en Solicitudes-Compra. El usuario que selecciona un área en el header asume que toda la app queda filtrada, pero ciertas secciones la ignoran.
2. **Sin breadcrumb en páginas con detalle.** Al entrar a `/recepciones/REC-000042`, `/stock/<id>`, `/conteo/<id>` o `/solicitudes-compra/<id>` el único "atrás" posible es el botón del navegador. Para usuarios nuevos, perder la referencia de dónde están es común.

## Objetivo

- Regla explícita y consistente sobre dónde aplica el filtro global de área.
- Breadcrumb visible en páginas con detalle.

## Alcance

**Incluido:**
- Documentar la regla y aplicarla en las secciones faltantes.
- Breadcrumb en páginas con rutas anidadas (`/seccion/id`).

**Fuera de alcance:**
- Añadir filtros por área adicionales (por ejemplo, multi-área simultánea).
- Cambiar el store `use-area-store`.

## Diseño propuesto

### Regla del filtro global de área

**Aplica cuando:** la sección opera sobre **stock existente** (listar, consumir, contar, transferir, descartar, ver movimientos).

**No aplica cuando:** la sección crea stock nuevo o toma decisiones que no son por área (recepciones que ingresan a un área destino explícita dentro del formulario; solicitudes de compra que son por proveedor, no por área).

**Tabla resultante:**

| Sección | Aplica filtro global | Razón |
|---------|----------------------|-------|
| Stock | Sí | Consulta de stock por área |
| Consumos | Sí | Descuenta del área actual |
| Movimientos | Sí | Historial por área |
| Conteo | Sí | Sesiones por área |
| **Descartes** | **Sí** (nuevo) | Descarta stock del área actual |
| Recepciones | No | El área destino se define en el formulario |
| Solicitudes-Compra | No | Agrupación por proveedor, no por área |
| Creador-Productos | No | Catálogos globales |
| Usuarios | No | Gestión global |

**Cambios requeridos:**
- **Descartes** debe suscribirse al filtro global y filtrar los lotes listados por área actual.
- En Recepciones y Solicitudes-Compra, el selector de área en el header debe mostrarse **deshabilitado con tooltip**: `"El filtro de área no aplica aquí."`

### Breadcrumb

**Ubicación:** header secundario debajo del header principal, solo en páginas con ruta anidada.

**Estructura:**
```
Inicio  ›  Recepciones  ›  REC-000042
Inicio  ›  Stock  ›  Producto X
Inicio  ›  Conteo  ›  Sesión #12
Inicio  ›  Solicitudes  ›  SOL-000008
```

**Comportamiento:**
- Cada segmento es link clicable, excepto el último (vista actual).
- "Inicio" siempre lleva a dashboard.
- Se genera automáticamente a partir de la ruta y un mapa de nombres legibles por segmento.

**Páginas sin breadcrumb:**
- Dashboard, páginas de primer nivel sin detalle (Usuarios, Configuración).

### Lógica

**Filtro global en Descartes:**
- `frontend/src/pages/descartes/index.tsx`: leer `areaSeleccionada` del store y usarla como filtro default del área en el formulario.

**Deshabilitar selector en secciones no aplicables:**
- `frontend/src/components/layout/header.tsx`: determinar si la ruta actual ignora el filtro (lista hardcoded por ahora); si sí, renderizar el select deshabilitado con tooltip.

**Breadcrumb component:**
- Nuevo componente `frontend/src/components/layout/breadcrumb.tsx`.
- Se alimenta de `useLocation` + mapa de segmentos:
```ts
const segmentLabels: Record<string, string> = {
  recepciones: 'Recepciones',
  stock: 'Stock',
  conteo: 'Conteo',
  'solicitudes-compra': 'Solicitudes',
  // ...
}
```
- Para segmentos dinámicos (IDs), leer el nombre del contexto de la página (via prop o store local).

## Archivos afectados

**Frontend:**
- `frontend/src/components/layout/header.tsx` (deshabilitar select según ruta)
- `frontend/src/components/layout/breadcrumb.tsx` (nuevo)
- `frontend/src/components/layout/app-shell.tsx` o similar (insertar breadcrumb)
- `frontend/src/pages/descartes/index.tsx` (suscribirse al filtro global)

Sin cambios en backend.

## Criterios de aceptación

- [ ] Descartes respeta el filtro global de área al listar lotes.
- [ ] En Recepciones y Solicitudes-Compra, el selector de área aparece deshabilitado con tooltip explicativo.
- [ ] Toda ruta con detalle anidado muestra breadcrumb funcional.
- [ ] "Inicio" en el breadcrumb siempre lleva a dashboard.
- [ ] Dashboard y páginas de primer nivel no muestran breadcrumb.

## Preguntas abiertas

- En kiosk/modo-qr, ¿el breadcrumb aplica o se oculta por diseño? → Ocultar (modos sin navegación libre).
