# Archive Report: Expiration Alert & In-App Notifications

## Details
- **Change Name**: `alerta-vencimiento-notificaciones`
- **Archive Date**: 2026-06-30
- **Status**: Completed & Archived

## Executive Summary
This change introduces an early-warning mechanism during product reception to detect when incoming lots with short expiration dates cannot be fully consumed before they expire based on historical consumption patterns, and alerts administrators via an in-app notification center.

The implementation successfully covered:
1. Database schema migration with columns added to `recepcion_detalle` and a new `notificaciones` table.
2. Expiration alert configuration options with backend validation rules and a React configuration page.
3. Expiration forecast calculation endpoint (`POST /recepciones/validar-vencimiento`) in the backend using historical consumption rates.
4. Notifications service, handlers, and endpoints to manage CRUD, reading, and clearing notifications.
5. Frontend lot warning cards in reception lines using a debounced hook to prevent excessive validation requests.
6. A notification bell component in the header that displays unread counts, list of notifications, and lets admins mark them as read or clear them.

All development, verification, and testing phases passed successfully.

## Verification Verdict
The change was verified with a final status of **PASS**. All tests compiled and passed:
- **Backend**: `cargo test` passed with 58 unit tests and 123 integration tests (181 tests in total).
- **Frontend**: `npm run build` compiled for production successfully. `npm run test` ran and passed all 59 vitest test cases.

## Specs Synchronized
The following specifications from the change have been merged into the main spec repository under [openspec/specs/](file:///home/vdev/desarrollo/Inventariomarzo-final/openspec/specs/):
1. **Configuration Specification**: [openspec/specs/configuracion/spec.md](file:///home/vdev/desarrollo/Inventariomarzo-final/openspec/specs/configuracion/spec.md)
2. **Notifications Specification**: [openspec/specs/notificaciones/spec.md](file:///home/vdev/desarrollo/Inventariomarzo-final/openspec/specs/notificaciones/spec.md)
3. **Receptions Specification**: [openspec/specs/recepciones/spec.md](file:///home/vdev/desarrollo/Inventariomarzo-final/openspec/specs/recepciones/spec.md)

## Implementation Summary
- **Tasks Completed**: 17 / 17
- **Database Migration**: `backend/migrations/012_alerta_vencimiento_notificaciones.sql`
- **Main Files Modified**:
  - `backend/src/dto/configuracion.rs`
  - `backend/src/services/configuracion_service.rs`
  - `backend/src/dto/notificacion.rs`
  - `backend/src/services/notificacion_service.rs`
  - `backend/src/handlers/notificaciones.rs`
  - `backend/src/routes.rs`
  - `backend/src/dto/recepcion.rs`
  - `backend/src/services/recepcion_service.rs`
  - `backend/src/handlers/recepciones.rs`
  - `backend/tests/configuracion_test.rs`
  - `frontend/src/components/layout/header.tsx`
  - `frontend/src/pages/configuracion/index.tsx`
  - `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts`
  - `frontend/src/pages/recepciones/components/item-card.tsx`
