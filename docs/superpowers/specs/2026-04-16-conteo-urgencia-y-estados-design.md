# Conteo — Urgencia Visible y Explicación de Estados — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Media
**Estado:** Propuesto

---

## Problema

En `frontend/src/pages/conteo/index.tsx`:

1. **Urgencia por área escondida.** La función `getAreaUrgencia` clasifica cada área por antigüedad del último conteo (según `conteo_frecuencia_dias` configurado en el área). El dato solo se renderiza dentro del modal de "Nueva sesión" al seleccionar áreas. Fuera del modal no hay forma de ver "qué áreas están atrasadas en conteo".
2. **Estados de sesión sin explicación.** Una sesión pasa `borrador → en_progreso → finalizada`. La UI muestra el estado como chip pero no explica qué implica cada uno (¿puedo agregar items en en_progreso? ¿se puede reabrir una finalizada?).

## Objetivo

- Desde la página principal de Conteo, se ven inmediatamente qué áreas están atrasadas y cuánto.
- El usuario entiende qué puede hacer en cada estado sin consultar documentación.

## Alcance

**Incluido:**
- Sección "Áreas pendientes" en el dashboard de Conteo (ya existe endpoint `GET /conteo/pendientes`; ver memory nota 2026-03-26).
- Cada área pendiente muestra urgencia (`hoy | esta semana | atrasada N días`).
- Leyenda/tooltip en el chip de estado explicando qué permite cada estado.
- Acción "Crear sesión aquí" por área pendiente (pre-selecciona el área).

**Fuera de alcance:**
- Cambiar el flujo de conteo ciego.
- Cambiar la configuración de `conteo_frecuencia_dias` (ya editable en áreas).

## Diseño propuesto

### UI

**Sección "Áreas pendientes de conteo":**

Ubicación: parte superior de `/conteo`, antes de la tabla de sesiones.

```
┌── Áreas pendientes ──────────────────────────────────────┐
│                                                          │
│  Hematología   atrasada 12 días    [+ Crear sesión]      │
│  Bioquímica    atrasada 3 días     [+ Crear sesión]      │
│  Microbiología vence mañana        [+ Crear sesión]      │
│                                                          │
│  5 áreas más al día — ocultar / ver todas                │
└──────────────────────────────────────────────────────────┘
```

- Orden: más atrasadas primero.
- Color: `atrasada` → rojo; `vence hoy/mañana` → amarillo; `al día` → oculto por default.
- Click en "+ Crear sesión": abre el modal existente con el área pre-seleccionada.

**Chip de estado con tooltip:**
- `borrador` → tooltip: `"Sesión creada pero no iniciada. Puedes editarla o eliminarla."`
- `en_progreso` → tooltip: `"Sesión activa. Se están registrando conteos."`
- `finalizada` → tooltip: `"Sesión cerrada. Los ajustes ya se aplicaron al stock."`

### Lógica

- Fetch a `GET /conteo/pendientes` al cargar la página.
- Cálculo de urgencia (ya existe en `getAreaUrgencia`): extraer a helper reutilizable si está en el modal.

## Archivos afectados

- `frontend/src/pages/conteo/index.tsx` (sección pendientes, tooltip estados)
- `frontend/src/pages/conteo/components/urgencia-helper.ts` (extraer `getAreaUrgencia`)

Sin cambios en backend.

## Criterios de aceptación

- [ ] La página de Conteo muestra "Áreas pendientes" al inicio con las atrasadas primero.
- [ ] Cada área pendiente tiene CTA "Crear sesión" que abre el modal con el área preseleccionada.
- [ ] El chip de estado tiene tooltip descriptivo.
- [ ] Si todas las áreas están al día, la sección muestra mensaje "Todas las áreas al día".

## Preguntas abiertas

- ¿Mostrar también áreas sin `conteo_frecuencia_dias` configurado (0)? → Excluirlas (0 = sin obligación de conteo periódico).
