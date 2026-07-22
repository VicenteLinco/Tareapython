# Proposal: Improve Consumption Forecast SBA

## Intent
Improve demand forecasting accuracy for intermittent and lumpy inventory items (characterized by many zero-consumption days and occasional large orders) to prevent stockouts and excessive safety stocks.

## Scope

### In Scope
- Implement SBC (Syntetos-Boylan-Crose) demand classification based on ADI and $CV^2$.
- Categorize demand patterns into: Smooth, Erratic, Intermittent, and Lumpy.
- Implement the Syntetos-Boylan Approximation (SBA) algorithm with $\alpha = 0.15$ for Intermittent and Lumpy demand.
- Keep winsorized EWMA ($\alpha = 0.20$) for Smooth and Erratic demand.
- Preserve existing short-history fallback when active consumption days are $<14$.
- Update `backend/src/services/forecast.rs` and write unit tests.

### Out of Scope
- Modifying UI views or frontend layouts.
- Database schema changes or migrations.
- Seasonal or multi-variate forecast models.

## Capabilities

### New Capabilities
- `pronostico-consumo`: Demand classification (Smooth, Erratic, Intermittent, Lumpy) and forecasting using EWMA or SBA.

### Modified Capabilities
- `configuracion`: Validation and rules governing forecast parameters.

## Approach
Compute ADI and $CV^2$ for items with $\ge 14$ consumption days.
- $\text{ADI} = \frac{\text{total\_days}}{\text{dias\_con\_consumo}}$
- $CV^2 = \frac{s_z^2}{\bar{z}^2}$ where $s_z^2$ is the sample variance of non-zero demands and $\bar{z}$ is their mean.

Classify items:
- Smooth: $\text{ADI} &lt; 1.32 \land CV^2 &lt; 0.49$
- Erratic: $\text{ADI} &lt; 1.32 \land CV^2 \ge 0.49$
- Intermittent: $\text{ADI} \ge 1.32 \land CV^2 &lt; 0.49$
- Lumpy: $\text{ADI} \ge 1.32 \land CV^2 \ge 0.49$

Apply EWMA for Smooth/Erratic, and SBA for Intermittent/Lumpy. SBA updates level $z$ and interval $p$ and applies the bias correction:
$$\mu_{SBA} = (1 - \frac{\alpha}{2}) \frac{z_n}{p_n}$$

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/services/forecast.rs` | Modified | Update `compute_forecast` with SBC classification and SBA forecast implementation. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Unstable classification on short history | Low | Keep existing short history fallback logic if active consumption days &lt; 14. |
| Parameter sensitivity | Low | Use standard default smoothing factor $\alpha = 0.15$. |

## Rollback Plan
Revert changes to `backend/src/services/forecast.rs` using `git checkout` to restore the previous EWMA-only implementation of `compute_forecast`.

## Dependencies
- None.

## Success Criteria
- [ ] Forecast logic correctly classifies demand into Smooth, Erratic, Intermittent, and Lumpy.
- [ ] SBA algorithm outputs flat forecasts during zero-consumption intervals.
- [ ] Unit tests cover EWMA and SBA paths with 100% pass rate.
