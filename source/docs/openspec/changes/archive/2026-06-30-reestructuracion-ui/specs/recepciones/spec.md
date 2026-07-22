# Receptions Delta Specification — UI Restructuring (reestructuracion-ui)

## Purpose

Define the updates to the sidebar navigation for procurement and reorganization of tab panels between the Acquisitions page (`/ordenes-compra`) and the Receptions page (`/recepciones`).

## Delta Requirements

### REQ-REC-UI-01: Sidebar Rename
The sidebar link under the "Compras" group formerly labeled "Guías de Despacho" MUST be renamed to "Adquisiciones".
- The route path `/ordenes-compra` remains unchanged.
- The view header title for this route is updated to reflect the new navigation context.

### REQ-REC-UI-02: Tab Renaming in Acquisitions
Inside the Acquisitions page (`/ordenes-compra`), the tab "Solicitudes de Compra Respaldadas" MUST be renamed to "Órdenes de Compra".

### REQ-REC-UI-03: Tab Removal in Acquisitions
The tab "Guías de Despacho Respaldadas" (which hosts the delivery guide image gallery) MUST be removed from the Acquisitions page (`/ordenes-compra`).

### REQ-REC-UI-04: Tab Addition in Receptions
A new tab labeled "Guías Respaldadas" MUST be added to the Receptions page (`/recepciones`).
- This tab hosts the delivery guide photo gallery migrated from the Acquisitions page.
- It displays a paginated grid of confirmed receptions with attached delivery guide images.
- It supports searching by guide number, supplier name, or reception document number.

---

## Scenarios

### Scenario: Admin views Compras sidebar group
Given the user is logged in
When they inspect the sidebar under the "Compras" group
Then they MUST see the following links:
  | Label | Destination Route |
  | Solicitudes | `/solicitudes-compra` |
  | Adquisiciones | `/ordenes-compra` |

### Scenario: Admin views Acquisitions tabs
Given the user is on the `/ordenes-compra` page
When the page renders
Then they MUST see the tab "Órdenes de Compra"
And the tab "Guías de Despacho Respaldadas" and its gallery MUST NOT be present.

### Scenario: Admin views Receptions tabs
Given the user is on the `/recepciones` page
When the page renders
Then they MUST see the following tabs:
  | Tab Label | Tab Identifier |
  | Borradores | `borradores` |
  | Confirmadas | `confirmadas` |
  | Todas | `todas` |
  | Guías Respaldadas | `guias` |

### Scenario: Admin accesses Guías Respaldadas tab in Receptions
Given the user is on the `/recepciones` page
When they click the "Guías Respaldadas" tab
Then the page MUST display a gallery of delivery guide documents associated with confirmed receptions
And the search input inside this tab MUST filter results by guide number, supplier name, or reception document number.
