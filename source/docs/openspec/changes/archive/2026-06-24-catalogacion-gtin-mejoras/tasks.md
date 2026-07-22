# Tasks: Catalogacion GTIN Mejoras

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350 - 450 lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Split into a Backend PR and a Frontend PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend database migration, FDA parser mapping, lookup endpoint, and scaling logic | PR 1 | Backend branch |
| 2 | Frontend autocomplete, quick creator fabricante, reception badges, and consumption block | PR 2 | Frontend branch |

## Phase 1: Foundation & Backend Models

- [x] 1.1 Create migration `backend/migrations/009_catalogacion_gtin_mejoras.sql` adding nullable `fabricante` column to `productos` table.
- [x] 1.2 Modify `backend/src/models/producto.rs` to add `fabricante: Option<String>` to `Producto` struct.
- [x] 1.3 Modify `backend/src/services/api_regulatoria_service.rs` to add `descripcion` to `DispositivoMapeado` and update FDA parser mapping.
- [x] 1.4 Test GUDID FDA parsing logic in `backend/src/services/api_regulatoria_service.rs` with mocked external API response.

## Phase 2: Service Layer & API Endpoints

- [x] 2.1 Update CRUD operations in `backend/src/services/producto_service.rs` to support `fabricante`.
- [x] 2.2 Add `estado_catalogo` field to the response of `buscar_por_codigo` for all lookup shapes in `backend/src/services/producto_service.rs`.
- [x] 2.3 Add `/productos/scan/lookup` endpoint in `backend/src/handlers/productos.rs` returning `DispositivoMapeado`.
- [x] 2.4 Update `ApproveProductInput` struct in `backend/src/handlers/productos.rs` with extra metadata/factor fields.
- [x] 2.5 Implement metadata updates and transactional stock/movements scaling logic in `approve_product` in `backend/src/handlers/productos.rs`.
- [x] 2.6 Test transaction-based stock scaling and lookup endpoint in `backend/src/handlers/productos.rs`.

## Phase 3: Frontend Integration

- [x] 3.1 Update `ApproveProductPayload` and add `buscarGtinLookup` in `frontend/src/api/catalogos.ts`.
- [x] 3.2 Add editable fields in the approval modal in `frontend/src/pages/creador-productos/BandejaCatalogacionTab.tsx`.
- [x] 3.3 Add "Buscar/Autocompletar con GTIN" button, auto-lookup on debounce, and auto-fill logic to `frontend/src/pages/creador-productos/productos-tab.tsx`.
- [x] 3.4 Add `fabricante` field to the quick creator form and payload in `frontend/src/components/shared/AsignarCodigoModal.tsx`.
- [x] 3.5 Add `estado_catalogo` to `DetalleLineUI` and map it in `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts`.
- [x] 3.6 Add quarantine warning badge next to product name in `frontend/src/pages/recepciones/components/item-card.tsx` when product is `pendiente_aprobacion`.
- [x] 3.7 Add quarantine check and block in `frontend/src/pages/consumos/index.tsx` for HID and QR scans, displaying an error toast and rejecting additions.

## Phase 4: E2E Verification & Cleanup

- [x] 4.1 Verify manual product creation autocomplete works with GTIN scanner and auto-lookup debounce in browser.
- [x] 4.2 Verify quick product creation in reception captures manufacturer name.
- [x] 4.3 Verify quarantine warning badge appears in reception items list.
- [x] 4.4 Verify consumption scanner blocks quarantined products with a warning toast.
- [x] 4.5 Verify product approval and correct stock/movement scaling factor application in DB.

