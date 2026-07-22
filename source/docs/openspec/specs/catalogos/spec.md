# Catalogos Specification — Catalogación GTIN Mejoras

## Purpose

Define the complete product cataloging lifecycle improvements:
1. Persist manufacturer data and improve GUDID field mapping
2. Expand the quarantine approval flow to allow full metadata editing
3. Scale stock and movement quantities when the presentation factor changes during approval
4. Enable GTIN-based autocomplete in the manual product creation form

## Glossary

| Term | Definition |
|------|-----------|
| **GTIN** | Global Trade Item Number — the barcode identifier scanned during reception |
| **GUDID** | Global Unique Device Identification Database (FDA) |
| **Quarantine** | Product state `pendiente_aprobacion` — visible in `BandejaCatalogacionTab`, excluded from stock views (`v_stock_por_producto_area`) |
| **Factor** | `pres_factor` — conversion multiplier from presentation unit to base unit (e.g., Box of 10 → factor = 10) |
| **Scaling** | Multiplying existing `stock.cantidad` and `movimientos.cantidad`/`cantidad_resultante` by a ratio when the factor changes |

---

## Capability 1: Persist Manufacturer and Improve GUDID Mappings (`product-fabricante`)

### Context

When a product is auto-created from a GTIN scan via the FDA GUDID API, the system currently:
- Concatenates `brandName + " - " + deviceDescription` into `nombre`
- Maps `version_model_number` to `sku_ref` (should be `catalogNumber`)
- Maps `company_name` to `fabricante` in `DispositivoMapeado` but **never persists it** — no `fabricante` column exists in `productos`
- Sets `descripcion` to a hardcoded string `"Importado automáticamente mediante API regulatoria"` instead of using `deviceDescription`
- Does NOT map `catalogNumber` (the manufacturer's catalog/reference number)

### Requirements

#### REQ-FAB-01: Database Column

The system MUST add a nullable `fabricante` column (`VARCHAR(300)`) to the `productos` table via a new migration.

#### REQ-FAB-02: FDA GUDID Field Mapping

When the FDA GUDID API returns data for a GTIN, the system MUST map the response fields as follows:

| FDA GUDID Field | Target Field | Mapping Rule |
|-----------------|-------------|--------------|
| `brandName` + `" - "` + `deviceDescription` | `nombre` | Concatenate with separator. If `brandName` is null, use `deviceDescription` alone. If `deviceDescription` is null, use `brandName` alone. |
| `deviceDescription` | `descripcion` | Store as-is. MUST NOT use hardcoded placeholder text. |
| `catalogNumber` | `sku` | Store as-is. If null, fall back to `version_model_number`. |
| `companyName` | `fabricante` | Store as-is. If null or empty, store `NULL`. |

#### REQ-FAB-03: DispositivoMapeado Extension

The `DispositivoMapeado` struct MUST include a `descripcion: Option<String>` field to carry the device description separately from `nombre`.

#### REQ-FAB-04: Search Vector Update

The search trigger on `productos` SHOULD include `fabricante` in the tsvector index at weight `C` to allow searching products by manufacturer name.

#### REQ-FAB-05: Backward Compatibility

The `fabricante` column MUST be nullable. Existing products without manufacturer data MUST remain valid. The migration MUST NOT require data backfill.

### Scenarios

#### Scenario: Successful FDA mapping with all fields present

```gherkin
GIVEN the FDA GUDID API returns:
  | field              | value                        |
  | brandName          | "Medtronic"                  |
  | deviceDescription  | "Surgical Stapler 45mm"      |
  | catalogNumber      | "GIA4535S"                   |
  | companyName        | "Medtronic Inc."             |
WHEN the system processes the GUDID response
THEN DispositivoMapeado MUST contain:
  | field      | value                                  |
  | nombre     | "Medtronic - Surgical Stapler 45mm"    |
  | descripcion| "Surgical Stapler 45mm"                |
  | sku_ref    | "GIA4535S"                             |
  | fabricante | "Medtronic Inc."                       |
AND when a product is auto-created from this data
THEN productos.fabricante MUST be "Medtronic Inc."
AND productos.descripcion MUST be "Surgical Stapler 45mm"
AND productos.sku MUST be "GIA4535S"
```

#### Scenario: FDA response with missing brandName

```gherkin
GIVEN the FDA GUDID API returns:
  | field              | value                   |
  | brandName          | null                    |
  | deviceDescription  | "Insulin Syringe 1mL"  |
  | catalogNumber      | null                   |
  | companyName        | "BD"                   |
  | versionModelNumber | "329461"               |
WHEN the system processes the GUDID response
THEN DispositivoMapeado.nombre MUST be "Insulin Syringe 1mL"
AND DispositivoMapeado.sku_ref MUST be "329461"
AND DispositivoMapeado.fabricante MUST be "BD"
```

#### Scenario: FDA response with no catalogNumber — fallback to versionModelNumber

```gherkin
GIVEN the FDA GUDID API returns catalogNumber = null AND versionModelNumber = "ABC-123"
WHEN the system maps the fields
THEN DispositivoMapeado.sku_ref MUST be "ABC-123"
```

#### Scenario: FDA response with both brandName and deviceDescription null

```gherkin
GIVEN the FDA GUDID API returns brandName = null AND deviceDescription = null
WHEN the system processes the response
THEN DispositivoMapeado.nombre MUST be set to "Dispositivo sin nombre (GTIN: {gtin})"
AND DispositivoMapeado.descripcion MUST be NULL
```

---

## Capability 2: Full Metadata Editing on Quarantine Approval (`product-approval`)

### Context

Currently, when a product in quarantine (`estado_catalogo = 'pendiente_aprobacion'`) is approved via `POST /api/v1/productos/{id}/approve`, only 2 fields can be set:
- `categoria_id` (required)
- `control_lote` (required)

All other metadata (name, description, unit, presentation, manufacturer, storage, risk class) remains whatever the API auto-populated — often incorrect or incomplete. The approval modal in `BandejaCatalogacionTab.tsx` reflects this limitation.

### Requirements

#### REQ-APR-01: Extended Approval Payload

The `ApproveProductInput` struct and corresponding `ApproveProductPayload` TypeScript interface MUST accept the following fields:

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `nombre` | `String` | YES | Non-empty, max 300 chars |
| `descripcion` | `Option<String>` | NO | Max 2000 chars |
| `categoria_id` | `i32` | YES | Must reference valid `categorias.id` |
| `unidad_base_id` | `i32` | YES | Must reference valid `unidades_basicas.id` |
| `control_lote` | `ControlLote` | YES | One of: `trazable`, `con_vto`, `simple` |
| `fabricante` | `Option<String>` | NO | Max 300 chars |
| `ubicacion` | `Option<String>` | NO | Max 200 chars |
| `pres_nombre` | `Option<String>` | NO | Max 300 chars. If provided, `pres_factor` MUST also be provided |
| `pres_nombre_plural` | `Option<String>` | NO | Max 300 chars |
| `pres_factor` | `Option<Decimal>` | NO | Must be > 0. If provided, `pres_nombre` MUST also be provided |

#### REQ-APR-02: Approval State Guard

The endpoint MUST verify that the product's current `estado_catalogo` is `pendiente_aprobacion`. If the product is already `aprobado`, the endpoint MUST return HTTP 400 with a descriptive error message.

#### REQ-APR-03: Metadata Update on Approval

When a product is approved, the system MUST update ALL provided fields in a single SQL `UPDATE` statement within the approval transaction, in addition to setting `estado_catalogo = 'aprobado'`.

#### REQ-APR-04: Presentation Sync

If `pres_nombre` and `pres_factor` are provided in the approval payload, the system MUST also update the corresponding row in the `presentaciones` table (matched by `producto_id`). If no presentation row exists, the system MUST create one.

#### REQ-APR-05: Frontend Approval Modal

The approval modal in `BandejaCatalogacionTab.tsx` MUST display editable fields for:
1. **Nombre del producto** — text input, pre-filled with current `nombre`
2. **Descripción** — textarea, pre-filled with current `descripcion`
3. **Fabricante** — text input, pre-filled with current `fabricante` (new field)
4. **Categoría** — dropdown select from categories list (existing)
5. **Unidad base** — dropdown select from units list (new)
6. **Política de control de lotes** — dropdown: `con_vto`, `simple`, `trazable` (existing)
7. **Presentación** — collapsible section with:
   - Nombre de presentación (text input)
   - Nombre plural (text input)
   - Factor de conversión (numeric input, min 1)
8. **Ubicación** — text input (new)

The modal MUST show the product's `origen_registro` and `sku` as read-only badges/labels for context.

### Scenarios

#### Scenario: Approve quarantined product with full metadata edit

```gherkin
GIVEN a product exists with:
  | field             | value                                    |
  | id                | "abc-123"                                |
  | nombre            | "Medtronic - Surgical Stapler 45mm"      |
  | estado_catalogo   | "pendiente_aprobacion"                   |
  | pres_factor       | 1                                        |
  | fabricante        | NULL                                     |
  | categoria_id      | NULL                                     |
WHEN an admin sends POST /api/v1/productos/abc-123/approve with:
  | field             | value                    |
  | nombre            | "Grapadora Quirúrgica 45mm" |
  | categoria_id      | 3                        |
  | unidad_base_id    | 1                        |
  | control_lote      | "trazable"               |
  | fabricante        | "Medtronic Inc."         |
  | pres_nombre       | "Caja"                   |
  | pres_nombre_plural| "Cajas"                  |
  | pres_factor       | 10                       |
THEN the product MUST be updated with all provided fields
AND estado_catalogo MUST be "aprobado"
AND the presentaciones row for this product MUST have factor_conversion = 10
```

#### Scenario: Attempt to approve an already-approved product

```gherkin
GIVEN a product with estado_catalogo = "aprobado"
WHEN an admin sends POST /api/v1/productos/{id}/approve
THEN the system MUST return HTTP 400
AND the response MUST contain error message "El producto ya está aprobado"
```

#### Scenario: Approval with presentation factor but missing presentation name

```gherkin
GIVEN a quarantined product
WHEN an admin sends approve with pres_factor = 5 but pres_nombre = null
THEN the system MUST return HTTP 400
AND the response MUST contain error message indicating presentation name is required when factor is provided
```

#### Scenario: Approval with only required fields (no presentation change)

```gherkin
GIVEN a quarantined product with pres_factor = 1
WHEN an admin sends approve with only nombre, categoria_id, unidad_base_id, and control_lote
THEN the product MUST be approved successfully
AND pres_factor MUST remain 1
AND no stock scaling MUST occur
```

---

## Capability 3: Stock Scaling on Factor Change (`stock-scaling`)

### Context

When a product is auto-created via GTIN scan during reception, the system creates it with `pres_factor = 1` and a default presentation of "Unidad"/"Unidades". The reception then records stock movements in base units (factor=1). If during approval the administrator sets the correct factor (e.g., factor=10 for a box of 10), the existing stock quantities become incorrect — they were recorded as if 1 presentation = 1 base unit, but now 1 presentation = 10 base units.

**Key constraint**: The `stock` table is maintained by a PostgreSQL trigger (`trg_actualizar_stock` / `fn_procesar_movimiento_stock()`) that fires `BEFORE INSERT` on `movimientos`. This trigger auto-updates `stock.cantidad` based on movement type and sign. However, since we are correcting historical quantities (not inserting new movements), we MUST update both tables directly.

**Safety**: Quarantined products (`pendiente_aprobacion`) are excluded from `v_stock_por_producto_area` and all operational stock views, so direct quantity updates have no side effects on active inventory.

### Requirements

#### REQ-SCALE-01: Scaling Calculation

When a quarantined product is approved with a `pres_factor` different from its current value, the system MUST calculate the scaling multiplier as:

```
multiplier = new_factor / old_factor
```

If `old_factor` is NULL or 0, it MUST be treated as 1 for calculation purposes.

#### REQ-SCALE-02: Stock Table Update

Within the approval transaction, the system MUST update all `stock` rows associated with the product's lotes:

```sql
UPDATE stock SET cantidad = cantidad * {multiplier}
WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = {product_id})
```

#### REQ-SCALE-03: Movements Table Update

Within the same transaction, the system MUST update all `movimientos` rows associated with the product's lotes:

```sql
UPDATE movimientos
SET cantidad = cantidad * {multiplier},
    cantidad_resultante = cantidad_resultante * {multiplier}
WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = {product_id})
```

#### REQ-SCALE-04: Transaction Integrity

The metadata update (Capability 2), presentation sync, stock scaling, and movement scaling MUST all execute within a single database transaction. If any step fails, the entire transaction MUST roll back.

#### REQ-SCALE-05: No Scaling When Factor Unchanged

If the new `pres_factor` equals the old `pres_factor`, or if `pres_factor` is not provided in the approval payload, the system MUST NOT execute any scaling queries.

#### REQ-SCALE-06: Decimal Precision

All scaling calculations MUST use `NUMERIC(12,2)` precision (matching the `stock.cantidad` and `movimientos.cantidad` column types) to avoid floating-point errors. The multiplication MUST be performed in PostgreSQL, not in application code.

#### REQ-SCALE-07: Non-Negative Constraint

After scaling, `stock.cantidad` MUST remain >= 0 (enforced by the existing `stock_cantidad_check` constraint). Since scaling only multiplies by a positive ratio (factors are always > 0), this constraint is naturally satisfied. However, the transaction MUST catch and report any constraint violation as an internal error.

### Scenarios

#### Scenario: Factor changes from 1 to 10 — stock and movements scale up

```gherkin
GIVEN a quarantined product with pres_factor = 1
AND the product has 1 lote with:
  | table       | field               | value |
  | stock       | cantidad            | 5     |
  | movimientos | cantidad            | 5     |
  | movimientos | cantidad_resultante | 5     |
WHEN the admin approves with pres_factor = 10
THEN multiplier = 10 / 1 = 10
AND stock.cantidad MUST be updated to 50
AND movimientos.cantidad MUST be updated to 50
AND movimientos.cantidad_resultante MUST be updated to 50
```

#### Scenario: Factor changes from 1 to 5 with multiple lotes and movements

```gherkin
GIVEN a quarantined product with pres_factor = 1
AND the product has 2 lotes:
  | lote   | stock.cantidad | movimientos (cantidad) |
  | lote-A | 10             | [10, 5]                |
  | lote-B | 3              | [3]                    |
WHEN the admin approves with pres_factor = 5
THEN multiplier = 5
AND lote-A stock.cantidad MUST be 50
AND lote-A movimientos.cantidad MUST be [50, 25]
AND lote-B stock.cantidad MUST be 15
AND lote-B movimientos.cantidad MUST be [15]
```

#### Scenario: Factor not provided — no scaling

```gherkin
GIVEN a quarantined product with pres_factor = 1
AND the product has stock.cantidad = 10
WHEN the admin approves without providing pres_factor
THEN stock.cantidad MUST remain 10
AND no UPDATE on stock or movimientos MUST be executed
```

#### Scenario: Factor unchanged (remains 1) — no scaling

```gherkin
GIVEN a quarantined product with pres_factor = 1
WHEN the admin approves with pres_factor = 1
THEN no scaling MUST occur
AND the transaction MUST still commit successfully
```

#### Scenario: Product with no lotes or stock — scaling is no-op

```gherkin
GIVEN a quarantined product with pres_factor = 1
AND the product has 0 lotes
WHEN the admin approves with pres_factor = 10
THEN the scaling queries MUST execute (affecting 0 rows)
AND the approval MUST succeed normally
```

#### Scenario: Transaction rollback on failure

```gherkin
GIVEN a quarantined product with stock
WHEN the admin approves with valid metadata but the stock UPDATE fails (e.g., constraint violation)
THEN the entire transaction MUST roll back
AND estado_catalogo MUST remain "pendiente_aprobacion"
AND the response MUST return HTTP 500 with error details
```

---

## Capability 4: Scan-to-Create with API Lookup (`catalog-scan-create`)

### Context

The manual product creation form (`CreateProductoDialog` in `productos-tab.tsx`) currently has a barcode scanner (`BarcodeScanner` component using `Html5Qrcode`) that **only stores the scanned code in `pres_codigo_barras`** — it does not query any API or pre-fill product data. Users must type all product details manually even when the information is available in regulatory databases.

This capability transforms the creation form to support a full **scan → lookup → pre-fill → review → create** flow, using both the existing physical barcode scanner and a manual GTIN text input.

**Key design decisions**:
- This MUST use a new read-only lookup endpoint (`GET /productos/scan/lookup`) instead of the existing `GET /productos/scan`, because `scan` has side effects — it auto-creates a quarantined product if the GTIN is not found locally.
- The lookup endpoint MUST check the local database first before calling external APIs, to detect duplicates and avoid unnecessary external calls.
- `fabricante` MUST be added as a real editable field in the creation form (not just informational), since `CrearProductoParams` will include it after the migration.

### Requirements

#### REQ-SCAN-01: Lookup Endpoint

The system MUST provide a new endpoint `GET /api/v1/productos/scan/lookup` that:
- Accepts query parameter `codigo` (the GTIN/barcode)
- First checks the local database for existing products matching the code (by `pres_gtin`, `pres_codigo_barras`, `sku`, or `presentaciones.gtin`/`presentaciones.codigo_barras`)
- If found locally, returns the existing product data with a `source: "local"` indicator
- If NOT found locally, calls the regulatory API cascade (`lookup_dispositivo`)
- Returns the mapped data as JSON
- Does NOT create any product or database record
- Does NOT modify any existing data

#### REQ-SCAN-02: Lookup Response Format

The endpoint MUST return one of three response shapes:

**Product found in local database:**
```json
{
  "found": true,
  "source": "local",
  "existing_product": {
    "id": "uuid-here",
    "nombre": "Product Name",
    "codigo_interno": "PROD-001",
    "estado_catalogo": "aprobado"
  },
  "data": null,
  "message": "Este producto ya existe en el catálogo"
}
```

**Product found via regulatory API:**
```json
{
  "found": true,
  "source": "api_regulatoria",
  "existing_product": null,
  "data": {
    "nombre": "Brand - Description",
    "fabricante": "Company Name",
    "sku_ref": "CAT-123",
    "clase_riesgo": null,
    "descripcion": "Device description text"
  }
}
```

**Not found anywhere:**
```json
{
  "found": false,
  "source": null,
  "existing_product": null,
  "data": null,
  "message": "No se encontró información regulatoria para el código proporcionado"
}
```

#### REQ-SCAN-03: Scanner-Triggered Lookup

The existing `BarcodeScanner` component in `CreateProductoDialog` MUST be modified so that when a barcode is scanned:
1. The scanned code is stored in `pres_codigo_barras` (existing behavior, preserved)
2. **Immediately** after scanning, the system MUST automatically call the lookup endpoint with the scanned code
3. The scanner dialog MUST close after a successful scan
4. The lookup result MUST be processed according to REQ-SCAN-05 (pre-fill) or REQ-SCAN-06 (duplicate detection)

#### REQ-SCAN-04: Manual GTIN Input with Lookup and Debounce

In addition to the barcode scanner, the form MUST provide:
1. The existing text input for `pres_codigo_barras` (barcode/GTIN).
2. A **"🔍 Buscar en API"** button adjacent to the barcode input.
3. Clicking the button MUST call the lookup endpoint with the current value of `pres_codigo_barras`.
4. Automated Lookup on Typing: When the user types a value in the barcode input, the system SHOULD automatically trigger the lookup if the input reaches a length of exactly 8 or 14 digits AND the user pauses typing for 500ms (debounce).
5. The button MUST show a loading spinner and be disabled while any lookup request is in progress.

#### REQ-SCAN-05: Form Pre-fill from API Data

When the lookup returns `source: "api_regulatoria"` with data, the form MUST pre-fill the following fields:

| API Response Field | Form Field | Pre-fill Behavior |
|-------------------|------------|-------------------|
| `nombre` | `nombre` | Overwrite (always) |
| `descripcion` | `descripcion` | Overwrite (always) |
| `sku_ref` | `sku` | Overwrite (always) |
| `fabricante` | `fabricante` | Overwrite (always) — new field in form |
| `clase_riesgo` | `clase_riesgo` | Overwrite if not null |
| (scanned code) | `pres_codigo_barras` | Already set by scan |
| (scanned code) | `pres_gtin` | Set to the scanned code |

After pre-fill, a success toast MUST be shown: "Datos del producto obtenidos correctamente".

All pre-filled fields MUST remain editable — the user can modify any value before submitting.

#### REQ-SCAN-06: Duplicate Detection

When the lookup returns `source: "local"` with an existing product:
1. The form MUST show an alert/warning banner:
   - "⚠️ Este producto ya existe: **{nombre}** ({codigo_interno})"
   - If `estado_catalogo = "pendiente_aprobacion"`: show badge "En cuarentena"
   - If `estado_catalogo = "aprobado"`: show badge "Aprobado"
2. The alert MUST include a link/button: "Ver producto existente" that:
   - If `estado_catalogo = "pendiente_aprobacion"`: navigates to the "Bandeja de Catalogación" (Cataloging Tray) tab and automatically opens the configuration/approval modal for this product.
   - If `estado_catalogo = "aprobado"`: navigates to the "Insumos" tab and filters by this product's code or name.
3. The form MUST NOT be pre-filled from the existing product — the user can still create a new product if they choose (different presentation, different supplier, etc.)
4. The duplicate warning MUST be dismissible.

#### REQ-SCAN-07: Fabricante Field in Creation Form

The `CreateProductoDialog` form MUST add a `fabricante` text input field in the identification section:
- Label: "Fabricante"
- Optional (not required for creation)
- Max length: 300 characters
- Positioned after `nombre` and before `descripcion`
- Pre-filled by the lookup API when available

The `CrearProductoParams` backend struct and `CreateProducto` TypeScript interface MUST include `fabricante: Option<String>`.

#### REQ-SCAN-08: Loading State

While any lookup request is in progress (from scanner, manual button, or debounce):
- The "🔍 Buscar en API" button MUST show a loading spinner and be disabled
- The scanner button MUST be disabled
- A subtle loading indicator SHOULD be shown on the form
- Duplicate requests MUST be prevented

#### REQ-SCAN-09: Error Handling

If the lookup endpoint returns an HTTP error (network failure, timeout, 500, etc.), the form MUST:
- Show an error toast: "Error al consultar la API regulatoria"
- NOT clear or modify any form fields
- Re-enable all buttons
- The scanned code in `pres_codigo_barras` MUST be preserved

### Scenarios

#### Scenario: Scan barcode → API lookup → pre-fill form
```gherkin
GIVEN the manual creation form is open with all fields empty
WHEN the user opens the barcode scanner and scans code "00846566053063"
THEN the scanner dialog MUST close
AND pres_codigo_barras MUST be set to "00846566053063"
AND the system MUST automatically call GET /api/v1/productos/scan/lookup?codigo=00846566053063
AND the lookup endpoint MUST first check the local database
AND if not found locally, MUST query the regulatory API
AND when the API returns data, the form MUST pre-fill nombre, descripcion, sku, and fabricante
AND a success toast MUST appear: "Datos del producto obtenidos correctamente"
AND the user can review, edit any field, and submit to create the product
```

#### Scenario: Type barcode → Auto-lookup on debounce
```gherkin
GIVEN the manual creation form is open
WHEN the user types "00846566053063" (14 digits) into the barcode input
AND pauses typing for 500ms
THEN the system MUST automatically call GET /api/v1/productos/scan/lookup?codigo=00846566053063
AND on success, MUST pre-fill the form fields from the API response
```

#### Scenario: Scan barcode → duplicate detected (approved product)
```gherkin
GIVEN the local database has an approved product with pres_gtin = "07891234567890"
WHEN the user scans barcode "07891234567890"
THEN the lookup MUST return source = "local" with the existing product
AND the form MUST show a warning: "Este producto ya existe: {nombre} ({codigo_interno})"
AND the warning MUST show badge "Aprobado"
AND the warning MUST include a "Ver producto existente" link that opens the approved product view
AND the form fields MUST NOT be overwritten
```

#### Scenario: Scan barcode → duplicate detected (quarantined product)
```gherkin
GIVEN the local database has a quarantined product with pres_codigo_barras = "12345678"
WHEN the user scans barcode "12345678"
THEN the lookup MUST return source = "local" with existing_product.estado_catalogo = "pendiente_aprobacion"
AND the warning MUST show badge "En cuarentena"
AND the warning MUST include a "Ver producto existente" link that redirects to the Cataloging Tray and opens its config modal
```

#### Scenario: Create product after successful scan and pre-fill
```gherkin
GIVEN the form has been pre-filled from a GTIN scan
AND the user has selected a category, unit, and area
WHEN the user submits the form
THEN the product MUST be created with estado_catalogo = "aprobado" (manual creation)
AND origen_registro MUST be "manual"
AND fabricante MUST be persisted in the productos table
AND pres_gtin MUST be set to the scanned GTIN code
```

---

## Capability 5: Reception Quick Creation and Status Badge (`reception-status-fabricante`)

### Context

During the reception wizard (`NuevaRecepcionPage`), scanned barcodes that are not found locally or in external databases trigger `AsignarCodigoModal` (the quick creator). This form currently does not allow configuring the `fabricante` field, which means any manufacturer data from GS1 is lost during quick creation.
Additionally, when a product in quarantine (created automatically via scan or PDF guide) is added to a reception, there is no visual indicator in the items list. Receivers might confirm the reception without realizing that the product's catalog record is quarantined and needs clinical approval.

### Requirements

#### REQ-REC-01: Fabricante in Quick Creator Form
The quick creation form inside `AsignarCodigoModal` MUST add a `fabricante` text input field in its "Crear Producto Rápido" tab. If the scanned code was GS1 and contained a manufacturer name, the `fabricante` field MUST be prefilled automatically. The user MUST be able to edit this field before submission.

#### REQ-REC-02: Fabricante in Quick Creation Payload
The quick creation API request (`POST /productos`) submitted by `AsignarCodigoModal` MUST include the `fabricante` string if populated.

#### REQ-REC-03: Quarantine Status Badge in Reception Items List
The `ReceptionItemCard` component (which renders each item in the reception list) MUST display a highly visible yellow warning badge/tag saying `"⚠️ En cuarentena (Pendiente de aprobación)"` next to the product name if the product's `estado_catalogo` is `pendiente_aprobacion`.

#### REQ-REC-04: DetalleLineUI and API Type Sync
The `DetalleLineUI` TypeScript interface and the backend scan response (`buscar_por_codigo` returned data) MUST include the `estado_catalogo` field to allow the frontend to detect and render the quarantine badge.

### Scenarios

#### Scenario: GS1 Scan with manufacturer → Quick Creator prefill
```gherkin
GIVEN the user scans an unknown GS1 barcode containing GTIN, lot, and manufacturer "BD Inc."
WHEN the AsignarCodigoModal opens
THEN the "Crear Producto Rápido" form MUST have the "Fabricante" field pre-filled with "BD Inc."
AND the user can edit it and click "Crear y añadir"
AND the product is created on the backend with fabricante = "BD Inc."
```

#### Scenario: Quarantined product in reception list renders warning badge
```gherkin
GIVEN a product with estado_catalogo = "pendiente_aprobacion" is added to the reception
WHEN the items list is rendered
THEN the ReceptionItemCard for this product MUST render a badge saying "⚠️ En cuarentena"
AND the confirm button remains active (reception of quarantined goods is allowed)
```

---

## Capability 6: Consumption Blocking on Quarantined Products (`consumption-quarantine-block`)

### Context

A critical safety requirement of this inventory system is that quarantined products (`pendiente_aprobacion`) MUST NOT be consumed. The backend already enforces this check inside the transaction for submitting a consumption batch, rejecting it if any product is in quarantine.
However, in the frontend, scanning a quarantined product currently succeeds and adds it to the cart without warning, only failing when the user attempts to confirm the entire consumption batch. This creates frustration and delays. The frontend must provide instant feedback at scan time.

### Requirements

#### REQ-CON-01: Scan-time Quarantine Check and Block
In `frontend/src/pages/consumos/index.tsx`, when processing a barcode scan (either via QR scanner or keyboard HID scanner), the system MUST check the `estado_catalogo` field of the resolved product.
If the product has `estado_catalogo = "pendiente_aprobacion"`, the system MUST:
1. Play a rejection vibration pattern (if supported).
2. Show a persistent error notification/toast: `"Insumo en cuarentena: El producto '{nombre}' debe ser aprobado en la bandeja de catalogación antes de ser consumido."`
3. Prevent adding the product to the consumption cart.
4. Close the scanner modal/overlay.

#### REQ-CON-02: Scan Endpoint Schema Update
The backend `/productos/scan` endpoint (handled by `buscar_por_codigo`) MUST include `estado_catalogo` in its JSON response payload for all matched cases:
- local presentation match
- barcode alias match
- product internal code match
- lot number match
- regulatory API auto-creation response

### Scenarios

#### Scenario: Scan quarantined product barcode in consumption
```gherkin
GIVEN a product exists in the system with:
  | field           | value                  |
  | nombre          | "Pipeta de Pasteur"    |
  | estado_catalogo | "pendiente_aprobacion" |
WHEN the user scans the barcode of this product in the consumption screen
THEN the system MUST NOT add it to the cart
AND an error toast MUST appear: "Insumo en cuarentena: El producto 'Pipeta de Pasteur' debe ser aprobado en la bandeja de catalogación antes de ser consumido."
```

---

## Cross-Cutting Concerns

### Validation Rules Summary

| Field | Max Length | Required On | Additional Constraints |
|-------|-----------|-------------|----------------------|
| `fabricante` | 300 chars | Never | Nullable. Editable in both creation form, quick creation modal, and approval modal |
| `nombre` | 300 chars | Creation, Approval | Non-empty |
| `descripcion` | 2000 chars | Never | Nullable |
| `categoria_id` | — | Approval | Valid FK to `categorias`. Optional on creation |
| `unidad_base_id` | — | Creation, Approval | Valid FK to `unidades_basicas` |
| `pres_nombre` | 300 chars | When `pres_factor` provided | Co-required with `pres_factor` |
| `pres_factor` | NUMERIC(12,4) | When `pres_nombre` provided | Must be > 0, co-required with `pres_nombre` |
| `pres_gtin` | 20 chars | Never | Auto-set from scanner scan code when applicable |
| `pres_codigo_barras` | 200 chars | Never | Preserves scanned code in both scan and manual input flows |

### Error Responses

| Condition | HTTP Status | Error Message |
|-----------|-------------|--------------|
| Product not found | 404 | "Producto no encontrado" |
| Product already approved | 400 | "El producto ya está aprobado" |
| Missing required field | 400 | "El campo {field} es requerido" |
| Invalid category ID | 400 | "Categoría no válida" |
| Invalid unit ID | 400 | "Unidad base no válida" |
| pres_factor without pres_nombre | 400 | "Se requiere nombre de presentación cuando se especifica el factor" |
| pres_nombre without pres_factor | 400 | "Se requiere factor de conversión cuando se especifica la presentación" |
| Stock scaling constraint violation | 500 | "Error al escalar stock: {details}" |
| Regulatory API unreachable (lookup) | 502 | "No se pudo conectar con la API regulatoria" |
| Lookup with empty/missing code | 400 | "Se requiere un código para la búsqueda" |

### Migration

- Migration number: `009_catalogacion_gtin_mejoras.sql`
- Adds: `fabricante VARCHAR(300) NULL` to `productos`
- Updates: search trigger to include `fabricante` at weight C
- No data backfill required
- Rollback: `ALTER TABLE productos DROP COLUMN fabricante;`

### Security

- The `approve_product` endpoint MUST require admin role (existing behavior, maintained)
- The `scan/lookup` endpoint MUST require authenticated user (standard auth middleware)
- No PII is stored — manufacturer names are public commercial data

### Affected Files Summary

| File | Capabilities Affected | Change Type |
|------|----------------------|-------------|
| `backend/migrations/009_catalogacion_gtin_mejoras.sql` | FAB | Create |
| `backend/src/models/producto.rs` | FAB | Modify — add `fabricante` field |
| `backend/src/services/api_regulatoria_service.rs` | FAB | Modify — add `descripcion` to struct, fix mappings |
| `backend/src/services/producto_service.rs` | FAB, SCAN, REC, CON | Modify — add `fabricante` to CRUD, add local lookup, return `estado_catalogo` in scan responses |
| `backend/src/handlers/productos.rs` | APR, SCALE, SCAN | Modify — extend approve, add `/scan/lookup`, scaling |
| `frontend/src/types/generated.ts` | FAB | Modify — add `fabricante` to Producto type |
| `frontend/src/types/index.ts` | FAB, SCAN | Modify — add `fabricante` to CreateProducto |
| `frontend/src/api/catalogos.ts` | APR, SCAN | Modify — extend ApproveProductPayload, add lookup API |
| `frontend/src/pages/creador-productos/BandejaCatalogacionTab.tsx` | APR | Modify — expand approval modal fields |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | SCAN | Modify — scanner lookup, fabricante field, duplicate alert |
| `frontend/src/components/shared/AsignarCodigoModal.tsx` | REC | Modify — add `fabricante` field to quick creator form and payload |
| `frontend/src/pages/recepciones/components/item-card.tsx` | REC | Modify — add quarantine warning badge and `estado_catalogo` field |
| `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` | REC | Modify — map `estado_catalogo` from scan response |
| `frontend/src/pages/consumos/index.tsx` | CON | Modify — block quarantined product additions and show error toast |


---

## Capability 7: UI Restructuring (reestructuracion-ui)

### Purpose

Define the UI adjustments inside the Product Creator (Creador de Productos) dashboard to streamline master data management by removing obsolete tabs and renaming existing ones.

### Requirements

#### REQ-CAT-UI-01: Tab Renaming
The tab labeled "Presentaciones" MUST be renamed to "Formatos de Empaque".
- The underlying component reference and route parameter (`tab=presentaciones`) may remain unchanged to preserve bookmark compatibility.
- The user interface label MUST render as "Formatos de Empaque".

#### REQ-CAT-UI-02: GTINs Tab Removal
The "GTINs" tab (`tab=gtins`) MUST be completely removed from the Creador de Productos page.
- GTIN management is now handled contextually within individual product edit flows, making the global list tab obsolete.

#### REQ-CAT-UI-03: Áreas Tab Removal
The "Áreas" tab (`tab=areas`) MUST be removed from the Creador de Productos page.
- Area management is relocated to a standalone page `/areas` (specified in the Configuration domain delta).

### Scenarios

#### Scenario: Admin views Creador de Productos tabs
Given the user is logged in as an administrator
When they navigate to the Creador de Productos page (`/creador-productos`)
Then the visible tabs MUST be:
  | Tab Label | Icon | Identifier |
  | Productos | Package | `productos` |
  | Catalogación | ShieldAlert | `catalogacion` |
  | Categorías | Tag | `categorias` |
  | Unidades | Layers | `unidades` |
  | Proveedores | Truck | `proveedores` |
  | Formatos de Empaque | LayoutList | `presentaciones` |
And the tabs "GTINs" and "Áreas" MUST NOT be visible on this page.

#### Scenario: Admin accesses Formatos de Empaque tab
Given the user is on the Creador de Productos page
When they click the "Formatos de Empaque" tab
Then the system MUST render the packaging formats management view (formerly "Presentaciones")
And the browser URL search query MUST contain `tab=presentaciones`.

---

## Capability 8: Monthly Usage Average (promedio-uso-mensual)

### Context

To assist with inventory management and forecasting, the system tracks the average monthly usage for each product. This value can be seeded on creation or import, and is dynamically recalculated nightly based on the last 30 days of consumption. For new products (created less than 30 days ago), the nightly job blends the initial seed value with actual consumption.

### Requirements

#### REQ-PROM-01: Seed Monthly Usage on Product Creation

The system MUST accept an optional initial monthly usage average upon creation or import. If provided, the system SHALL initialize both `promedio_uso_mensual` and `promedio_uso_mensual_inicial` with this value. If not provided, both fields MUST default to `0.00`.

#### REQ-PROM-02: Nightly Average Consumption Recalculation

The system MUST run a scheduled process nightly that calculates the sum of all consumptions in the last 30 days for each product. The resulting values MUST be used to update `promedio_uso_mensual` according to the age of the product and its consumption history. If a product has no consumption movements recorded ever, the monthly average MUST remain equal to the initial seed value `promedio_uso_mensual_inicial`.

#### REQ-PROM-03: Seed Value Blend for New Products

For products created less than 30 days ago that have at least one consumption movement recorded, the system MUST blend the initial seed value with actual consumption using the formula:
`P_adjusted = Sum_30d + (1 - Age_Days / 30) * P_initial`
where:
- `Sum_30d` is the sum of actual consumptions in the last 30 days.
- `Age_Days` is the number of days elapsed since the product was created.
- `P_initial` is the `promedio_uso_mensual_inicial`.

#### REQ-PROM-04: Simple Rolling Sum for Older Products

For products created 30 or more days ago that have at least one consumption movement recorded, the system MUST set the monthly average to the simple sum of the last 30 days of consumptions:
`P_adjusted = Sum_30d`

#### REQ-PROM-05: Products with No Consumption History

For products that have no recorded consumption movements ever in the system, the system MUST set the monthly average to the initial seed value:
`P_adjusted = P_initial`

### Scenarios

#### Scenario: Product creation with seed value
- GIVEN a new product is being created with a seed monthly usage of 150.00
- WHEN the creation transaction is executed
- THEN the product record MUST have `promedio_uso_mensual` set to 150.00 and `promedio_uso_mensual_inicial` set to 150.00

#### Scenario: Product creation without seed value
- GIVEN a new product is being created with no seed value provided
- WHEN the creation transaction is executed
- THEN the product record MUST have `promedio_uso_mensual` set to 0.00 and `promedio_uso_mensual_inicial` set to 0.00

#### Scenario: Scheduled nightly execution finishes successfully
- GIVEN products with various ages and consumption records exist
- WHEN the nightly recalculation scheduler runs
- THEN it MUST calculate the sum of consumptions for the last 30 days for each product
- AND it MUST update `promedio_uso_mensual` for each product based on its age and the calculated consumption sum

#### Scenario: Blend formula calculation for new product
- GIVEN a product created 10 days ago (Age_Days = 10)
- AND its initial seed `promedio_uso_mensual_inicial` is 90.00
- AND its sum of actual consumptions in the last 30 days is 20.00
- AND it has at least one consumption movement ever
- WHEN the nightly recalculation runs
- THEN the system MUST set `promedio_uso_mensual` to 80.00 (calculated as: 20.00 + (1 - 10/30) * 90.00 = 20.00 + (2/3) * 90.00 = 80.00)

#### Scenario: Simple rolling sum calculation for older product
- GIVEN a product created 45 days ago (Age_Days = 45)
- AND its initial seed `promedio_uso_mensual_inicial` is 90.00
- AND its sum of actual consumptions in the last 30 days is 35.00
- AND it has at least one consumption movement ever
- WHEN the nightly recalculation runs
- THEN the system MUST set `promedio_uso_mensual` to 35.00

#### Scenario: Recalculation for older product with no consumption history ever
- GIVEN a product created 45 days ago (Age_Days = 45)
- AND its initial seed `promedio_uso_mensual_inicial` is 50.00
- AND it has no consumption movements recorded ever
- WHEN the nightly recalculation runs
- THEN the system MUST set `promedio_uso_mensual` to 50.00


