# Configuration Specification

## Purpose

Define and manage system-wide settings for expiration alerts, shelf life, and consumption tolerance margins.

## Requirements

### Requirement: Expiration Settings Management
The system MUST support reading and updating expiration settings with validation constraints.

| Setting | Type | Constraints | Default |
| :--- | :--- | :--- | :--- |
| `vencimiento_alerta_activa` | Boolean | None | `true` |
| `vencimiento_vida_util_minima_dias` | Integer | MUST be >= 0 | `30` |
| `vencimiento_margen_tolerancia_pct` | Integer | MUST be between 0 and 100 | `10` |

#### Scenario: Update configuration with valid values
- GIVEN the user is logged in as an administrator
- WHEN the user updates configuration setting `vencimiento_vida_util_minima_dias` to 45 and `vencimiento_margen_tolerancia_pct` to 15
- THEN the settings SHALL be saved successfully and returned in subsequent read requests

#### Scenario: Reject configuration with invalid margin percentage
- GIVEN the user is logged in as an administrator
- WHEN the user attempts to update `vencimiento_margen_tolerancia_pct` to 120 or -5
- THEN the system MUST reject the update with a validation error
