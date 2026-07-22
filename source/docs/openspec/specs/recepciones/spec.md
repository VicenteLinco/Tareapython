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

### Requirement: UI Restructuring (reestructuracion-ui)

#### REQ-REC-UI-01: Sidebar Rename
The sidebar link under the "Compras" group formerly labeled "Guías de Despacho" MUST be renamed to "Adquisiciones".
- The route path `/ordenes-compra` remains unchanged.
- The view header title for this route is updated to reflect the new navigation context.

#### REQ-REC-UI-02: Tab Renaming in Acquisitions
Inside the Acquisitions page (`/ordenes-compra`), the tab "Solicitudes de Compra Respaldadas" MUST be renamed to "Órdenes de Compra".

#### REQ-REC-UI-03: Tab Removal in Acquisitions
The tab "Guías de Despacho Respaldadas" (which hosts the delivery guide image gallery) MUST be removed from the Acquisitions page (`/ordenes-compra`).

#### REQ-REC-UI-04: Tab Addition in Receptions
A new tab labeled "Guías Respaldadas" MUST be added to the Receptions page (`/recepciones`).
- This tab hosts the delivery guide photo gallery migrated from the Acquisitions page.
- It displays a paginated grid of confirmed receptions with attached delivery guide images.
- It supports searching by guide number, supplier name, or reception document number.

#### Scenarios: UI Restructuring

##### Scenario: Admin views Compras sidebar group
Given the user is logged in
When they inspect the sidebar under the "Compras" group
Then they MUST see the following links:
  | Label | Destination Route |
  | Solicitudes | `/solicitudes-compra` |
  | Adquisiciones | `/ordenes-compra` |

##### Scenario: Admin views Acquisitions tabs
Given the user is on the `/ordenes-compra` page
When the page renders
Then they MUST see the tab "Órdenes de Compra"
And the tab "Guías de Despacho Respaldadas" and its gallery MUST NOT be present.

##### Scenario: Admin views Receptions tabs
Given the user is on the `/recepciones` page
When the page renders
Then they MUST see the following tabs:
  | Tab Label | Tab Identifier |
  | Borradores | `borradores` |
  | Confirmadas | `confirmadas` |
  | Todas | `todas` |
  | Guías Respaldadas | `guias` |

##### Scenario: Admin accesses Guías Respaldadas tab in Receptions
Given the user is on the `/recepciones` page
When they click the "Guías Respaldadas" tab
Then the page MUST display a gallery of delivery guide documents associated with confirmed receptions
And the search input inside this tab MUST filter results by guide number, supplier name, or reception document number.
