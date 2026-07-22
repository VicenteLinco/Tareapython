# Delta for configuracion

## ADDED Requirements

### Requirement: Forecasting Configuration Management

The system MUST support reading and updating forecasting parameters with validation constraints.

| Setting | Database Key | Type | Constraints | Default |
| :--- | :--- | :--- | :--- | :--- |
| `ventana_consumo_dias` | `ventana_demanda_dias` | Integer | MUST be >= 14 | `60` |
| `factor_historial_corto` | `factor_historial_corto` | Float | MUST be between 0.0 and 1.0 | `0.35` |
| `periodo_revision_dias` | `periodo_revision_dias` | Integer | MUST be >= 1 | `30` |

The setting `ventana_consumo_dias` (API parameter) maps to the database configuration key `ventana_demanda_dias`. Both names refer to the same logical history window length.

#### Scenario: Update forecasting parameters with valid values
- GIVEN the user is logged in as an administrator
- WHEN the user updates configuration setting `ventana_consumo_dias` to 45, `factor_historial_corto` to 0.40, and `periodo_revision_dias` to 20
- THEN the settings SHALL be saved successfully and returned in subsequent read requests

#### Scenario: Reject forecasting configuration with invalid demand window
- GIVEN the user is logged in as an administrator
- WHEN the user attempts to update `ventana_consumo_dias` to 10
- THEN the system MUST reject the update with a validation error
