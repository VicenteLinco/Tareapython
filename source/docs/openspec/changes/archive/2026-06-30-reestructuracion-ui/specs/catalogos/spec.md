# Catalogos Delta Specification — UI Restructuring (reestructuracion-ui)

## Purpose

Define the UI adjustments inside the Product Creator (Creador de Productos) dashboard to streamline master data management by removing obsolete tabs and renaming existing ones.

## Delta Requirements

### REQ-CAT-UI-01: Tab Renaming
The tab labeled "Presentaciones" MUST be renamed to "Formatos de Empaque".
- The underlying component reference and route parameter (`tab=presentaciones`) may remain unchanged to preserve bookmark compatibility.
- The user interface label MUST render as "Formatos de Empaque".

### REQ-CAT-UI-02: GTINs Tab Removal
The "GTINs" tab (`tab=gtins`) MUST be completely removed from the Creador de Productos page.
- GTIN management is now handled contextually within individual product edit flows, making the global list tab obsolete.

### REQ-CAT-UI-03: Áreas Tab Removal
The "Áreas" tab (`tab=areas`) MUST be removed from the Creador de Productos page.
- Area management is relocated to a standalone page `/areas` (specified in the Configuration domain delta).

---

## Scenarios

### Scenario: Admin views Creador de Productos tabs
Given the user is logged in as an administrator
When they navigate to the Creador de Productos page (`/creador-productos`)
Then the visible tabs MUST be:
  | Tab Label | Icon | Identifier |
  | Productos | Package | `productos` |
  | Catalogación | ShieldAlert | `catalogacion` |
  | Categorías | Tag | `categorias` |
  | Unidades | Layers | `unidades` |
  | Proveedores | Truck | `proveedores` |
  | Formatos de Empaque | LayoutList | `presentaciones` |
And the tabs "GTINs" and "Áreas" MUST NOT be visible on this page.

### Scenario: Admin accesses Formatos de Empaque tab
Given the user is on the Creador de Productos page
When they click the "Formatos de Empaque" tab
Then the system MUST render the packaging formats management view (formerly "Presentaciones")
And the browser URL search query MUST contain `tab=presentaciones`.
