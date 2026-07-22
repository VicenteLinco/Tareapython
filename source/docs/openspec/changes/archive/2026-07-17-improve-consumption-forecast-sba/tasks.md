# Tasks: Improve Consumption Forecast SBA

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 150-250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Implement SBC categorization, SBA calculation, and routing in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) | PR 1 | `cargo test services::forecast::tests` | N/A: pure logic function | [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) |

## Phase 1: Foundation (Enums and Classification)

- [x] 1.1 RED: Write failing test `test_sbc_classification` verifying classification logic for ADI and $CV^2$ in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 1.2 GREEN: Add [SbcCategory](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) enum and classification logic in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 1.3 REFACTOR: Clean up metrics calculation helper methods in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).

## Phase 2: Core Algorithm (SBA Implementation & Routing)

- [x] 2.1 RED: Write failing test `test_sba_simulation` validating SBA simulation updates over chronological series in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 2.2 GREEN: Implement SBA simulation algorithm logic in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 2.3 RED: Write failing test `test_compute_forecast_routing` verifying EWMA vs SBA routing in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 2.4 GREEN: Update [compute_forecast](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs#L249-L355) in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) to route by [SbcCategory](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) and preserve short history fallbacks when `dias_con_consumo < 14`.
- [x] 2.5 REFACTOR: Simplify routing flow and remove temporary test code in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).

## Phase 3: Verification

- [x] 3.1 RED: Write failing test `test_sbc_quadrants_coverage` covering all 4 SBC quadrants (Smooth, Erratic, Intermittent, Lumpy) in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 3.2 GREEN: Verify all new and existing tests pass using `cargo test` in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).
- [x] 3.3 REFACTOR: Run `cargo clippy` and `cargo fmt` to clean up code in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs).

## Phase 4: Configuration Validation (Remediation)

- [x] 4.1 RED: Write failing integration tests for validating configuration parameters (ventana_consumo_dias < 14, factor_historial_corto out of [0, 1], and periodo_revision_dias < 1) in [configuracion_test.rs](file:///home/vdev/desarrollo/Tareapython/backend/tests/configuracion_test.rs).
- [x] 4.2 GREEN: Implement validation checks and map ventana_consumo_dias to ventana_demanda_dias key in [configuracion_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/configuracion_service.rs).
- [x] 4.3 REFACTOR: Run cargo clippy and cargo fmt to ensure high code quality.
