# Reglas del sistema de predicción de consumos

## Política de inventario

**Periodic Review (T, S)** — se revisa el inventario cada `T` días y se pide hasta alcanzar un target `S`.

---

## 1. Parámetros configurables (tabla `configuracion`)

| Clave | Default | Descripción |
|-------|---------|-------------|
| `ventana_demanda_dias` | 60 | Días de historia considerados para el forecast |
| `periodo_revision_dias` (T) | 30 | Intervalo entre revisiones de inventario |
| `dias_minimos_historia` | 14 | Mínimo días con consumo para usar forecast estadístico |
| `nivel_servicio_z` (Z) | 1.65 | Factor Z del safety stock (~85% IC) |
| `factor_historial_corto` | 0.35 | Descuento para productos con <14 días de historia |

---

## 2. Pipeline del forecast (`compute_forecast`)

```
serie_diaria (ventana_demanda_dias = 60)
  │
  ├─ classify_confianza(días_con_consumo)
  │
  ├─ Si BAJA (< dias_minimos_historia = 14):
  │     cantidad_sugerida = max(0, stock_minimo − stock_actual − ya_pedido)
  │     → No extrapola, usa stock_minimo manual como referencia
  │
  └─ Si MEDIA o ALTA (≥ 14 días con consumo):
        serie ← winsorize_p95(serie)
        μ ← ewma(serie, α=0.2)
        σ ← stddev_sample(serie)
        safety_stock    = Z · σ · √(L + T)
        reorder_point   = μ · L + Z · σ · √L
        target_stock    = μ · (L + T) + safety_stock
        cantidad_sug.   = max(0, target_stock − stock_actual − ya_pedido)
```

---

## 3. Clasificación de confianza

| Confianza | Condición |
|-----------|-----------|
| **Alta** | ≥ 30 días con consumo en la ventana |
| **Media** | ≥ `dias_minimos_historia` (14) y < 30 |
| **Baja** | < `dias_minimos_historia` (14) |

---

## 4. Clasificación de urgencia

```
stock_efectivo = stock_actual + ya_pedido
```

| Urgencia | Condición |
|----------|-----------|
| **Crítica** | `stock_efectivo < μ · L` → No cubre ni el lead time |
| **Alta** | `stock_efectivo < reorder_point` —o— `stock_actual < stock_minimo` |
| **Media** | `stock_efectivo < target_stock` |
| Ninguna | `stock_efectivo ≥ target_stock` |

### Filtro de recomendaciones

- Solo se muestran productos con **alguna urgencia** (crítica/alta/media)
- Si confianza baja y `cantidad_sugerida == 0` (stock ya cubre mínimo), se **excluye**
- Resultados ordenados por: urgencia (crítica → alta → media), luego autonomía ascendente

---

## 5. Cálculo de días de autonomía (stock)

### Consumo base

```
Si días_con_consumo ≥ dias_minimos_historia:
  consumo_base = ewma(winsorize_p95(serie), 0.2)
Si no:
  consumo_base = consumo_base_adaptivo(serie)
               = total_consumo / días_desde_primer_evento
```

### Autonomía normal

```
días_autonomía = stock_actual / consumo_base   (con piso 0, techo 999)
```

### Detección de pico (`consumo_pico_7d`)

Mayor promedio de consumo en cualquier ventana de 7 días consecutivos dentro de la serie.

**Regla de emisión**: solo se muestra `días_autonomía_pico` si:

```
consumo_base > 0  Y  consumo_pico_7d ≥ consumo_base × 1.3
```

Esto evita emitir alerta de pico cuando no hay variabilidad significativa.

```
días_autonomía_pico = stock_actual / consumo_pico_7d
```

---

## 6. Detección de anomalías (alerts SQL)

En `GET /alertas` se calcula:

```
es_anomalia = (consumo_últimos_7d > 3 × consumo_diario_ponderado)  Y  días_con_consumo > 5
```

---

## 7. Cálculo de horizonte sugerido (`horizonte_sugerido`)

