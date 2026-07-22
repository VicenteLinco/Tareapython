# Implementation Progress: Expiration Alert & In-App Notifications

**Change**: alerta-vencimiento-notificaciones
**Mode**: Standard

### Completed Tasks
- [x] 1.1 Create `backend/migrations/012_alerta_vencimiento_notificaciones.sql` to alter `recepcion_detalle` and create `notificaciones` table.
- [x] 1.2 Modify `backend/src/dto/configuracion.rs` to add settings keys (`vencimiento_alerta_activa`, `vencimiento_vida_util_minima_dias`, `vencimiento_margen_tolerancia_pct`).
- [x] 1.3 Update `backend/src/services/configuracion_service.rs` to load, validate, and update new settings.
- [x] 1.4 Write integration tests in `backend/tests/configuracion.rs` to verify validation constraints on new settings.
- [x] 2.1 Create `backend/src/dto/notificacion.rs` for listing, count, and reading notifications payloads.
- [x] 2.2 Create `backend/src/services/notificacion_service.rs` for querying and creating notifications.
- [x] 2.3 Create `backend/src/handlers/notificaciones.rs` for notification CRUD endpoints.
- [x] 2.4 Register notification endpoints under auth middleware in `backend/src/routes.rs`.
- [x] 2.5 Modify `backend/src/dto/recepcion.rs` to define validation inputs and outputs.
- [x] 2.6 Modify `backend/src/services/recepcion_service.rs` to calculate forecasting waste and trigger notifications.
- [x] 2.7 Update `backend/src/handlers/recepciones.rs` to expose `POST /recepciones/validar-vencimiento`.
- [x] 2.8 Add unit tests in `backend/src/services/recepcion_service.rs` for `calcular_alerta_vencimiento` forecasting logic.
- [x] 3.1 Modify `frontend/src/pages/configuracion/index.tsx` to render settings inputs with validation rules.
- [x] 3.2 Modify `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` to execute debounced verification.
- [x] 3.3 Modify `frontend/src/pages/recepciones/components/item-card.tsx` to render warnings with estimated waste.
- [x] 4.1 Modify `frontend/src/components/layout/header.tsx` to add notification bell, unread count badge, and polling queries.
- [x] 4.2 Verify E2E flow: trigger warning on reception confirmation, verify bell count increments, mark read, verify count decrements.

### Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `backend/migrations/012_alerta_vencimiento_notificaciones.sql` | Created | Database schema updates (`notificaciones` table and `recepcion_detalle` fields). |
| `backend/src/dto/notificacion.rs` | Created | DTO structs for notification listings, unread count, and pagination. |
| `backend/src/services/notificacion_service.rs` | Created | Business logic to query, read, and create user notifications. |
| `backend/src/handlers/notificaciones.rs` | Created | Axum HTTP handlers for notification endpoints. |
| `backend/src/routes.rs` | Modified | Register `/api/v1/notificaciones` endpoints under auth middleware. |
| `backend/src/dto/configuracion.rs` | Modified | Expose the three new expiration alert settings keys. |
| `backend/src/services/configuracion_service.rs` | Modified | Load, validate, update, and audit log the new configurations. |
| `backend/src/dto/recepcion.rs` | Modified | Add `ValidarVencimientoInput` and `ValidarVencimientoResponse` payloads. |
| `backend/src/services/recepcion_service.rs` | Modified | Implement `validar_vencimiento` forecasting and trigger notifications on confirm. |
| `backend/src/handlers/recepciones.rs` | Modified | Register `POST /recepciones/validar-vencimiento` endpoint. |
| `backend/src/bin/export_types.rs` | Modified | Support exporting new structs and fixed compile type exports. |
| `backend/tests/configuracion_test.rs` | Created | Integration tests for configurations settings validation constraints. |
| `frontend/src/components/layout/header.tsx` | Modified | Add notification bell component, fetch badge count, and render unread dropdown. |
| `frontend/src/pages/configuracion/index.tsx` | Modified | Render Expiration Alerts settings forms with constraints validation. |
| `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` | Modified | Execute debounced lot validation and submit `alerta_vencimiento` flags. |
| `frontend/src/pages/recepciones/components/item-card.tsx` | Modified | Render inline warnings inside lot cards with estimated waste. |
| `frontend/src/types/generated.ts` | Modified | Regenerated TypeScript types from Rust. |

### Deviations from Design
None — implementation matches design.

### Issues Found
None.

### Remaining Tasks
None.

### Workload / PR Boundary
- Mode: size:exception
- Current work unit: N/A
- Boundary: Full change implementation completed in a single commit/PR batch.
- Estimated review budget impact: ~800 lines of additions/deletions.

### Status
17/17 tasks complete. Ready for verify.
