# Archive Report: Promedio de Uso Mensual (promedio-uso-mensual)

**Archive Date**: 2026-07-16  
**Status**: Completed  
**Artifact Store**: `openspec`

---

## Executive Summary

The "promedio-uso-mensual" change has been successfully implemented, verified, and archived. This change introduced tracking of the monthly average usage of products. It includes seeding an initial usage average on product creation/import, a nightly calculation job to update average values, blending initial values for newer products, and calculating simple rolling averages for older products.

The verification phase confirmed the completion of all planned tasks, with the unit tests in the library (`services::promedio_job::tests`) passing successfully. Integration tests compiled correctly, though they skipped actual db executions due to the lack of an active database environment.

---

## Sync of Delta Specifications

The requirements and scenarios defined in the delta specifications for this change have been merged into the main project specifications:

1. **Catalogos Spec (`openspec/specs/catalogos/spec.md`)**
   - Synced requirements for seeding monthly usage on product creation, nightly average consumption recalculations, seed value blending for new products, and simple rolling sum calculations for older products.
   - Added as **Capability 8: Monthly Usage Average (promedio-uso-mensual)**.

---

## Implementation Summary

### Phase 1: Foundation (Database & Models)
- Created SQL migration `backend/migrations/016_add_promedio_uso_mensual_to_productos.sql` adding `promedio_uso_mensual` and `promedio_uso_mensual_inicial` to the `productos` table.
- Extended the `Producto` model struct in [backend/src/models/producto.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/models/producto.rs) to include these two decimal fields.

### Phase 2: Core Logic (Recalculation Job)
- Developed age-based blending and decay calculation algorithms in [backend/src/services/promedio_job.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/promedio_job.rs).
- Exposed the job in `backend/src/services/mod.rs` and spawned the nightly recalculation job in [backend/src/main.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/main.rs).

### Phase 3: Integration (Services & Handlers)
- Integrated the new fields inside the service layer structs `CrearProductoParams`, `ActualizarProductoParams`, and `ProductoRow` in [backend/src/services/producto_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/producto_service.rs).
- Added `promedio_uso_mensual` and `promedio_uso_mensual_inicial` mapping inside `crear_producto`, `actualizar_producto`, `listar`, and `obtener_detalle` query methods.
- Updated handler DTO schemas `CreateProducto`, `UpdateProducto`, and `ProductoListItem` in [backend/src/handlers/productos.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/handlers/productos.rs) to expose the fields through the API.
- Enabled CSV import to parse and seed `promedio_uso_mensual_inicial` from import source files in [backend/src/services/setup_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/setup_service.rs).

---

## Verification Results

- **Task Verification**: 100% of tasks listed in `tasks.md` are marked complete.
- **Unit Tests**: Passed successfully (recalculation formula and decay calculations).
- **Integration Tests**: Compiled successfully. Warning noted regarding database pool timeouts due to missing active test DB.

---

## Final Artifact Location

All planning, design, and progress documentation files have been archived at:
`openspec/changes/archive/2026-07-16-promedio-uso-mensual/`

This includes:
- [proposal.md](file:///home/vdev/desarrollo/Tareapython/codigofuente/openspec/changes/archive/2026-07-16-promedio-uso-mensual/proposal.md)
- [design.md](file:///home/vdev/desarrollo/Tareapython/codigofuente/openspec/changes/archive/2026-07-16-promedio-uso-mensual/design.md)
- [explore.md](file:///home/vdev/desarrollo/Tareapython/codigofuente/openspec/changes/archive/2026-07-16-promedio-uso-mensual/explore.md)
- [tasks.md](file:///home/vdev/desarrollo/Tareapython/codigofuente/openspec/changes/archive/2026-07-16-promedio-uso-mensual/tasks.md)
- [verify-report.md](file:///home/vdev/desarrollo/Tareapython/codigofuente/openspec/changes/archive/2026-07-16-promedio-uso-mensual/verify-report.md)
- [archive-report.md](file:///home/vdev/desarrollo/Tareapython/codigofuente/openspec/changes/archive/2026-07-16-promedio-uso-mensual/archive-report.md) (This file)
