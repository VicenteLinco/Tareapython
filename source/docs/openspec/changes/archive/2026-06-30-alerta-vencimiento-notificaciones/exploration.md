## Exploration: Alerta de Vencimiento No-Consumible + Módulo de Notificaciones

### Current State
Today, the system has no early-warning mechanism during reception to detect when incoming lots with short expiration dates cannot be fully consumed before they expire based on historical consumption patterns. The system only automatically discards expired items daily via `vencimientos_job.rs`. Additionally, there is no generic user notification module (like an in-app bell) to notify administrators of events such as incoming lots with potential waste.

### Affected Areas
- `backend/migrations/` — Create new migration file `012_alerta_vencimiento_notificaciones.sql` to add `alerta_vencimiento` to `recepcion_detalle` and create `notificaciones` table with index.
- `backend/src/dto/configuracion.rs` — Update `ConfiguracionResponse` and `UpdateConfiguracion` to expose new settings (`vencimiento_alerta_activa`, `vencimiento_vida_util_minima_dias`, `vencimiento_margen_tolerancia_pct`).
- `backend/src/services/configuracion_service.rs` — Parse, load, save, and audit log the three new configuration keys.
- `backend/src/dto/recepcion.rs` — Add request and response payloads for expiration validation.
- `backend/src/services/recepcion_service.rs` — Implement validation logic (`validar_vencimiento`) that calculates projected consumption and waste, and emit notifications upon reception confirmation.
- `backend/src/handlers/recepciones.rs` — Expose endpoint `POST /recepciones/validar-vencimiento`.
- `backend/src/dto/notificacion.rs` — Create new structs for list/page/conteo responses.
- `backend/src/services/notificacion_service.rs` — Create service to handle listing, counting, and reading notifications.
- `backend/src/handlers/notificaciones.rs` — Create endpoints for fetching, reading, and clearing notifications.
- `backend/src/routes.rs` — Register new notification endpoints under `/api/v1/notificaciones`.
- `backend/src/handlers/mod.rs` & `backend/src/services/mod.rs` & `backend/src/dto/mod.rs` — Register new modules.
- `frontend/src/pages/configuracion/index.tsx` — Add inputs to customize expiration alert status, lifespan threshold, and tolerance percentage.
- `frontend/src/components/layout/header.tsx` — Integrate notification bell with badge (with polling using React Query).
- `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` — Call backend validation endpoint on lot changes (with debounce) and pass the `alerta_vencimiento` flag during confirmation.
- `frontend/src/pages/recepciones/components/item-card.tsx` — Display the inline warning alert with the estimated waste units.

### Approaches
1. **Live Expiration Validation Endpoint (Backend-driven) vs. Client-side Forecast Estimation**
   - **Backend-driven Endpoint (`POST /recepciones/validar-vencimiento`)** — Expose a specific endpoint that queries EWMA/historical stats and returns validation results.
     - Pros: Keeps prediction logic and SQL queries on the backend; secure; reusable.
     - Cons: Requires an API call.
     - Effort: Medium
   - **Client-side Estimation** — Pull all historical transaction lists and compute EWMA/averages on the frontend.
     - Pros: No network requests on keypress (once data is loaded).
     - Cons: Massive data payload on client; duplicate calculation logic.
     - Effort: High

2. **In-app Notifications Polling vs WebSockets**
   - **React Query Polling (~30-60s interval)** — Periodically refetch the unread count endpoint `/notificaciones/conteo`.
     - Pros: Extremely simple; matches existing project state management; robust under poor network conditions.
     - Cons: Not instant (delayed by up to 30-60s).
     - Effort: Low
   - **WebSockets / Server-Sent Events (SSE)** — Establish persistent connections to push notifications instantly.
     - Pros: Real-time delivery.
     - Cons: Significant complexity added to Axum router and frontend connection hooks; requires heartbeat/reconnection logic.
     - Effort: High

### Recommendation
1. Use **Backend-driven Expiration Validation** since backend already contains complex SQL queries for consumption rates and inventory. We will use a debounced call (~400ms) on quantity/date changes to avoid spamming requests.
2. Use **React Query Polling** for the notification bell. It perfectly matches the simplicity of the app, reduces complexity, and delivers sufficient real-time feeling for lab administrators.

### Risks
- **Performance bottleneck on high concurrent receptions:** Validation query calculates consumption history on-the-fly. *Mitigation:* Ensure `movimientos` table has appropriate index on `(lote_id, tipo, created_at)`.
- **False Alert fatigue:** If a product has highly volatile consumption or seasonal shifts. *Mitigation:* The `vencimiento_margen_tolerancia_pct` allows filtering out small fluctuations, and the toggle `vencimiento_alerta_activa` allows disabling the feature entirely.

### Ready for Proposal
Yes. The requirements and technical routes are well-defined. The next phase should establish the proposal document.
