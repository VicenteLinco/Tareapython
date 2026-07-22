# Tasks: Expiration Alert & In-App Notifications

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600-800 lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Database/Config) -> PR 2 (Backend Validation/Notifications) -> PR 3 (UI Configuration/Validation Warnings) -> PR 4 (UI Notification Bell) |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB Schema & Backend Config | PR 1 | Base branch: main. Includes migration and settings endpoints. |
| 2 | Validation & Notifications API | PR 2 | Base: PR 1 branch. Exposes forecasting and notification CRUD. |
| 3 | Config Form & Item Warnings | PR 3 | Base: PR 2 branch. Form validations and item warning cards. |
| 4 | Header Notification Bell | PR 4 | Base: PR 3 branch. Polling React Query integration in header. |

## Phase 1: Migration + Configurations Backend (PR 1)
- [x] 1.1 Create `backend/migrations/012_alerta_vencimiento_notificaciones.sql` to alter `recepcion_detalle` and create `notificaciones` table.
- [x] 1.2 Modify `backend/src/dto/configuracion.rs` to add settings keys (`vencimiento_alerta_activa`, `vencimiento_vida_util_minima_dias`, `vencimiento_margen_tolerancia_pct`).
- [x] 1.3 Update `backend/src/services/configuracion_service.rs` to load, validate, and update new settings.
- [x] 1.4 Write integration tests in `backend/tests/configuracion.rs` to verify validation constraints on new settings.

## Phase 2: Validation & Notifications Backend (PR 2)
- [x] 2.1 Create `backend/src/dto/notificacion.rs` for listing, count, and reading notifications payloads.
- [x] 2.2 Create `backend/src/services/notificacion_service.rs` for querying and creating notifications.
- [x] 2.3 Create `backend/src/handlers/notificaciones.rs` for notification CRUD endpoints.
- [x] 2.4 Register notification endpoints under auth middleware in `backend/src/routes.rs`.
- [x] 2.5 Modify `backend/src/dto/recepcion.rs` to define validation inputs and outputs.
- [x] 2.6 Modify `backend/src/services/recepcion_service.rs` to calculate forecasting waste and trigger notifications.
- [x] 2.7 Update `backend/src/handlers/recepciones.rs` to expose `POST /recepciones/validar-vencimiento`.
- [x] 2.8 Add unit tests in `backend/src/services/recepcion_service.rs` for `calcular_alerta_vencimiento` forecasting logic.

## Phase 3: Frontend Settings & Warning Card UI (PR 3)
- [x] 3.1 Modify `frontend/src/pages/configuracion/index.tsx` to render settings inputs with validation rules.
- [x] 3.2 Modify `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` to execute debounced verification.
- [x] 3.3 Modify `frontend/src/pages/recepciones/components/item-card.tsx` to render warnings with estimated waste.

## Phase 4: Notification Bell Component & Polling (PR 4)
- [x] 4.1 Modify `frontend/src/components/layout/header.tsx` to add notification bell, unread count badge, and polling queries.
- [x] 4.2 Verify E2E flow: trigger warning on reception confirmation, verify bell count increments, mark read, verify count decrements.
