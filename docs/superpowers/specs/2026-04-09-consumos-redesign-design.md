# Rediseño Página de Consumos

**Fecha:** 2026-04-09  
**Estado:** Aprobado  
**Branch objetivo:** feat/consumos-redesign

---

## Contexto y Problema

La página actual de consumos (`/consumos`) usa un layout de dos columnas (búsqueda + carrito lateral) heredado de interfaces de escritorio. Para el tecnólogo de laboratorio — que registra consumos de pie, con items en mano, de forma rápida — este layout presenta varios problemas:

- El escaneo (QR/HID) es un botón secundario pequeño, cuando debería ser la acción principal
- El carrito lateral siempre visible desperdicia espacio en la zona de búsqueda
- Los nombres ("Tanda de consumo", "Registrar tanda") son poco intuitivos
- El selector de lote siempre expandido genera ruido visual innecesario

## Usuario Objetivo

**Tecnólogo de laboratorio** registrando consumos durante su jornada. Características:
- Sabe qué va a consumir antes de abrir la página (tiene los items en mano o los conoce de memoria)
- Necesita rapidez: search → agregar → confirmar
- Usa lector HID USB o cámara QR del teléfono según contexto
- Ocasionalmente necesita elegir lote específico (si el item físico difiere del FEFO)

## Diseño

### Estructura General

Layout de **una sola columna**, eliminando el carrito lateral. El espacio completo se dedica a buscar y agregar. El registro de items vive en un **bottom drawer** (panel deslizante inferior).

```
┌────────────────────────────────────────────┐
│  Registrar consumo            [Área: ▼ ]   │
├────────────────────────────────────────────┤
│  🔍 Buscar o escanear código...   [📷 QR]  │
├────────────────────────────────────────────┤
│                                            │
│   [card]  [card]  [card]  [card]           │
│   [card]  [card]  [card]  [card]           │
│                                            │
├════════════════════════════════════════════╡
│  ↑  3 items · Confirmar consumo            │  ← drawer colapsado
└────────────────────────────────────────────┘
```

### Zona de Búsqueda y Escaneo

Input unificado que sirve como buscador de texto, receptor HID y disparador de cámara QR.

```
┌─────────────────────────────────────┬──────┐
│ 🔍  Buscar o escanear código...      │ [📷] │
└─────────────────────────────────────┴──────┘
```

**Comportamiento:**
- El input queda **enfocado automáticamente** al cargar la página (listo para HID)
- **HID**: el lector dispara el código → se agrega al instante sin presionar Enter (detectado por velocidad de escritura: si llega completo en <100ms, se trata como scan)
- **Cámara QR**: botón `[📷]` abre el overlay existente (`QrScanner`). Al leer → agrega y cierra
- **Texto manual**: mínimo 2 caracteres para buscar
- Tras agregar por cualquier vía: el input se **limpia y refocaliza** inmediatamente para el siguiente item

**Selector de área:** Se mueve al header (badge/select pequeño, discreto). No bloquea el flujo principal.

### Cards de Resultados

Grilla de **2 columnas**. Cada card es compacta.

```
┌──────────────────────┐  ┌──────────────────────┐
│ [img]  Guante Nitrilo│  │ [img]  Tubos EDTA    │
│        Hematología   │  │        Bioquímica     │
│        240 guantes   │  │        18 tubos       │
│                 [+]  │  │                 [✓]  │
└──────────────────────┘  └──────────────────────┘
```

**Estados:**
- **Normal**: borde neutro, botón `[+]`
- **Ya agregado**: borde primary, botón `[✓]`
- **Sin stock**: card desaturada, badge "Sin stock", sin botón
- **Al agregar**: flash verde breve en el card + contador del drawer se actualiza

**Stock**: siempre con `formatCantidad` — "240 guantes", "18 tubos", "1 reactivo".

**Estado vacío (sin búsqueda activa):** Muestra los **8 productos agregados más recientemente** por este usuario, almacenados en `localStorage` (clave `consumos_recientes_<userId>`). Si no hay historial local, muestra un empty state: "Escanea o busca un producto para comenzar".

### Bottom Drawer "Consumo a registrar"

**Colapsado** (invisible si no hay items):
```
╔══════════════════════════════════════════╗
║  ↑  3 items agregados   Confirmar consumo ║
╚══════════════════════════════════════════╝
```
- Aparece con animación `slide-up` al agregar el primer item
- Desaparece tras confirmar exitosamente

**Expandido** (tap en la barra o swipe up):
```
╔══════════════════════════════════════════╗
║  Consumo a registrar       ↓  [✕ vaciar] ║
╠══════════════════════════════════════════╣
║  Guante Nitrilo · Hematología             ║
║  Lote: FEFO automático       [elegir ▼]  ║
║  [−]  12 guantes  [+]              [🗑]  ║
╠──────────────────────────────────────────╣
║  Tubos EDTA · Bioquímica                  ║
║  Lote: FEFO automático       [elegir ▼]  ║
║  [−]   3 tubos    [+]              [🗑]  ║
╠══════════════════════════════════════════╣
║  Nota (opcional)...                       ║
║  [ Confirmar consumo ]                    ║
╚══════════════════════════════════════════╝
```

**Lote:** "FEFO automático" por defecto. `[elegir ▼]` despliega dropdown con lotes disponibles solo si el tecnólogo quiere sobreescribir. Muestra número de lote y fecha de vencimiento.

**Cantidades:** `formatCantidad` — "12 guantes", "3 tubos".

### Corrección de Nombres

| Texto actual | Texto nuevo |
|---|---|
| "Buscar producto (mín. 2 letras)..." | "Buscar o escanear código..." |
| "Tanda de consumo" | "Consumo a registrar" |
| "Registrar tanda" | "Confirmar consumo" |
| "Carrito" | *(eliminado)* |

---

## Archivos Afectados

- `frontend/src/pages/consumos/index.tsx` — reescritura completa del layout
- `frontend/src/pages/consumos/components/consumo-drawer.tsx` — nuevo componente (bottom drawer)
- `frontend/src/pages/consumos/components/producto-card.tsx` — nuevo componente (card de resultado)
- `frontend/src/pages/consumos/components/lote-selector.tsx` — nuevo componente (selector de lote inline)

La lógica de negocio (mutations, queries, tipos) no cambia. Solo el layout y los componentes visuales.

---

## Notas de Implementación

- El drawer usa `fixed bottom-0` para anclarse al viewport independientemente del scroll
- La detección de HID se implementa midiendo el tiempo entre keystrokes: si un código completo llega en <150ms, se procesa como scan directo
- Los productos recientes se almacenan en `localStorage` como array de `producto_id` (máx. 8, FIFO). Se actualiza tras cada confirmación exitosa. No requiere cambios en el backend.
- Las animaciones reutilizan `.animate-slide-up` ya definido en `index.css`
