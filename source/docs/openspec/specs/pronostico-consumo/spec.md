# Demand Forecasting Specification

## Purpose

Provide demand forecasting and classification (Smooth, Erratic, Intermittent, Lumpy) based on historical consumption patterns using EWMA and SBA algorithms.

## Requirements

### Requirement: Demand Pattern Classification (SBC)

The system SHALL classify products with $\ge 14$ consumption days into four demand categories based on Average Demand Interval (ADI) and Squared Coefficient of Variation ($CV^2$):

| Category | Conditions | Algorithm |
| :--- | :--- | :--- |
| **Smooth** | $\text{ADI} < 1.32 \land CV^2 < 0.49$ | EWMA ($\alpha = 0.20$) |
| **Erratic** | $\text{ADI} < 1.32 \land CV^2 \ge 0.49$ | EWMA ($\alpha = 0.20$) |
| **Intermittent** | $\text{ADI} \ge 1.32 \land CV^2 < 0.49$ | SBA ($\alpha = 0.15$) |
| **Lumpy** | $\text{ADI} \ge 1.32 \land CV^2 \ge 0.49$ | SBA ($\alpha = 0.15$) |

Where:
- $\text{ADI} = \frac{\text{total\_days\_in\_window}}{\text{active\_consumption\_days}}$
- $CV^2 = \frac{s_z^2}{\bar{z}^2}$ (where $s_z^2$ is the sample variance and $\bar{z}$ is the mean of non-zero demands)

If active consumption days are $< 14$, the system MUST use a short-history fallback estimator.

#### Scenario: Smooth Demand Classification and Forecast
- GIVEN a product history window of 60 days with 50 consumption days ($\text{ADI} = 1.20$)
- AND a non-zero demand variance and mean yielding $CV^2 = 0.10$
- WHEN the forecast is computed
- THEN the system MUST classify the demand pattern as Smooth
- AND compute the forecast using Winsorized EWMA ($\alpha = 0.20$)

#### Scenario: Erratic Demand Classification and Forecast
- GIVEN a product history window of 60 days with 50 consumption days ($\text{ADI} = 1.20$)
- AND a non-zero demand variance and mean yielding $CV^2 = 0.60$
- WHEN the forecast is computed
- THEN the system MUST classify the demand pattern as Erratic
- AND compute the forecast using Winsorized EWMA ($\alpha = 0.20$)

#### Scenario: Intermittent Demand Classification and Forecast
- GIVEN a product history window of 60 days with 15 consumption days ($\text{ADI} = 4.0$)
- AND a non-zero demand variance and mean yielding $CV^2 = 0.30$
- WHEN the forecast is computed
- THEN the system MUST classify the demand pattern as Intermittent
- AND compute the forecast using Syntetos-Boylan Approximation (SBA) ($\alpha = 0.15$)

#### Scenario: Lumpy Demand Classification and Forecast
- GIVEN a product history window of 60 days with 15 consumption days ($\text{ADI} = 4.0$)
- AND a non-zero demand variance and mean yielding $CV^2 = 0.80$
- WHEN the forecast is computed
- THEN the system MUST classify the demand pattern as Lumpy
- AND compute the forecast using Syntetos-Boylan Approximation (SBA) ($\alpha = 0.15$)

#### Scenario: Fallback for Short History
- GIVEN a product history with only 5 consumption days
- WHEN the forecast is computed
- THEN the system MUST classify confidence as Low
- AND apply the short-history fallback estimator

### Requirement: Syntetos-Boylan Approximation (SBA) Calculation

The system MUST compute the SBA forecast by updating the demand level ($z$) and demand interval ($p$) chronologically, applying a bias correction at the end of the history window.

The level ($z$) and interval ($p$) updates on day $t$ with demand $y_t$ SHALL follow:
- If $y_t > 0$:
  - $z_{t+1} = \alpha \cdot y_t + (1 - \alpha) \cdot z_t$
  - $p_{t+1} = \alpha \cdot q_t + (1 - \alpha) \cdot p_t$
  - $q_{t+1} = 1$
- If $y_t = 0$:
  - $z_{t+1} = z_t$
  - $p_{t+1} = p_t$
  - $q_{t+1} = q_t + 1$

The final expected daily demand $\mu_{SBA}$ MUST be calculated as:
$$\mu_{SBA} = \left(1 - \frac{\alpha}{2}\right) \cdot \frac{z_n}{p_n}$$

#### Scenario: SBA forecast flat during zero periods
- GIVEN an intermittent product with active level $z = 10.0$ and interval $p = 4.0$
- WHEN zero-consumption days occur consecutively
- THEN the SBA forecast level $z$ and interval $p$ MUST remain unchanged
- AND the final forecast MUST stay constant (flat) until the next non-zero demand
