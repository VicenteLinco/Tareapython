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

### Requirement: Standalone Areas Configuration (reestructuracion-ui)

#### REQ-CFG-UI-01: Standalone Areas Route
The application MUST support a new standalone route `/areas` dedicated to Areas Management.
- Only users with administrative privileges (`adminOnly: true`) are authorized to access this route.
- Standard users attempting to access `/areas` MUST be redirected to the root dashboard or shown an access denied message.

#### REQ-CFG-UI-02: Sidebar Navigation Link
A new navigation link labeled "Áreas" MUST be added under the "Sistema" group in the sidebar.
- The link MUST point to the `/areas` route.
- The link MUST be restricted to administrative users.

#### REQ-CFG-UI-03: Area Management Migration
The "Áreas" management view MUST retain its full operational capabilities when loaded in the standalone page `/areas`:
- List all existing areas with name and description.
- Create new areas with validation on name (unique, non-empty).
- Edit existing area details.

#### Scenarios: Standalone Areas Configuration

##### Scenario: Admin views Sistema sidebar group
Given the user is logged in as an administrator
When they inspect the sidebar under the "Sistema" group
Then they MUST see the following links:
  | Label | Destination Route |
  | Usuarios | `/usuarios` |
  | Áreas | `/areas` |
  | Configuración | `/configuracion` |
  | Audit Log | `/audit-log` |

##### Scenario: Non-admin views Sistema sidebar group
Given the user is logged in as a standard operator
When they inspect the sidebar under the "Sistema" group
Then they MUST NOT see the "Áreas" link.

##### Scenario: Admin accesses standalone Areas page
Given the user is logged in as an administrator
When they navigate to `/areas`
Then the standalone Areas management page MUST load successfully
And they should be able to create, list, and edit inventory areas.

##### Scenario: Non-admin attempts to access Areas page
Given the user is logged in as a standard operator
When they attempt to directly navigate to `/areas`
Then the system MUST block access and redirect the user to the root dashboard `/`.

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

