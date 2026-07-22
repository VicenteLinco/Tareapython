# Design: Improve Consumption Forecast SBA

## Technical Approach
We will update `compute_forecast` in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) to categorize items into one of the four Syntetos-Boylan-Crose (SBC) quadrants when active history is sufficient ($\ge 14$ days). Items categorized as Smooth or Erratic will continue to use winsorized EWMA ($\alpha = 0.20$). Items classified as Intermittent or Lumpy will use the Syntetos-Boylan Approximation (SBA) with $\alpha = 0.15$ to avoid exponential decay of forecast levels during zero-consumption intervals.

### Calculations
1. **SBC Classification Metrics**:
   - $\text{ADI} = \frac{\text{total\_days\_in\_window}}{\text{active\_consumption\_days}}$
   - $CV^2 = \frac{s_z^2}{\bar{z}^2}$ (where $s_z^2$ is the sample variance and $\bar{z}$ is the mean of non-zero demands)
   - Quadrant criteria:
     - **Smooth**: $\text{ADI} < 1.32 \land CV^2 < 0.49$
     - **Erratic**: $\text{ADI} < 1.32 \land CV^2 \ge 0.49$
     - **Intermittent**: $\text{ADI} \ge 1.32 \land CV^2 < 0.49$
     - **Lumpy**: $\text{ADI} \ge 1.32 \land CV^2 \ge 0.49$
2. **SBA Forecast Simulation**:
   - Initialize level $z_0 = \bar{z}$, interval $p_0 = \text{ADI}$, and $q_0 = 1.0$.
   - Iterate chronologically through the raw `serie_diaria`:
     - If $y_t > 0$: $z_{t+1} = 0.15 y_t + 0.85 z_t$; $p_{t+1} = 0.15 q_t + 0.85 p_t$; $q_{t+1} = 1.0$
     - If $y_t = 0$: $z_{t+1} = z_t$; $p_{t+1} = p_t$; $q_{t+1} = q_t + 1.0$
   - Final forecast $\mu_{\text{SBA}} = (1 - \frac{0.15}{2}) \frac{z_n}{p_n} = 0.925 \frac{z_n}{p_n}$.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice & Rationale |
| :--- | :--- | :--- | :--- |
| **Forecasting Algorithm** | SBA vs Croston | Croston has positive forecast bias (over-forecasting) because it updates level and interval synchronously. SBA corrects this bias by scaling with $(1 - \alpha/2)$. | **SBA** selected as standard for slow-moving/intermittent stock. |
| **Outlier Handling** | Winsorization vs Raw | Winsorizing (95th percentile) reduces outlier spikes for EWMA. For SBA, raw demand is preferred since zero days and spikes represent the actual intermittent pattern. | **Winsorized EWMA** for Smooth/Erratic; **Raw SBA** for Intermittent/Lumpy. |
| **Standard Deviation ($\sigma$)** | Winsorized StdDev vs Analytical StdDev | Changing the standard deviation calculation could alter safety stock behavior unpredictably. Keeping it winsorized preserves compatibility. | **Winsorized sample stddev** used for all categories. |
| **Smoothing Factor ($\alpha$)** | $\alpha = 0.15$ vs config | Hardcoded parameter is standard, simple, and matches industry defaults (Syntetos & Boylan). Dynamic config increases complexity. | **$\alpha = 0.15$** chosen for SBA, maintaining standard EWMA $\alpha = 0.20$. |

## Data Flow

```
[Database] 
   │
   ▼ (SQL Query)
[Service/Handler Layers] (solicitud_service.rs / recepcion_service.rs)
   │
   ├─► Calls compute_forecast(&serie, stock_actual, ya_pedido, lead_time, cfg)
   │     │
   │     ▼
   │   [forecast.rs]
   │     ├─► Check confidence / History length
   │     ├─► If < 14 days: Short History Fallback
   │     └─► If >= 14 days:
   │           ├─► Compute ADI and CV^2
   │           ├─► Classify: Smooth | Erratic | Intermittent | Lumpy
   │           ├─► Apply EWMA (Smooth/Erratic) OR SBA (Intermittent/Lumpy)
   │           └─► Compute μ, σ (winsorized), safety/target stock, ROP, amount
   │
   ▼ (ForecastResult)
[Service Layer] ──► [Axum Handler] ──► [HTTP Response / JSON]
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) | Modify | Integrate ADI and $CV^2$ calculation, SBC demand classification, and SBA algorithm simulation. Update tests and add new quadrant unit tests. |

## Interfaces / Contracts

The signature of `compute_forecast` and the structure of `ForecastResult` are fully preserved. No DB schema changes, TypeScript mappings, or Axum handler/service definitions need updates as all interfaces are kept unchanged.

```rust
// Signature in backend/src/services/forecast.rs (preserved)
pub fn compute_forecast(
    serie_diaria: &[f64],
    stock_actual: f64,
    ya_pedido: f64,
    lead_time_dias: i32,
    cfg: ForecastConfig,
) -> ForecastResult;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | SBC Classification & SBA Forecast | Assert correct classification and forecast values for Smooth, Erratic, Intermittent, and Lumpy series. Verify SBA flat output on zero-demand periods. |
| Unit | Regression | Ensure existing tests (`forecast_consumo_estable`, `forecast_sin_historia`, etc.) pass. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No database migrations or configuration table changes are required. The changes are fully backwards compatible at the function level. Rollback is achieved by reverting `forecast.rs` changes.

## Open Questions

None.
