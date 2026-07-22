# Technical Design: Expiration Alert & In-App Notifications

Technical approach, data structures, backend endpoints, and frontend components to support expiration warnings during product reception and notification center capability.

## Technical Approach

We will implement a backend-driven validation endpoint called on-the-fly from the reception UI with debouncing (~400ms). When a reception with expiration warnings is confirmed, we persist the warning state on the reception line detail and generate an in-app notification for all users with the `admin` role. The frontend queries unread counts periodically via React Query polling (~30s).

```
   [Frontend Input] ──(Debounce)──> POST /recepciones/validar-vencimiento
                                                  │
                                          (Forecast Query) ──> Calculate EWMA mu
                                                                     │
   [Confirmation] ────────────────> POST /recepciones/confirmar ◄────┘
                                                  │
                                      (Persist flag in DB)
                                                  │
                                                  ▼
                                    Fan-out Admin Notifications
```

## Architecture Decisions

| Area | Choice | Rationale |
| :--- | :--- | :--- |
| **Validation Location** | Backend-driven API | Keeps complex forecasting SQL queries and configuration checks on the server. |
| **Notification Engine** | HTTP Polling (30s) | Simple to implement, works over HTTP/HTTPS, avoids WebSocket/SSE infra complexity. |
| **Read State Storage** | Fan-out admin rows | Individual notification rows per admin makes querying and read state management trivial. |

## Data Flow

1. User modifies quantity or date in a reception item lot.
2. Frontend triggers debounced `POST /api/v1/recepciones/validar-vencimiento` if date and quantity are set.
3. Backend fetches current config, stock, and consumption series, calculates forecast demand via `forecast.rs` EWMA, and computes:
   $$\text{desperdicio} = \max(0, (\text{stock} + \text{cantidad}) - (\mu \times \text{dias\_vida\_util}))$$
4. Backend returns `desperdicio_proyectado` and `alerta_vencimiento` (true if lifespan < threshold OR waste > tolerance).
5. On confirmation, backend saves flags in `recepcion_detalle` and inserts records in `notificaciones` for admins.

## File Changes

| File | Action | Description |
| :--- | :--- | :--- |
| `backend/migrations/012_alerta_vencimiento_notificaciones.sql` | Create | Database schema updates (`notificaciones` table and `recepcion_detalle` fields). |
| `backend/src/dto/notificacion.rs` | Create | DTO structs for notification listings, unread count, and pagination. |
| `backend/src/services/notificacion_service.rs` | Create | Business logic to query, read, and create user notifications. |
| `backend/src/handlers/notificaciones.rs` | Create | Axum HTTP handlers for notification endpoints. |
| `backend/src/routes.rs` | Modify | Register `/api/v1/notificaciones` endpoints under auth middleware. |
| `backend/src/dto/configuracion.rs` | Modify | Expose the three new expiration alert settings keys. |
| `backend/src/services/configuracion_service.rs` | Modify | Load, validate, update, and audit log the new configurations. |
| `backend/src/dto/recepcion.rs` | Modify | Add `ValidarVencimientoInput` and `ValidarVencimientoResponse` payloads. |
| `backend/src/services/recepcion_service.rs` | Modify | Implement `validar_vencimiento` forecasting and trigger notifications on confirm. |
| `backend/src/handlers/recepciones.rs` | Modify | Register `POST /recepciones/validar-vencimiento` endpoint. |
| `frontend/src/components/layout/header.tsx` | Modify | Add notification bell component, fetch badge count, and render unread dropdown. |
| `frontend/src/pages/configuracion/index.tsx` | Modify | Render Expiration Alerts settings forms with constraints validation. |
| `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` | Modify | Execute debounced lot validation and submit `alerta_vencimiento` flags. |
| `frontend/src/pages/recepciones/components/item-card.tsx` | Modify | Render inline warnings inside lot cards with estimated waste. |

## Interfaces / Contracts

### Database Schema
```sql
ALTER TABLE public.recepcion_detalle 
  ADD COLUMN alerta_vencimiento boolean DEFAULT false NOT NULL,
  ADD COLUMN desperdicio_proyectado numeric(12,2) DEFAULT 0.0 NOT NULL;

CREATE TABLE public.notificaciones (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  titulo varchar(200) NOT NULL,
  mensaje text NOT NULL,
  tipo varchar(50) NOT NULL,
  leido boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX idx_notificaciones_usuario_leido ON public.notificaciones(usuario_id, leido);
CREATE INDEX idx_movimientos_lote_tipo ON public.movimientos(lote_id, tipo, created_at);
```

### Rust API DTOs
```rust
#[derive(Debug, Serialize, Type)]
pub struct NotificacionResponse {
    pub id: Uuid,
    pub usuario_id: Uuid,
    pub titulo: String,
    pub mensaje: String,
    pub tipo: String,
    pub leido: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Type)]
pub struct ValidarVencimientoInput {
    pub producto_id: Uuid,
    pub cantidad: Decimal,
    pub presentacion_id: Option<i32>,
    pub fecha_vencimiento: NaiveDate,
}
```

## Testing Strategy

| Layer | What to Test | Approach |
| :--- | :--- | :--- |
| **Unit** | Expiration Forecast Calculation | Test `calcular_alerta_vencimiento` with mock consumption series and configurations. |
| **Integration** | Settings validation & API endpoints | Validate `vencimiento_margen_tolerancia_pct` reject constraint (>100 or <0), check endpoints auth. |
| **E2E** | Lot warnings & notification polling | Confirm a reception with waste, verify notification bell increments, click read, verify count drops. |

## Migration / Rollout

- Run migration `012_alerta_vencimiento_notificaciones.sql`.
- Configuration defaults will initialize `vencimiento_alerta_activa = true`, `vida_util_minima = 30`, and `margen_tolerancia = 10` automatically when queried.
- Rollback: Revert migrations and frontend/backend files.

## Open Questions

- None.
