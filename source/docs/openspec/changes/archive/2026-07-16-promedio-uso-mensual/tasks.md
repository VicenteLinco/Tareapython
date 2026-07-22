# Tasks: promedio-uso-mensual

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 150-250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Database & models | PR 1 | cargo test --test productos_test | sqlx migrator | Migration rollback / column drop |
| 2 | Nightly job calculation | PR 1 | cargo test --lib services::promedio_job | tokio runtime | Job registration revert |
| 3 | API integration | PR 1 | cargo test --lib handlers::productos | axum route registry | Route registration revert |

## Phase 1: Foundation (Database & Models)

- [x] 1.1 Create migration file `backend/migrations/016_add_promedio_uso_mensual_to_productos.sql` to add `promedio_uso_mensual` and `promedio_uso_mensual_inicial` to `productos`.
- [x] 1.2 Update the `Producto` struct in `backend/src/models/producto.rs` to include `promedio_uso_mensual` and `promedio_uso_mensual_inicial`.

## Phase 2: Core Logic (Recalculation Job)

- [x] 2.1 Implement recalculation job and age blending/decay formulas in `backend/src/services/promedio_job.rs`.
- [x] 2.2 Expose the module in `backend/src/services/mod.rs` and spawn it in `backend/src/main.rs`.

## Phase 3: Integration (Services & Handlers)

- [x] 3.1 Update product service structs (`CrearProductoParams`, `ActualizarProductoParams`, `ProductoRow`) in `backend/src/services/producto_service.rs` to support the new fields.
- [x] 3.2 Add the new columns to SQL queries in `crear_producto`, `actualizar_producto`, `listar` and `obtener_detalle` in `backend/src/services/producto_service.rs`.
- [x] 3.3 Update handler DTOs (`CreateProducto`, `UpdateProducto`, `ProductoListItem`) in `backend/src/handlers/productos.rs` to support the new fields.
- [x] 3.4 Update CSV importer mapping and insertion logic in `backend/src/services/setup_service.rs` to read and set `promedio_uso_mensual_inicial`.

## Phase 4: Testing & Verification

- [x] 4.1 Write unit tests for recalculation math and decay logic inside `backend/src/services/promedio_job.rs`.
- [x] 4.2 Write integration tests in `backend/tests/productos_test.rs` to verify nightly job, catalog CSV imports, and CRUD endpoint integration.
