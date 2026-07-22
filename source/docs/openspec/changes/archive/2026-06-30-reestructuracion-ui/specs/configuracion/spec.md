# Configuration Delta Specification — UI Restructuring (reestructuracion-ui)

## Purpose

Define the configuration and management panel for inventory Areas (Áreas), which has been migrated from a tab inside the Product Creator to a standalone administration page under the System (Sistema) group.

## Delta Requirements

### REQ-CFG-UI-01: Standalone Areas Route
The application MUST support a new standalone route `/areas` dedicated to Areas Management.
- Only users with administrative privileges (`adminOnly: true`) are authorized to access this route.
- Standard users attempting to access `/areas` MUST be redirected to the root dashboard or shown an access denied message.

### REQ-CFG-UI-02: Sidebar Navigation Link
A new navigation link labeled "Áreas" MUST be added under the "Sistema" group in the sidebar.
- The link MUST point to the `/areas` route.
- The link MUST be restricted to administrative users.

### REQ-CFG-UI-03: Area Management Migration
The "Áreas" management view MUST retain its full operational capabilities when loaded in the standalone page `/areas`:
- List all existing areas with name and description.
- Create new areas with validation on name (unique, non-empty).
- Edit existing area details.

---

## Scenarios

### Scenario: Admin views Sistema sidebar group
Given the user is logged in as an administrator
When they inspect the sidebar under the "Sistema" group
Then they MUST see the following links:
  | Label | Destination Route |
  | Usuarios | `/usuarios` |
  | Áreas | `/areas` |
  | Configuración | `/configuracion` |
  | Audit Log | `/audit-log` |

### Scenario: Non-admin views Sistema sidebar group
Given the user is logged in as a standard operator
When they inspect the sidebar under the "Sistema" group
Then they MUST NOT see the "Áreas" link.

### Scenario: Admin accesses standalone Areas page
Given the user is logged in as an administrator
When they navigate to `/areas`
Then the standalone Areas management page MUST load successfully
And they should be able to create, list, and edit inventory areas.

### Scenario: Non-admin attempts to access Areas page
Given the user is logged in as a standard operator
When they attempt to directly navigate to `/areas`
Then the system MUST block access and redirect the user to the root dashboard `/`.
