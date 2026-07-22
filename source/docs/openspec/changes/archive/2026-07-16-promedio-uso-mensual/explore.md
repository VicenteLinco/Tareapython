# Exploration: Dynamic Monthly Usage Adjustment

This document details the code exploration and design options for implementing the `promedio_uso_mensual` (average monthly usage) feature. The objective is to allow products to be created or imported with an initial starting value for `promedio_uso_mensual`, which is then dynamically adjusted based on product consumptions over time.

---

## 1. Current State & Affected Areas

### 1.1 Database Schema (SQL)
Currently, the `productos` table (defined in [001_initial_schema.sql](file:///home/vdev/desarrollo/Tareapython/backend/migrations/001_initial_schema.sql)) does not contain a `promedio_uso_mensual` column.

We need to add a new migration:
- **File**: `backend/migrations/016_add_promedio_uso_mensual_to_productos.sql`
- **Changes**: Add `promedio_uso_mensual` and `promedio_uso_mensual_inicial` columns to the `productos` table.
  ```sql
  ALTER TABLE public.productos
    ADD COLUMN promedio_uso_mensual numeric(12,4) DEFAULT 0.0 NOT NULL,
    ADD COLUMN promedio_uso_mensual_inicial numeric(12,4) DEFAULT 0.0 NOT NULL;
  ```
  *Note: Keeping the initial value separate allows for mathematically accurate blending during the first 30 days of the product's lifecycle.*

### 1.2 Domain Models
The `Producto` model in Rust does not represent this column.
- **File**: [producto.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/models/producto.rs#L8-L38)
- **Changes**: Add `promedio_uso_mensual` and `promedio_uso_mensual_inicial` to the `Producto` struct.
  ```rust
  pub promedio_uso_mensual: rust_decimal::Decimal,
  pub promedio_uso_mensual_inicial: rust_decimal::Decimal,
  ```

### 1.3 DTOs & Handlers
When products are created or updated, the new attribute needs to be accepted and returned.
- **File**: [productos.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/handlers/productos.rs)
- **Changes**:
  - Add `promedio_uso_mensual` (optional) to `CreateProducto` and `UpdateProducto` structs.
  - Return `promedio_uso_mensual` in `ProductoListItem` and other responses.
  - Bind the param when calling `ProductoService::crear_producto` and `ProductoService::actualizar_producto`.

### 1.4 Services
The product creation and update logic needs to handle the new field.
- **File**: [producto_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/producto_service.rs)
- **Changes**:
  - Update `CrearProductoParams` and `ActualizarProductoParams` to include `promedio_uso_mensual`.
  - Update queries in `crear_producto` and `actualizar_producto` to insert and update the database columns.
  - Update queries in `obtener_detalle` and listing methods to fetch the column.

### 1.5 Catalog Import (Setup)
The smart mapper allows bulk product imports.
- **File**: [setup_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/setup_service.rs)
- **Changes**:
  - In `importar_catalogo`, read from the CSV mapping using keys like `"promedio_uso_mensual"`, `"uso_mensual"`, or `"promedio_uso"`.
  - Parse it as a `Decimal` (defaulting to `0.0` or a predefined value if empty).
  - Insert it into the database during the bulk INSERT query for both the `promedio_uso_mensual` and `promedio_uso_mensual_inicial` columns.

---

## 2. Consumptions Architecture

Consumptions are processed in [consumo_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/consumo_service.rs).
- **Single Consumption**: `registrar_consumo`
- **Batch Consumption**: `registrar_consumo_batch`

Both methods perform validation, look up active lotes (applying FEFO logic), and then delegate the stock changes to `stock_ops::aplicar_salida_fefo` within a Postgres transaction.
The `aplicar_salida_fefo` function inserts records into the `movimientos` table with `tipo = 'CONSUMO'`.

---

## 3. Comparison of Calculation Approaches

We analyzed three distinct approaches for calculating and updating the `promedio_uso_mensual` value.

| Dimension | Option A: On-the-fly Dynamic | Option B: Event-driven Update (EMA) | Option C: Scheduled Nightly Job |
| :--- | :--- | :--- | :--- |
| **Description** | Recalculated dynamically via SQL aggregates whenever a product is queried. | The column in `productos` is updated on every consumption using Exponential Moving Average. | A background task runs nightly, calculates the 30-day window sum, and blends it with the seed value. |
| **Performance (Reads)** | **High overhead**: requires aggregate subqueries over `movimientos` joined with `lotes`. Slows down catalogs and paginated listings. | **Low overhead**: reads a single column from the `productos` table. | **Low overhead**: reads a single column from the `productos` table. |
| **Performance (Writes)** | **No overhead**: write transactions don't write to the `productos` table. | **High contention**: locks the `productos` row on every stock decrement, limiting concurrency. | **Very low overhead**: batch updates are run off-peak once every 24 hours. |
| **Math Correctness** | **Excellent**: reflects exact consumption over a strict sliding window. | **Flawed**: multiple small consumptions inflate the rate; zero-consumption periods do not decay because no event triggers the calculation. | **Excellent**: correctly decays the average on zero-consumption days. Blends seed values smoothly. |
| **Complexity** | **Medium**: requires complex SQL in listing/sorting endpoints. | **High**: requires complex logic to handle time deltas, transaction locks, and event decay. | **Low**: simple queries to fetch daily sums and update the columns in a loop. |
| **Blending Seed Data** | Difficult to balance automatically without complex SQL weight calculations. | Done by initializing the column. Subsequent updates modify it directly. | Easily handled by checking the product's age and blending: $P = \text{SUM} + (1 - \frac{T}{30}) \times P_{initial}$. |

---

## 4. Recommendation & Implementation Strategy

We strongly recommend **Option C: Scheduled Nightly Job** combined with **Option A fallback** for new products with less than 30 days of history.

### Implementation Workflow:
1. **Migration**: Add the `promedio_uso_mensual` and `promedio_uso_mensual_inicial` columns to the `productos` table.
2. **DTO & Handler integration**: Allow mapping the field when importing CSV or creating a product.
3. **Background Job**:
   - Create a background job similar to the `vencimientos_job` that runs every 24 hours.
   - For each product, it queries the sum of all `movimientos` of type `CONSUMO` in the last 30 days.
   - If the product was created less than 30 days ago, it blends the consumption sum with the starting data:
     $$P = \text{SUM}(C_{last\_T}) + (1 - \frac{T}{30}) \times P_{initial}$$
     where $T$ is the number of days since creation.
   - If $T \ge 30$, it simply updates the column with the sum of the last 30 days.
   - Update the `productos` row with the computed value.

---

## 5. Key Risks & Mitigation

- **High Write Contention**: If Option B is chosen, writing to the `productos` table on every consumption will cause lock contention. Option C completely mitigates this by decoupling writes.
- **Incorrect Decay**: If a product has no consumption for 2 weeks, its monthly average should decrease. Event-based triggers (Option B) fail here because no consumption occurs to trigger the decay. A nightly job (Option C) naturally updates the average daily, ensuring decay.
- **Import Mapping Miss**: If user CSV files don't use standard column names, the smart mapper might skip the seed value. We mitigate this by matching aliases (`promedio_uso_mensual`, `uso_mensual`, `promedio_uso`, `average_use`) and defaulting to `0.0`.
