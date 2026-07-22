# Proposal: Expiration Alert & In-App Notifications

## Intent

Provide an early-warning mechanism during product reception to detect when incoming lots with short expiration dates cannot be fully consumed before they expire based on historical consumption patterns, and notify administrators using an in-app notification center.

## Scope

### In Scope
- Add migration `012_alerta_vencimiento_notificaciones.sql` (adds columns to `recepcion_detalle` and creates `notificaciones` table).
- Backend service logic to calculate projected consumption and waste, exposing endpoint `/recepciones/validar-vencimiento`.
- Backend notification CRUD service and endpoints under `/api/v1/notificaciones`.
- Frontend settings form fields to manage alert state, lifespan threshold, and tolerance percentage.
- Debounced frontend lot validation warning in item cards showing estimated waste units.
- In-app notification bell with unread badge and React Query polling.

### Out of Scope
- WebSockets/SSE real-time notification push.
- Automatic discarding of expired stock (handled by existing cron job).

## Capabilities

### New Capabilities
- `notificaciones`: For managing generic in-app notifications (listing, unread count, marking read, and clearing).

### Modified Capabilities
- `recepciones`: For adding expiration warnings during reception confirmation.
- `configuracion`: For adding settings keys (`vencimiento_alerta_activa`, `vencimiento_vida_util_minima_dias`, `vencimiento_margen_tolerancia_pct`).

## Approach

- Expose backend validation endpoint `POST /recepciones/validar-vencimiento` that queries transaction history to forecast consumption rates.
- Call backend validation from frontend using a debounced hook (~400ms) on quantity/date changes to prevent API spam.
- Implement React Query polling (~30s) in the notification bell component to fetch unread notification counts.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/migrations/` | New | SQL Migration to update `recepcion_detalle` and create `notificaciones` table. |
| `backend/src/dto/` | Modified | Add configuration settings, reception validation, and notification payloads. |
| `backend/src/services/` | Modified | Add forecasting calculation, save configuration settings, and notification service. |
| `backend/src/handlers/` | New/Modified | Axum endpoints for validation and notifications. |
| `frontend/src/` | New/Modified | Bell component, configuration page fields, and item card validation warning. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Forecasting database query performance | Low | Add index on `movimientos(lote_id, tipo, created_at)`. |
| Excessive warning alert fatigue | Med | Enable/disable toggle and tolerance margin percentage. |

## Rollback Plan

- Run down migration to drop `notificaciones` table and revert database schema updates.
- Revert git commits to restore backend and frontend source files.

## Dependencies

- PostgreSQL database with index optimization capability.

## Success Criteria

- [ ] Warn users in item cards about estimated waste units based on consumption.
- [ ] Save and load configuration settings successfully.
- [ ] Update notification bell count when a reception with waste is confirmed.