```
horizonte_base = lead_time + periodo_revision_dias

Ajuste por coeficiente de variación (CV = σ / μ):
  CV < 0.3  → multiplicador 1.0
  CV < 0.7  → multiplicador 1.3
  CV ≥ 0.7  → multiplicador 1.5

horizonte_base_ajustado = horizonte_base × multiplicador
piso = max(lead_time × 1.5, 7)
horizonte_sugerido = max(horizonte_base_ajustado, piso)
```

Si confianza es **Baja**: `horizonte_sugerido = max(lead_time × 3, 30)`.

---

## 8. Manejo de historial corto (`estimate_short_history_demand`)

Se activa cuando **2 ≤ días_con_consumo < 14**. Calcula tres valores:

```
promedio_ventana          = total_consumo / ventana_demanda_dias     (ej. /60)
promedio_reciente_desc    = (total_consumo / días_desde_primer_evento) × factor_historial_corto (0.35)
consumo_diario_estimado   = max(promedio_ventana, promedio_reciente_desc)
```

Toma el **mayor** entre ambos, lo que da una estimación conservadora pero distinta de cero.

El `tipo_estimacion_demanda` resultante es:
- `"historial_corto"` → si entró en `estimate_short_history_demand`
- `"forecast"` → si hay forecast normal con μ > 0
- `"sin_historial"` → si no hay consumo en absoluto
- `"sin_proveedor"` → si no tiene proveedor asignado

---

## 9. Cálculo de cantidad a pedir (frontend)

```ts
cantidad = stock_minimo + consumo_diario × (lead_time + horizonte_dias) − stock_actual
```

Se usa en el formulario de solicitud cuando el usuario selecciona un horizonte personalizado o acepta el sugerido.

---

## 10. Resumen de relaciones entre reglas

1. **μ (EWMA winsorizada)** es la base de: target_stock, ROP, safety_stock, autonomía, urgencia y horizonte
2. **σ + Z** controlan la magnitud del safety stock — Z=1.65 es el único punto de ajuste de qué tan conservador es el sistema
3. **dias_minimos_historia (14)** es el switch entre forecast estadístico completo y fallback a `stock_minimo` manual
4. **factor_historial_corto (0.35)** evita sobrecomprar productos nuevos descontando drásticamente su tasa observada
5. **consumo_pico_7d** solo afecta la visualización de autonomía en escenario pico — **no** afecta target_stock ni cantidad sugerida
6. **Las alertas de stock** se recalculan en Rust-side (`calcular_autonomia`) sobreescribiendo cualquier estado de BD, garantizando consistencia con la lógica de forecast

---

## 11. Flujo end-to-end de recomendaciones

```
[DB] movimientos CONSUMO → serie diaria por producto (60 días)
  → [Rust] compute_forecast() para cada producto
  → Filtro: solo urgencia crítica/alta/media
  → Orden: críticas primero, luego autonomía ascendente
  → JSON → [Frontend] RevisionView
      → Tarjetas con: stock/min, μ/día, autonomía, confianza, urgencia, cantidad sugerida
      → Acciones: agregar, cambiar cantidad, descartar
```

---

## 12. Referencia de funciones en forecast.rs

| Función | Propósito |
|---------|-----------|
| `winsorize_p95(serie)` | Recorta outliers al percentil 95 (solo sobre no-ceros). Los ceros no influyen en el umbral |
| `consumo_base_adaptivo(serie)` | Total / días desde primer consumo (ventana real, no fija) |
| `consumo_pico_7d(serie)` | Mayor promedio en ventana de 7 días consecutivos |
| `ewma(serie, α=0.2)` | Media móvil exponencial — da más peso a valores recientes |
| `stddev_sample(serie)` | Desviación estándar muestral (n−1) |
| `classify_confianza(n_dias, umbral)` | Alta ≥30, Media ≥umbral, Baja <umbral |
| `estimate_short_history_demand(...)` | Estimación conservadora para 2–13 días con consumo |
| `classify_urgencia(...)` | Crítica/Alta/Media según stock_efectivo vs ROP/target |
| `compute_forecast(...)` | Forecast completo (T,S) para un producto |
