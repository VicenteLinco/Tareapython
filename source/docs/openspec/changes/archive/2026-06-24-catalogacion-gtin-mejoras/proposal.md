# Proposal: Catalogacion GTIN Mejoras

## Intent
Improve the product cataloging and quarantine approval workflow by persisting manufacturer details, correcting imported metadata before approval, scaling stock quantities when conversion factors change, and enabling auto-complete during manual product creation.

## Scope

### In Scope
- Add `fabricante` (manufacturer) persistence to products.
- Map FDA Gudid `catalogNumber` to `sku` and `deviceDescription` to product description.
- Redesign the quarantine approval workflow to allow full metadata editing (name, unit, category, lot policy, and presentation details).
- Automatically scale quarantined stock and movement quantities when the presentation factor is updated.
- Add a "Buscar/Autocompletar con GTIN" button to the manual product form.

### Out of Scope
- Editing historical approved stock movements unrelated to the quarantined product.
- Automatic translation of regulatory names/descriptions.

## Capabilities

### New Capabilities
- `catalog-autocomplete`: Auto-populates manual product creation fields using regulatory scan API data.
- `product-fabricante`: Stores and displays product manufacturer details.

### Modified Capabilities
- `product-approval`: Allows full editing of product metadata and scales stock quantities on catalog verification.

## Approach
1. **Database Schema**: Add `fabricante` column to `productos`.
2. **Regulatory Lookup**: Modify `lookup_dispositivo` (FDA/EUDAMED) to fetch manufacturer, map FDA `catalogNumber` to `sku`, and map `deviceDescription` to description.
3. **Editable Approval & Stock Scaling**: Update `approve_product` endpoint to accept corrected metadata. Calculate scale multiplier `M = new_factor / old_factor`. Update `stock` and `movimientos` rows for the product's lotes using transaction-level numeric multiplication.
4. **UI Improvements**: Expand the quarantine approval modal in `BandejaCatalogacionTab.tsx` and add the autocomplete button in `productos-tab.tsx`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/migrations/009_catalogacion_gtin_mejoras.sql` | New | Add `fabricante` column to `productos`. |
| `backend/src/services/api_regulatoria_service.rs` | Modified | Update `lookup_dispositivo` data mapping. |
| `backend/src/services/producto_service.rs` | Modified | Support `fabricante` in `crear_producto`. |
| `backend/src/handlers/productos.rs` | Modified | Expand `approve_product` inputs and add stock scaling. |
| `frontend/src/pages/creador-productos/BandejaCatalogacionTab.tsx` | Modified | Add full editing inputs to approval modal. |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | Modified | Add GTIN autocomplete button to form. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Rounding issues during stock scaling | Med | Use PostgreSQL `numeric` multiplication. |
| Missing manufacturer in FDA records | Low | Fallback to "FDA Manufacturer". |

## Rollback Plan
Run schema migration rollback to drop `fabricante` column and revert git commits.

## Dependencies
- None.

## Success Criteria
- [ ] Manufacturer is persisted and shown in product details.
- [ ] Quarantined stock scales accurately on factor change.
- [ ] Autocomplete button successfully populates manual product form fields.
