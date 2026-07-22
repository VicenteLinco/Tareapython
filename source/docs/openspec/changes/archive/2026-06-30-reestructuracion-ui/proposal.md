# Proposal: UI Restructuring (reestructuracion-ui)

Simplify navigation and improve usability by reorganizing the procurement and master data administration panels.

## Key Changes

* **Sidebar Reorganization**:
  * Rename "Guías de Despacho" to "Adquisiciones" under the "Compras" group.
  * Move the "Áreas" management panel out of "Creador de Productos" to a standalone page `/areas` under the "Sistema" group in the sidebar.
* **Procurement (Adquisiciones) View Clean-up**:
  * Rename tab "Solicitudes de Compra Respaldadas" to "Órdenes de Compra" inside `/ordenes-compra`.
  * Move the "Guías de Despacho Respaldadas" gallery from `/ordenes-compra` to `/recepciones` as a new tab.
* **Product Creator (Creador de Productos) Adjustments**:
  * Rename "Presentaciones" tab to "Formatos de Empaque".
  * Remove the "GTINs" tab (GTINs are managed directly in the product edit flow).
  * Remove the "Áreas" tab (now moved to `/areas`).

## Affected Files

* [App.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/App.tsx): Add route for `/areas`.
* [sidebar.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/components/layout/sidebar.tsx): Update links, labels, and groups.
* [creador-productos/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/creador-productos/index.tsx): Modify tabs and remove obsolete ones.
* [ordenes-compra/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/ordenes-compra/index.tsx): Update tabs and remove the gallery.
* [recepciones/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/recepciones/index.tsx): Add the gallery as a tab.
* [areas/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/areas/index.tsx): New standalone page (migrated from `areas-tab.tsx`).

## Success Criteria

* Sidebar links point to correct URLs and load pages without crashing.
* All relocated tabs (e.g., Areas page and Delivery Guides tab in Recepciones) are fully functional.
* Obsolete tabs (GTINs, Areas in Product Creator) are removed.
* No regressions in master data editing or receipt confirmation flows.

## Rollback Plan

* Discard local changes via Git: `git checkout -- frontend/src/App.tsx frontend/src/components/layout/sidebar.tsx frontend/src/pages/creador-productos/index.tsx frontend/src/pages/ordenes-compra/index.tsx frontend/src/pages/recepciones/index.tsx`
* Remove the new file: `rm frontend/src/pages/areas/index.tsx`
