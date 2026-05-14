# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Inventario Laboratorio Clínico — CLAUDE.md

## Proyecto

Sistema de inventario para un laboratorio clínico. Un solo laboratorio, ~12 áreas, ~1500 insumos, 26 usuarios.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Rust + Axum 0.8 + SQLx 0.8 |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui |
| Base de datos | PostgreSQL 16 |
| Deploy | Docker Compose (VPS o intranet) |

## Comandos de desarrollo

```bash
# Levantar todo (DB + backend en Docker, frontend en host)
./iniciar.ps1          # Windows — inicia Docker Compose + npm run dev

# Solo backend (Docker)
docker compose up --build -d

# Solo frontend
cd frontend && npm run dev     # http://localhost:5173

# Compilar backend localmente
cd backend && cargo build

# Migraciones (se aplican automáticamente al iniciar el backend via sqlx migrate run)
# Archivos en: backend/migrations/

# Exportar tipos TypeScript desde Rust
cd backend && cargo run --bin export_types
```

## Estructura del proyecto

```
backend/
  src/
    auth/         # JWT (access 15min, refresh 24h) + modelos de sesión
    bin/          # Binarios auxiliares (export_types)
    dto/          # Estructuras de entrada/salida por módulo
    handlers/     # Un archivo por recurso HTTP
    middleware/   # Auth middleware
    models/       # Structs sqlx::FromRow (mapeo DB)
    services/     # Lógica de negocio (stock_ops FEFO, idempotency, recepcion_service)
    routes.rs     # Registro de todas las rutas
    main.rs       # Entrada principal
  migrations/     # SQL numerados (001…033), aplicación automática

frontend/
  src/
    components/   # UI reutilizable (layout, ui/shadcn)
    hooks/        # use-auth-store (Zustand), hooks de React Query
    lib/          # api.ts (Axios), utils, device-mode
    pages/        # Una carpeta por sección de la app
    types/        # generated.ts (desde export_types) + index.ts manual
```

## Arquitectura y patrones clave

### Backend

- **Ledger inmutable**: los movimientos de stock nunca se modifican ni eliminan. El stock se calcula desde snapshots + movimientos.
- **FEFO automático**: al consumir o descartar, `stock_ops.rs` selecciona lotes por fecha de vencimiento ascendente. No hay flag `agotado`; se filtra `WHERE cantidad > 0`.
- **Stock por lote + área**: la unidad de stock es `(lote_id, area_id)`, no `(presentacion_id, area_id)`.
- **Unidad base universal**: todas las cantidades en la DB están en la unidad base. Las presentaciones son multiplicadores (`factor_conversion`).
- **Draft mode en recepciones y solicitudes**: recursos pueden existir en estado `borrador` antes de confirmarse.
- **Idempotency keys**: en operaciones móviles/batch para prevenir duplicación. Longitud máxima en migration 024.
- **Optimistic locking**: columna `version` en tablas editables. Incrementar y verificar en updates.
- **Audit log**: tabla `audit_log` para cambios en catálogo.
- **Soft delete en catálogos**: migration 025 añade `deleted_at`. Filtrar `WHERE deleted_at IS NULL` en queries de catálogo.
- **Stock trigger**: migration 032 — hay un trigger en PostgreSQL que mantiene la tabla `stock` actualizada automáticamente a partir de movimientos. **Nunca insertar directamente en `stock`**; el trigger lo hace.
- **Roles fijos**: `admin`, `tecnologo`, `consulta`. No hay RBAC configurable.
- **Numeración de documentos**: formato `MOV-000001`, `REC-000001` (sin año, secuencias globales).

### Frontend

- **Estado global**: Zustand (`use-auth-store.ts`). React Query para datos del servidor.
- **Tipos generados**: `frontend/src/types/generated.ts` se genera con `cargo run --bin export_types`. No editar a mano.
- **API client**: `frontend/src/lib/api.ts` (Axios). Todos los calls pasan por ahí.
- **Filtro global de área**: en el header; afecta Stock, Recepciones, Consumos, Movimientos, Conteo.
- **Device mode**: `lib/device-mode.ts` — detecta si es escritorio, kiosk o móvil QR.

## Módulos del backend (handlers/)

