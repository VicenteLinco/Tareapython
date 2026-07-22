## Exploration: catalogacion-gtin-mejoras

### Current State
Today, when a new product barcode is scanned and not found locally, the system automatically queries external regulatory APIs (FDA AccessGUDID and EUDAMED) to retrieve metadata. If found, a new product is created in a quarantined status (`estado_catalogo = 'pendiente_aprobacion'`).
However, there are several key limitations in the current implementation:
1. **Manufacturer Data Retention**: There is no `fabricante` column in the `productos` database table, meaning manufacturer details retrieved from external APIs are lost or not persisted cleanly in a dedicated field.
2. **FDA Metadata Mapping**: The FDA API lookup concatenates `brandName` and `deviceDescription` into `nombre` instead of saving `deviceDescription` cleanly to the product's `descripcion` field. It also maps `sku` to `versionModelNumber` rather than using the FDA `catalogNumber`.
3. **Restricted Approval Workflow**: The approval API and frontend modal only allow administrators to assign a category and a lot policy. They cannot correct the product name, unit, or presentation details (name, plural, factor) which might have been imported with default values or translation errors.
4. **Stock Scaling Issue**: If stock is registered for a quarantined product, approving it with a modified presentation conversion factor (e.g., from default 1 to a bulk size of N) results in stock and movement quantity mismatch relative to the new factor.
5. **No Manual Autocomplete**: The manual creation form does not leverage the regulatory API search capability, forcing users to type everything manually when registering new products.

### Affected Areas
- `backend/migrations/009_add_fabricante_and_scale_stock.sql` — Schema changes to add `fabricante` to `productos` and migrate view indices.
- `backend/src/services/api_regulatoria_service.rs` — Update the regulatory lookup (`lookup_dispositivo` and `DispositivoMapeado`) to parse `fabricante`, `catalogNumber` (mapping to `sku`), and `deviceDescription` (mapping to `descripcion`).
- `backend/src/services/producto_service.rs` — Update `crear_producto` to accept and persist the new `fabricante` column, and propagate `descripcion`.
- `backend/src/handlers/productos.rs` — Update the `approve_product` handler payload (`ApproveProductInput`) to allow changing name, base unit, category, lot policy, and presentation details. Implement stock and movement scaling logic during approval.
- `frontend/src/pages/creador-productos/BandejaCatalogacionTab.tsx` — Add fields for name, basic unit, category, lot policy, and presentation details to the quarantine approval modal.
- `frontend/src/pages/creador-productos/productos-tab.tsx` — Integrate a "Buscar/Autocompletar con GTIN" button in the manual creation modal, calling the `/productos/scan` endpoint.

### Approaches
1. **Full-Feature Update (Recommended)**:
   - Add `fabricante` column to the DB.
   - Refactor regulatory lookup mapping to separate commercial name, description, manufacturer, and catalog number (SKU).
   - Implement transactional scaling of stock quantities and movements upon approval by the conversion factor ratio.
   - Enable full modal editing during cataloging approval and integrate autocomplete button in the manual creation form.
   - *Pros*: Complete consistency, cleaner data architecture, superior user experience.
   - *Cons*: Higher complexity in handler/DB logic.
   - *Effort*: Medium

2. **Metadata Editing Only (No Scaling)**:
   - Allow editing fields on approval, but do not scale quantities.
   - *Pros*: Simpler backend implementation.
   - *Cons*: High risk of inventory errors if users adjust conversion factors for products that already accumulated quarantined stock.
   - *Effort*: Low

### Recommendation
**Approach 1** is recommended because clinical inventory accuracy requires scaling stock quantities if the primary unit's conversion factor changes during catalog verification.

### Risks
- **Decimal Precision**: Multiplying stock quantities could lead to rounding differences. Using database-level `NUMERIC` math is critical to avoid float errors.
- **GS1 Parsing Dependencies**: The scanner must support fallback to barcode string matching if GS1 parser cannot decode complex inputs.

### Ready for Proposal
Yes — The state is well understood and the required codebase changes have been mapped.
