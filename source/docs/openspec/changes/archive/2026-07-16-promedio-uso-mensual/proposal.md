# Proposal: promedio-uso-mensual

## Intent
Products need a dynamic monthly consumption average (`promedio_uso_mensual`) for inventory optimization and planning. We need to allow an initial seed value during creation or import, and dynamically adjust it over time using consumption history with a weighted decay for new products (age < 30 days) and a simple 30-day window sum for older products.

## Scope

### In Scope
- Add `promedio_uso_mensual` and `promedio_uso_mensual_inicial` fields to database, models, and API endpoints.
- Seed the initial value from creation requests or CSV catalog imports.
- Implement a nightly background job that recalculates and decays this average.
- Blend the seed value with consumption history during the first 30 days of the product's life.

### Out of Scope
- Real-time recalculation of the average upon each consumption transaction (to avoid lock contention).
- Forecasting models beyond the 30-day moving average.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `productos`: Add monthly usage average to products.

## Approach
Implement Option 3 (Scheduled Nightly Job):
1. **Database Migration**: Add `promedio_uso_mensual` and `promedio_uso_mensual_inicial` to `productos`.
2. **DTO & Handler**: Update endpoints and smart CSV import mapper (`setup_service`) to accept the seed value using aliases (e.g., `promedio_uso`).
3. **Background Job**: Create a nightly task (`services/promedio_job`) to calculate the sum of `CONSUMO` movements in the last 30 days. For products younger than 30 days ($T < 30$), blend consumption sum with the seed using $P = \text{SUM} + (1 - \frac{T}{30}) \times P_{initial}$. For older products, $P = \text{SUM}$. Update the product's `promedio_uso_mensual`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/migrations/016_add_promedio_uso_mensual_to_productos.sql` | New | Add columns `promedio_uso_mensual` and `promedio_uso_mensual_inicial`. |
| `backend/src/models/producto.rs` | Modified | Add the new fields to `Producto` struct. |
| `backend/src/handlers/productos.rs` | Modified | Accept fields in DTOs and include in responses. |
| `backend/src/services/producto_service.rs` | Modified | Update SQL queries in CRUD actions. |
| `backend/src/services/setup_service.rs` | Modified | Map csv fields to seed the initial value. |
| `backend/src/services/promedio_job.rs` | New | Nightly background job logic. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Database write lock contention | Low | Write updates in off-peak hours via batch background job. |
| Missing CSV columns during import | Med | Match multiple aliases (`promedio_uso`, etc.) and default to `0.0`. |

## Rollback Plan
1. Revert database schema using a rollback migration script to drop the columns.
2. Revert codebase commits to remove the fields, DTO logic, and background job.

## Dependencies
- None

## Success Criteria
- [ ] Products have monthly usage average fields correctly populated upon creation/import.
- [ ] The nightly job successfully recalculates and updates `promedio_uso_mensual` for all products using consumption and decay math.
