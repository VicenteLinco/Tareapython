# Technical Design — UI Restructuring (reestructuracion-ui)

This document outlines the technical design for simplifying navigation and clean-up of master data and procurement dashboards.

## 1. Routing Registration (`App.tsx`)

A new standalone route `/areas` will be added to the application.
- **Import**: Add `const AreasPage = lazy(() => import("@/pages/areas"));` at the top of [App.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/App.tsx).
- **Route Registration**: Add `<Route path="/areas" element={<AreasPage />} />` nested inside the `<Route element={<AppLayout />}>` group to preserve the main application layout.

## 2. Sidebar Navigation Updates (`sidebar.tsx`)

Update navigation links in [sidebar.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/components/layout/sidebar.tsx):
- **Adquisiciones Link**: Under the `Compras` group, rename the item with path `/ordenes-compra` from `"Guías de Despacho"` to `"Adquisiciones"`.
- **Standalone Areas Link**: Under the `Sistema` group, add a new link:
  ```typescript
  { to: "/areas", icon: Settings, label: "Áreas", adminOnly: true }
  ```
  This places the link below "Usuarios" and restricts visibility to administrators.

## 3. Standalone Areas Page (`pages/areas/index.tsx`)

Migrate the codebase from `creador-productos/areas-tab.tsx` to a new standalone page [areas/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/areas/index.tsx):
- **Access Authorization**: Guard the page component with role-based restriction using the current user state from `useAuthStore`:
  ```typescript
  const usuario = useAuthStore((s) => s.usuario);
  if (usuario?.rol !== "admin") {
    return <Navigate to="/" replace />;
  }
  ```
- **Page Layout**: Restructure the wrapper component to match standard page layouts (e.g., [UsuariosPage](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/usuarios/index.tsx)):
  - Remove `useFullWidthPage()` hook so the page displays inside a standard width container.
  - Add a page header section:
    ```tsx
    <div className="mb-6">
      <h1 className="t-h1">Áreas</h1>
      <p className="text-sm text-base-content/60 mt-0.5">
        Administra las áreas de inventario y almacenamiento
      </p>
    </div>
    ```

## 4. Product Creator Cleanup (`pages/creador-productos/index.tsx`)

Clean up [creador-productos/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/creador-productos/index.tsx) to remove relocated or obsolete views:
- **Tab Clean-up**:
  - Remove `areas` and `gtins` from the `TABS` array and the `TabId` type.
  - Rename tab `presentaciones` label from `"Presentaciones"` to `"Formatos de Empaque"`.
- **Imports Clean-up**:
  - Remove imports of `AreasTab` and `GtinsTab` components.
  - Remove unused Lucide icon imports: `MapPin` and `Barcode`.
- **Conditional Rendering**: Remove `{tabActivo === "areas" && <AreasTab />}` and `{tabActivo === "gtins" && <GtinsTab />}` from the tab content section.

## 5. Acquisitions Layout Updates (`pages/ordenes-compra/index.tsx`)

Refactor [ordenes-compra/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/ordenes-compra/index.tsx) as the delivery guide gallery has been relocated:
- **Title and Headers**: Update page title to `"Adquisiciones"`.
- **Remove Tab Layout**: Remove `tabActivo` state, the `<div role="tablist">` tab bar, and the conditional checks for `"ordenes"` or `"guias"`. The page will render the Orders table list directly.
- **Relocate States and Queries**: Delete all states and queries related to `guias` (e.g., `guiaSearchInput`, `guiaSearch`, `pageGuias`, `selectedFotoPath`, `selectedFotoTitle`, and `dataGuias` query).
- **Clean Imports**: Remove imports for `AuthenticatedUploadImage`, `downloadUpload`, `ImageIcon`, and `Search` if they are no longer used.

## 6. Receptions Gallery Integration (`pages/recepciones/index.tsx`)

Integrate the photo gallery into [recepciones/index.tsx](file:///home/vdev/desarrollo/Inventariomarzo-final/frontend/src/pages/recepciones/index.tsx):
- **Type and Tabs List**:
  - Update `TabActivo` union type to include `"guias"`.
  - Add `{ key: "guias", label: "Guías Respaldadas" }` to the `tabs` array.
- **State & Debounce**:
  - Add state variables: `guiaSearchInput`, `guiaSearch`, `pageGuias`, `selectedFotoPath`, `selectedFotoTitle` (matching the deleted states from Acquisitions).
  - Add a `useEffect` hook to debounce `guiaSearchInput` into `guiaSearch`.
- **Query Definition**: Add the query `guias-respaldadas` that triggers only when `tabActivo === "guias"`.
- **UI Conditional Rendering**:
  - Conditionally render the gallery grid when `tabActivo === "guias"`.
  - Conditionally hide standard filters and detail sidebar when `tabActivo === "guias"`.
  - Render the lightbox/viewer modal when `selectedFotoPath` is set.
- **Imports**: Add imports for `downloadUpload` from `@/lib/uploads` and `Image as ImageIcon` from `lucide-react`.

## 7. Success Criteria & Verification

- `/areas` route restricts non-admin users and allows admins to manage inventory areas.
- Sidebar reflects renamed "Adquisiciones" link and new "Áreas" link.
- "GTINs" and "Áreas" tabs are removed from Creador de Productos; "Presentaciones" is renamed.
- Acquisitions view contains only the "Órdenes de Compra" list.
- Receptions page displays the gallery under "Guías Respaldadas" tab with working search, pagination, and download lightbox.
