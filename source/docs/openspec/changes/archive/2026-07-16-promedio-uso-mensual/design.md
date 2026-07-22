# Design: Promedio de Uso Mensual

## Technical Approach

To enable consumption planning and inventory optimization, we will implement a nightly background job (`services/promedio_job.rs`) that recalculates the rolling 30-day average monthly consumption (`promedio_uso_mensual`) for all products.
During product creation or catalog import, we accept an initial seed value (`promedio_uso_mensual_inicial`). For products younger than 30 days, we blend this initial value with actual consumption using the decay formula:
$$P_{adjusted} = \text{Sum}_{30d} + \left(1 - \frac{\text{Age\_Days}}{30}\right) \times P_{initial}$$
For older products ($\ge 30$ days), the average is simply the sum of actual consumptions over the last 30 days.

This approach maps directly to the proposal's Option 3, avoiding write lock contention on main product tables during peak hours and ensuring decay when no consumption events occur.

## Architecture Decisions

| Option | Tradeoff | Decision | Rationale |
| :--- | :--- | :--- | :--- |
| **Option A**: On-the-fly calculation | High read latency, complex SQL joins on every list query. | **Rejected** | Performance overhead is too high for product catalogs and listing pages. |
| **Option B**: Event-driven update on consumption | High database write lock contention on the `productos` table; fails to decay on zero-consumption days. | **Rejected** | Locks products table during critical stock operations. Does not decay average when there are no transactions. |
| **Option C**: Nightly background calculation | Updates lag by up to 24 hours. | **Chosen** | Decouples read/write performance. Ensures accurate decay and simple blending math using a single daily transaction. |

## Data Flow

```
[CSV Import / API Create] ─► Set promedio_uso_mensual_inicial
                                        │
                                        ▼
[PostgreSQL Database] ◄───── Nightly Job Recalculation
                                        │
    ┌───────────────────────────────────┴───────────────────────────────────┐
    ▼ (Age < 30 days)                                                       ▼ (Age >= 30 days)
    P = Sum_30d + (1 - Age_Days/30)*P_initial                               P = Sum_30d
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/migrations/016_add_promedio_uso_mensual_to_productos.sql` | Create | Database migration to add columns `promedio_uso_mensual` and `promedio_uso_mensual_inicial` to `productos` table. |
| `backend/src/models/producto.rs` | Modify | Add the new columns to the Rust `Producto` model struct. |
| `backend/src/handlers/productos.rs` | Modify | Update handler DTOs (`CreateProducto`, `UpdateProducto`, `ProductoListItem`) and routes to support fields. |
| `backend/src/services/producto_service.rs` | Modify | Update product listing, detail, creation, and update queries to include the new fields. |
| `backend/src/services/setup_service.rs` | Modify | Update the CSV importer mapper to read `promedio_uso_mensual_inicial` with aliases and insert it. |
| `backend/src/services/promedio_job.rs` | Create | Implement the nightly calculation task and the query to update the database. |
| `backend/src/services/mod.rs` | Modify | Expose the new `promedio_job` module. |
| `backend/src/main.rs` | Modify | Initialize and spawn the `promedio_job` background task. |

## Interfaces / Contracts

### Database Migration Schema
```sql
-- Migration: Add promedio_uso_mensual to productos
ALTER TABLE public.productos 
  ADD COLUMN promedio_uso_mensual numeric(12,4) DEFAULT 0.0000 NOT NULL,
  ADD COLUMN promedio_uso_mensual_inicial numeric(12,4) DEFAULT 0.0000 NOT NULL;
```

### Rust API DTO Changes
In `backend/src/handlers/productos.rs`:
```rust
struct CreateProducto {
    // ...
    promedio_uso_mensual_inicial: Option<Decimal>,
}

struct UpdateProducto {
    // ...
    promedio_uso_mensual_inicial: Option<Decimal>,
}

struct ProductoListItem {
    // ...
    promedio_uso_mensual: Decimal,
    promedio_uso_mensual_inicial: Decimal,
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Math blending & age decay | In `services/promedio_job.rs`, unit test `calcular_promedio` logic for age < 30 days (blended) and >= 30 days (pure consumption), checking clamp boundaries. |
| Integration | End-to-end endpoint & job run | In `tests/productos_test.rs`, create a product with initial seed value, import CSV with alias mapping, simulate consumption, call `ejecutar_recalculo_promedios`, and assert database values. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

- Run migration `016_add_promedio_uso_mensual_to_productos.sql` to initialize both columns to `0.0000` for existing products.
- Backfill or allow manual correction of the initial seed values as needed.
- No phased rollout or feature flags are required.

## Open Questions

- None
