# Design: Catalogacion GTIN Mejoras

## Technical Approach
This design details the implementation of product cataloging improvements, focused on persisting manufacturer data, correcting GUDID metadata mappings, allowing full editing of quarantined products on approval, scaling stock and movements on factor changes, and adding manual GTIN autocomplete.

## Architecture Decisions

### Decision: Persistence of Manufacturer

| Option | Tradeoff | Decision |
| :--- | :--- | :--- |
| **Flat Column** | Simple, low overhead, fits existing flat attributes. No join needed. | **Chosen**. Add `fabricante VARCHAR(300)` on the `productos` table. |
| **Separate Table** | Normalized, but adds join overhead for a simple metadata field. | *Rejected*. Overkill for the current requirements. |

### Decision: Stock and Movements Scaling

| Option | Tradeoff | Decision |
| :--- | :--- | :--- |
| **Re-run DB triggers** | Triggers only run `BEFORE INSERT`. Modifying history is complex. | *Rejected*. Overly complex and bypasses standard application layers. |
| **Direct update of both tables** | Fast, precise, maintains integrity inside a single database transaction. | **Chosen**. Update `stock.cantidad` and `movimientos` values directly. |

### Decision: Autocomplete API Endpoint

| Option | Tradeoff | Decision |
| :--- | :--- | :--- |
| **Reuse `/productos/scan`** | Creates quarantined product as side-effect, causing manual duplicates. | *Rejected*. Side-effects are undesirable for simple form queries. |
| **New Lookup Endpoint** | Pure read-only lookup. No DB writes. Returns parsed regulatory data. | **Chosen**. Add `/productos/scan/lookup` returning `DispositivoMapeado`. |

## Data Flow

1. **GTIN Autocomplete**:
   `[UI Form]` ──(1) `GET /scan/lookup?codigo=X` ──→ `[Backend lookup_barcode]` ──(2) Fetch Regulatory APIs ──→ `[Response]` ──(3) Pre-fill Form Fields.

2. **Quarantine Approval with Scaling**:
   `[UI Approval Modal]` ──(1) `POST /approve` with edited metadata ──→ `[Backend approve_product]`
   `  [Start Transaction]`
   `    ├── (2) Update Product (Name, Unit Base, Category, Control Policy, Presentation Factor)`
   `    ├── (3) Update Presentations Table Factor`
   `    ├── (4) Calculate Multiplier M = new_factor / old_factor`
   `    ├── (5) Update stock.cantidad = cantidad * M`
   `    └── (6) Update movimientos.cantidad = cantidad * M, cantidad_resultante = cantidad_resultante * M`
   `  [Commit Transaction]`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/migrations/009_catalogacion_gtin_mejoras.sql` | Create | Migration adding `fabricante` to `productos`. |
| `backend/src/models/producto.rs` | Modify | Add `fabricante` field to `Producto` struct. |
| `backend/src/services/api_regulatoria_service.rs` | Modify | Add `descripcion` to `DispositivoMapeado`. Update FDA parser to map `catalogNumber`, `deviceDescription`, and `companyName`. |
| `backend/src/services/producto_service.rs` | Modify | Add `fabricante` to `CrearProductoParams`/`ActualizarProductoParams`/`ProductoRow`. Update CRUD methods and return `estado_catalogo` in `buscar_por_codigo`. |
| `backend/src/handlers/productos.rs` | Modify | Update `ApproveProductInput`. Add `/scan/lookup` endpoint. Implement scaling logic in `approve_product`. |
| `frontend/src/api/catalogos.ts` | Modify | Update `ApproveProductPayload`. Add `buscarGtinLookup`. |
| `frontend/src/pages/creador-productos/BandejaCatalogacionTab.tsx` | Modify | Expand approval modal to allow editing metadata. |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | Modify | Add GTIN lookup button next to form fields. |
| `frontend/src/components/shared/AsignarCodigoModal.tsx` | Modify | Add `fabricante` field to quick creator form and post payload. |
| `frontend/src/pages/recepciones/components/item-card.tsx` | Modify | Add quarantine warning badge and `estado_catalogo` field support. |
| `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` | Modify | Map `estado_catalogo` from barcode scan response. |
| `frontend/src/pages/consumos/index.tsx` | Modify | Check `estado_catalogo` on scan and block quarantined products. |

## Interfaces / Contracts

```rust
// Rust: backend/src/services/api_regulatoria_service.rs
pub struct DispositivoMapeado {
    pub nombre: String,
    pub fabricante: String,
    pub sku_ref: Option<String>,
    pub clase_riesgo: Option<String>,
    pub descripcion: Option<String>,
}

// Rust: backend/src/handlers/productos.rs
pub struct ApproveProductInput {
    pub nombre: String,
    pub categoria_id: i32,
    pub unidad_base_id: i32,
    pub control_lote: ControlLote,
    pub pres_nombre: Option<String>,
    pub pres_nombre_plural: Option<String>,
    pub pres_factor: Option<Decimal>,
    pub fabricante: Option<String>,
    pub ubicacion: Option<String>,
}
```

```typescript
// TypeScript: frontend/src/api/catalogos.ts
export interface ApproveProductPayload {
  nombre: string
  categoria_id: number
  unidad_base_id: number
  control_lote: 'simple' | 'con_vto' | 'trazable'
  pres_nombre?: string
  pres_nombre_plural?: string
  pres_factor?: number
  fabricante?: string
  ubicacion?: string
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | FDA GUDID Mapping | Mock FDA lookup response and assert brand/description/catalogNumber mapping. |
| Integration | Auto scaling on approval | Pre-insert quarantined product with stock/movements. Call `/approve` with a new factor and check scaled quantities. |
| Integration | Lookup Endpoint | Query `/scan/lookup` with a mocked code and verify returned JSON structure. |

## Migration / Rollout
No data migration required as the `fabricante` column is nullable. The migration `009_catalogacion_gtin_mejoras.sql` will alter the table and update the search trigger index.