| Handler | Descripción |
|---------|-------------|
| `auth_handler` | Login, refresh, me, cambiar-password |
| `usuarios` | CRUD usuarios |
| `areas` | CRUD áreas (incluye `conteo_frecuencia_dias`) |
| `categorias`, `unidades_basicas`, `proveedores` | Catálogos simples |
| `productos`, `presentaciones` | Catálogo de insumos |
| `recepciones` | Crear, confirmar, borrador, eliminar borrador |
| `consumos` | Individual FEFO + batch |
| `stock` | Listar, por área, alertas |
| `lotes` | Listar, detalle, buscar por código |
| `movimientos` | Listar paginado + detalle |
| `descartes` | Masivo |
| `conteo` | Sesiones de conteo ciego (migration 026) |
| `solicitudes_compra` | CRUD + aprobación + envios granulares por proveedor (migration 049) + forecast/recomendaciones |
| `configuracion` | Settings del sistema |
| `audit_log` | Listar paginado |
| `setup` | Importar CSV, finalizar carga inicial (pendiente) |

## Páginas del frontend (pages/)

- `login/` — autenticación
- `dashboard/` — resumen
- `creador-productos/` — tabs: categorías, productos, proveedores, áreas
- `recepciones/` — lista, nueva, detalle
- `consumos/` — registro de consumos
- `solicitudes-compra/` — CRUD de solicitudes; usa subcarpeta `components/` para piezas reutilizables dentro de la página
- `usuarios/` — gestión de usuarios
- `configuracion/` — settings
- `modo-qr/` — consumo por cámara (html5-qrcode)
- `kiosk/` — modo pantalla completa con lector HID

## Estado actual del proyecto

- Backend: ~97% implementado. Falta: módulo Setup (importar CSV, finalizar carga inicial). Tests: 0%.
- Frontend: implementación activa. Módulos completos: descartes (tabs), solicitudes-compra (multi-proveedor con envios granulares).
- Migraciones: 049 en total, aplicadas automáticamente.

## Convenciones

- Los archivos de migración van en `backend/migrations/` con nombre `NNN_descripcion.sql`.
- Nuevos endpoints siguen el patrón: handler en `handlers/`, ruta registrada en `routes.rs`, DTO en `dto/`.
- Al agregar campos nuevos a structs que se exportan a TypeScript, regenerar con `export_types`.
- Español para nombres de dominio (tablas, campos, rutas API), inglés para nombres de código Rust/TS.

### Reglas de visualización de cantidades y unidades (Frontend)

**Regla obligatoria:** Toda cantidad mostrada al usuario junto a una unidad debe usar `formatCantidad` de `@/lib/utils`. Nunca construir la etiqueta manualmente.

```ts
import { formatCantidad } from '@/lib/utils'

// ✅ Correcto
formatCantidad(qty, item.unidad_base_nombre, item.unidad_base_nombre_plural)
formatCantidad(qty, pres.nombre, pres.nombre_plural)

// ❌ Incorrecto — siempre muestra singular sin importar qty
`${qty} ${item.unidad_base_nombre}`

// ❌ Incorrecto — no respeta el caso singular
`${qty} ${qty === 1 ? nombre : nombre + 's'}`
```

**Comportamiento de `formatCantidad(qty, singular, plural?)`:**
- `qty === 1` exacto → usa `singular`
- `qty !== 1` → usa `plural` si existe, si no repite `singular` como fallback
- Cantidades enteras (ej: `5.0`) → se muestran como enteros (`5`), nunca con decimales superfluos
- Cantidades no enteras → máximo 2 decimales significativos

**Fuente de plural:** Siempre usar `nombre_plural` del backend (campo de DB). No existe función de plural automático — el plural se ingresa explícitamente en los formularios.

**`autoPlural` ha sido eliminado.** No usar ni reimplementar.

### Regla de buscadores con dropdown (Frontend)

**Regla obligatoria:** Todo input de búsqueda debe comportarse como autocomplete con dropdown navegable por teclado.

Comportamiento requerido:
- `↓` desde el input → abre el dropdown y mueve foco al primer ítem (circular)
- `↑` → sube en la lista (circular)
- `Enter` con ítem activo → selecciona ese ítem
- `Escape` → cierra dropdown, limpia búsqueda
- Click fuera → cierra dropdown
- Scroll automático al ítem activo en listas largas
- El dropdown respeta cualquier filtro de área u otro filtro activo en la página

El input nunca se deshabilita por una precondición externa; la validación va en `onSelect`.

El skill `autocomplete-buscador` detalla la implementación completa (estados, refs, ARIA, filtro inclusivo).
