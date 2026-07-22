# Receptions Specification

## Purpose

Handle incoming inventory receptions and perform validation on expiration dates, calculating projected waste and flags during line entry and confirmation.

## Requirements

### Requirement: Expiration Validation Endpoint
The backend MUST expose a `POST /recepciones/validar-vencimiento` endpoint that calculates projected waste and active alert flags based on current configuration and consumption rates.

| Input Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `producto_id` | Integer | Yes | The product being received |
| `cantidad` | Integer | Yes | Quantity in reception line |
| `fecha_vencimiento` | Date | Yes | Expiration date of the lot |

| Output Parameter | Type | Description |
| :--- | :--- | :--- |
| `desperdicio_proyectado` | Integer | Estimated units that will expire before consumption |
| `alerta_vencimiento` | Boolean | True if shelf life is short or waste exceeds tolerance |

#### Scenario: Validate reception line with low risk
- GIVEN `vencimiento_alerta_activa` is `true`
- WHEN calling `/recepciones/validar-vencimiento` with sufficient shelf life and no projected waste
- THEN the system SHALL return `desperdicio_proyectado` as 0 and `alerta_vencimiento` as `false`

#### Scenario: Validate reception line with high waste risk
- GIVEN `vencimiento_alerta_activa` is `true` and the consumption forecast shows 20 units will expire
- WHEN calling `/recepciones/validar-vencimiento` for 100 units
- THEN the system SHALL return `desperdicio_proyectado` as 20 and `alerta_vencimiento` as `true`

### Requirement: Save Expiration Alert on Confirmation
When confirming a reception, the system MUST persist the `alerta_vencimiento` flag state on each reception line detail.

#### Scenario: Save line details with expiration flag
- GIVEN a reception line triggered an expiration warning during validation
- WHEN the user confirms the reception
- THEN the system MUST save `alerta_vencimiento` as `true` in `recepcion_detalle` for that line
