# Creador-Productos — Arquitectura Unificada — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Media
**Estado:** Propuesto

---

## Problema

En `frontend/src/pages/creador-productos/`:

La página hoy tiene una barra superior con botones para catálogos menores (categorías, unidades, proveedores, áreas) que **abren modal**, y una pestaña "Productos" que se muestra como **contenido principal de la página**. Esto genera dos problemas:

1. **Inconsistencia mental.** Productos es el catálogo más importante, pero tiene un patrón distinto al resto. Un usuario que aprende a editar Categorías (en modal) puede confundirse cuando entra a Productos.
2. **Fricción en trabajo cruzado.** Editar un producto requiere permanecer en la vista de productos; al mismo tiempo, crear una categoría nueva abre modal y se cierra. Sin una regla consistente, la productividad es errática.

## Objetivo

Elegir y aplicar una arquitectura uniforme para todos los catálogos de esta página.

## Alcance

**Incluido:**
- Decisión de arquitectura + refactor de la página.
- Mantener todas las capacidades CRUD actuales.

**Fuera de alcance:**
- Cambiar los formularios de edición por dentro.
- Añadir nuevos catálogos.

## Diseño propuesto

### Opciones evaluadas

**Opción A — Todos los catálogos como tabs (preferida):**
- Tabs fijos: `Productos | Categorías | Unidades | Proveedores | Áreas`.
- Cada tab es una vista completa (lista + buscador + acción "Nuevo").
- Edición/creación sigue en modal (pero abierto desde dentro del tab, no desde una barra global).

Ventajas:
- Consistencia total.
- Productos (el más usado) sigue siendo la vista por defecto.
- El usuario tiene un patrón único: "elijo tab → veo lista → edito/creo".

Desventajas:
- Más scroll/navegación cuando se crean catálogos auxiliares mientras se edita un producto.

**Opción B — Todos en modal:**
- Página principal solo es hub con 5 botones grandes (como hoy la barra superior).
- Productos también pasa a modal.

Ventajas:
- Simetría estricta.

Desventajas:
- Productos se usa mucho; obligar a abrir un modal para verlo es paso de más.
- Modales grandes (lista + formulario) son menos cómodos que páginas.

**Opción C — Todos como sub-páginas (una ruta por catálogo):**
- `/creador/productos`, `/creador/categorias`, etc.
- Sidebar del creador o tabs.

Ventajas:
- URLs compartibles.

Desventajas:
- Más navegación entre páginas.
- Rompe el flujo actual más que las otras opciones.

### Recomendación

**Opción A — Tabs.** Es la que menos fricción genera al usuario existente y la más barata de implementar.

### UI propuesta

```
┌──────────────────────────────────────────────────────────┐
│ Creador de catálogos                                     │
│                                                          │
│ [Productos] Categorías  Unidades  Proveedores  Áreas     │
│ ─────────                                                │
│                                                          │
│  [Buscador]  [+ Nuevo producto]                          │
│                                                          │
│  Tabla de productos...                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- Tabs en lugar de botones.
- "Productos" seleccionado por defecto.
- Cada tab muestra su propia tabla y acciones.
- Persistir el tab activo en query param (`?tab=categorias`) para enlaces desde dashboard/atajos.

### Lógica

- Mantener los componentes existentes (`productos-tab.tsx`, `categorias-modal.tsx`, etc.).
- Convertir los modales de catálogos auxiliares a vistas tab (su contenido actual — lista + acción — pasa a ser la vista del tab).
- La creación/edición puntual sigue en modal dentro de cada tab.

## Archivos afectados

- `frontend/src/pages/creador-productos/index.tsx` (layout principal)
- `frontend/src/pages/creador-productos/categorias-tab.tsx` (nuevo, contenido del modal actual)
- `frontend/src/pages/creador-productos/unidades-tab.tsx` (nuevo)
- `frontend/src/pages/creador-productos/proveedores-tab.tsx` (nuevo)
- `frontend/src/pages/creador-productos/areas-tab.tsx` (ya existe como tab/modal — ajustar)
- `frontend/src/pages/creador-productos/productos-tab.tsx` (mantener)

Los componentes de formulario de edición (modales de detalle/creación) se mantienen como están.

## Criterios de aceptación

- [ ] La página tiene 5 tabs: Productos, Categorías, Unidades, Proveedores, Áreas.
- [ ] Productos es el tab por defecto.
- [ ] Cada tab tiene su propia vista con lista + acción "Nuevo" + búsqueda.
- [ ] La edición/creación puntual sigue en modal.
- [ ] El tab activo se persiste en query param.
- [ ] Las capacidades CRUD actuales no se pierden.

## Preguntas abiertas

- ¿El admin es el único que edita todos? Si `tecnologo` solo ve productos y algunas áreas, los tabs ocultos según rol deberían listarse explícitamente en este spec. → Verificar con backend: `GET /categorias` requiere admin? Ajustar permisos de tabs según roles.
