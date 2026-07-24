# Spec: csv-import

## Requirements
### Product CSV Import
- **Given** a user imports a CSV catalog containing products
- **And** some products lack the `cantidad_inicial` parameter or it is explicitly 0
- **When** the backend service (`setup_service.rs`) processes the import
- **Then** the system MUST unconditionally create an initial provisional lot (e.g., `LOT-INI-{codigo}`) with `0` stock for those items.
- **And** the products must not be left in an incomplete state, ensuring immediate readiness for inventory movements.

### Auto-calculation of Stock Baseline
- **Given** a product was imported without initial consumption data
- **When** the standard time window elapses and consumption events occur
- **Then** the system MUST automatically calculate and populate `promedio_uso_mensual` and `stock_minimo_global` based on the time window history.

### Stock UI Feedback (Missing History)
- **Given** a product lacks sufficient consumption history to display accurate stock health (i.e. backend returns `sin_datos`)
- **When** the `StockBadge` component renders on the frontend
- **Then** the UI MUST compute the remaining days to meet the minimum history threshold (default 3 days: `remainingDays = max(3 - dias_con_consumo, 0)`).
- **And** display an informative badge such as `"Calculando (faltan {remainingDays} días)"` rather than a generic "Sin datos" fallback.
- **And** gracefully fallback to a generic message if `dias_con_consumo` is absent from the payload.
