## Exploration: SBC Segmentation and SBA Forecast for Intermittent/Lumpy Demand

### Current State
Currently, the consumption forecast is computed in [forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs). The function `compute_forecast` determines the expected daily demand ($\mu$) as follows:
- Counts the number of days with consumption (`dias_con_consumo`) in the historical series (retrieved in [solicitud_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/solicitud_service.rs)).
- If `dias_con_consumo` is less than `cfg.dias_minimos_historia` (default 14), it classifies confidence as `Baja` and uses a short history estimator or returns a zero forecast.
- If `dias_con_consumo >= 14` (confidence `Alta` or `Media`), it winsorizes the series to the 95th percentile of non-zeroes to remove outliers, and then calculates:
  - $\mu$ using a simple Exponentially Weighted Moving Average (EWMA) with $\alpha = 0.2$ over the winsorized series.
  - $\sigma$ using standard sample deviation.
  - Safety stock, target stock, and reorder point based on $\mu$, $\sigma$, and lead time.

**Problem:** For intermittent or lumpy demand patterns (many days with zero demand, interspersed with occasional large orders), EWMA performs poorly:
- Right after a demand occurrence, the forecast spikes.
- During the subsequent zero-demand periods, the forecast exponentially decays toward zero.
- This creates highly unstable demand estimates, leading to incorrect target stock and reorder point calculations.

### Affected Areas
- [backend/src/services/forecast.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/forecast.rs) — Needs implementation of the SBC segmentation (ADI and $CV^2$ calculation), the Croston/SBA algorithm, and corresponding unit tests.
- [backend/src/services/solicitud_service.rs](file:///home/vdev/desarrollo/Tareapython/backend/src/services/solicitud_service.rs) — Purely calling/consumption path, no changes to database queries are strictly required because `compute_forecast` signatures can be preserved. We may optionally expose the category in the reasons or API response.

### Approaches

1. **SBC Segmentation + SBA for Intermittent/Lumpy Demand (Recommended)**
   - **Description**: Classify products into four categories (Smooth, Erratic, Intermittent, Lumpy) based on:
     - **ADI (Average Demand Interval)**: $\frac{n}{N}$, where $n$ is total days in series (typically 60 or 61), and $N$ is `dias_con_consumo`.
     - **$CV^2$ (Squared Coefficient of Variation)**: $\frac{s_z^2}{\bar{z}^2}$ where $s_z^2$ is the sample variance of the non-zero demands and $\bar{z}$ is their mean.
     - Thresholds: ADI cut-off = 1.32, $CV^2$ cut-off = 0.49.
     - Apply EWMA to **Smooth** and **Erratic** products.
     - Apply the **Syntetos-Boylan Approximation (SBA)** to **Intermittent** and **Lumpy** products using a standard smoothing parameter $\alpha = 0.15$.
   - **Pros**:
     - Eliminates exponential decay during zero periods for intermittent demand (forecast stays flat until next event).
     - SBA corrects Croston's positive bias.
     - Retains simple EWMA for regular demand patterns where it works best.
   - **Cons**:
     - Slightly more complex mathematical calculations.
   - **Effort**: Medium

2. **Keep Simple EWMA (Current State)**
   - **Description**: Retain the existing EWMA model for all products with sufficient history.
   - **Pros**:
     - No code changes.
   - **Cons**:
     - Over-forecasting right after isolated demand events.
     - False signal decay during zero-demand intervals, leading to incorrect inventory suggestions.
   - **Effort**: Low

### Recommendation
Implement **Approach 1 (SBC Segmentation + SBA)**. Intermittent and lumpy demand represents a significant portion of warehouse products (reagents, surgical kits, slow-moving items). Using SBA will prevent over-ordering and stockouts caused by EWMA lag and decay.

### Mathematical Design Details
- **Classification**:
  - ADI $= \frac{\text{total\_days}}{\text{dias\_con\_consumo}}$
  - Mean of active demands $\bar{z} = \frac{1}{N} \sum_{i=1}^N y_{\text{active}, i}$
  - Variance of active demands $s_z^2 = \frac{1}{N-1} \sum_{i=1}^N (y_{\text{active}, i} - \bar{z})^2$ (if $N > 1$, else $0.0$)
  - $CV^2 = \frac{s_z^2}{\bar{z}^2}$ (if $\bar{z} > 0.0$, else $0.0$)
  - Category:
    - **Smooth**: ADI $< 1.32$ and $CV^2 < 0.49$
    - **Erratic**: ADI $< 1.32$ and $CV^2 \ge 0.49$
    - **Intermittent**: ADI $\ge 1.32$ and $CV^2 < 0.49$
    - **Lumpy**: ADI $\ge 1.32$ and $CV^2 \ge 0.49$
- **Croston/SBA Calculation** (chronological over `serie`):
  - Initialize $z_0 = \bar{z}$, $p_0 = \text{ADI}$, $q_0 = 1.0$, $\alpha = 0.15$.
  - For each day $t$:
    - If $y_t > 0.0$:
      - $z_{t+1} = \alpha \cdot y_t + (1.0 - \alpha) \cdot z_t$
      - $p_{t+1} = \alpha \cdot q_t + (1.0 - \alpha) \cdot p_t$
      - $q_{t+1} = 1.0$
    - If $y_t == 0.0$:
      - $z_{t+1} = z_t$
      - $p_{t+1} = p_t$
      - $q_{t+1} = q_t + 1.0$
  - Final $\mu_{SBA} = (1.0 - \frac{\alpha}{2.0}) \cdot \frac{z_n}{p_n}$
- **Standard Deviation ($\sigma$)**:
  - Keep winsorized sample standard deviation `stddev_sample(&serie_w)` for all categories to maintain compatibility with safety stock calculations.

### Risks
- **Low history transition**: For items with very short history, SBC classification might be unstable. We should keep the current `estimate_short_history_demand` fallback when `dias_con_consumo < 14`.
- **Parameter Sensitivity**: The choice of $\alpha = 0.15$ is a standard default, but highly dynamic demands might need configuration. However, $0.15$ is historically very robust for general warehouse intermittent stock.

### Ready for Proposal
Yes. The orchestrator should proceed to `sdd-propose` to create the proposal.md for `improve-consumption-forecast-sba`.
