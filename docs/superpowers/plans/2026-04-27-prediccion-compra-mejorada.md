# Predicción de compra mejorada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el cálculo simplista de cantidad sugerida en `/solicitudes-compra` por una política de inventario *Periodic Review (T, S)* con demanda robusta (winsorización + EWMA), variabilidad (σ) explícita, lead time real del producto, nivel de servicio configurable y umbral de confianza por antigüedad de historial.

**Architecture:** El cálculo se mueve de SQL inline a un servicio Rust puro y testeable (`services/forecast.rs`). El SQL se reduce a producir la serie diaria de consumo por producto (últimos 60 días, con días vacíos rellenados con 0) más metadatos (stock, lead time, etc.). Rust calcula μ (EWMA winsorizada), σ (stddev de la serie winsorizada), nivel de confianza, urgencia y cantidad sugerida. Los handlers `recomendaciones` y `horizonte_sugerido` comparten la misma lógica para evitar inconsistencias. La UI muestra un badge de confianza y un tooltip con el desglose del cálculo.

**Tech Stack:** Rust + Axum + SQLx (backend), React + TS (frontend), PostgreSQL (`generate_series` + `array_agg`).

---

## Contexto del problema (referencia)

Sistema actual ([backend/src/handlers/solicitudes_compra.rs:307-453](backend/src/handlers/solicitudes_compra.rs)):

```
consumo_diario = SUM(consumos últimos 30d) / días_desde_PRIMER_consumo
cantidad_sug   = ceil( stock_minimo + consumo_diario × (lead_time + revision_dias) − stock_actual − ya_pedido )
```

Problemas observados con producto `prueba pcr` (PRD-00002):
- Stock 169, mínimo 50, lead time propio 10d, sin `dias_despacho_*` (cae a 7).
- Consumos: 100u (23-abr) + 1u (24-abr) + 30u (27-abr) = 131u en 4 días.
- Sistema actual calcula `consumo_diario = 131/4 = 32.75 u/día` y sugiere ~1093 unidades para 37 días.
- Razones: divide por días desde el primer consumo (no por la ventana), no filtra outliers, no exige antigüedad mínima, ignora `lead_time_propio`, mezcla `stock_minimo` como buffer extra, y la variabilidad sólo se usa en `/horizonte` (otro endpoint).

## Diseño del nuevo algoritmo

Para cada producto:

1. **Construir serie diaria** `S = [c_0, c_1, ..., c_{N-1}]` de los últimos `N = ventana_demanda_dias` días (default 60). Días sin consumo → 0.
2. **Winsorizar al percentil 95** → `S'`. Picos extremos (carga inicial, calibración) recortados al p95 de la propia serie.
3. **Demanda esperada μ** = EWMA de `S'` con α = 0.2 (más peso a lo reciente, suaviza ruido).
4. **Variabilidad σ** = desviación estándar muestral de `S'`.
5. **Lead time efectivo** `L = COALESCE(producto.lead_time_propio, proveedor.dias_despacho_tierra, proveedor.dias_despacho_aereo, 7)`.
6. **Periodo de revisión** `T` = config `periodo_revision_dias` (default 30).
7. **Z (nivel de servicio)** = config `nivel_servicio_z` (default 1.65 ≈ 95%).
8. **Confianza**:
   - `alta` si `dias_con_consumo ≥ 30`
   - `media` si `dias_con_consumo ≥ dias_minimos_historia` (default 14)
   - `baja` si menor → no auto-sugerir; razón: "historial insuficiente, usando stock mínimo como referencia"; cantidad = `max(0, stock_minimo − stock_actual − ya_pedido)`
9. **Si confianza ≠ baja**:
   - `safety_stock_total = Z · σ · √(L + T)`
   - `safety_stock_lead = Z · σ · √L`
   - `S_target = μ · (L + T) + safety_stock_total`
   - `ROP = μ · L + safety_stock_lead`
   - `cantidad_sugerida = max(0, S_target − stock_actual − ya_pedido)`
10. **Nivel de urgencia** (`stock_efectivo = stock_actual + ya_pedido`):
    - `critica` si `stock_efectivo < μ · L` → rompe antes de que llegue.
    - `alta` si `stock_efectivo < ROP`.
    - `media` si `stock_efectivo < S_target`.
    - `null` (no aparece en recomendaciones) si está cubierto.
    - Excepción: si `stock_actual < stock_minimo` y stock_minimo>0 → mínimo `alta`.

`stock_minimo` deja de sumarse al target. Queda únicamente como umbral manual de alerta crítica.

## File Structure

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `backend/migrations/046_config_forecast.sql` | Crear | Insertar 3 claves de configuración (`nivel_servicio_z`, `ventana_demanda_dias`, `dias_minimos_historia`). |
| `backend/src/services/forecast.rs` | Crear | Funciones puras: `winsorize_p95`, `ewma`, `stddev_sample`, `target_stock`, `reorder_point`, `classify_confianza`, `classify_urgencia`. Tests unitarios al final del archivo. |
| `backend/src/services/mod.rs` | Modificar | Añadir `pub mod forecast;`. |
| `backend/src/dto/solicitud.rs` | Modificar | Añadir campos a `ItemRecomendado`: `consumo_sigma`, `confianza`, `razon`, `dias_con_consumo`, `safety_stock`, `target_stock`, `reorder_point`. |
| `backend/src/handlers/solicitudes_compra.rs` | Modificar | Reescribir `recomendaciones` (líneas 304-459) y `horizonte_sugerido` (líneas 551-689) para usar `forecast.rs`. SQL produce serie diaria + metadata; Rust hace la matemática. |
| `backend/tests/solicitudes_test.rs` | Modificar | Añadir test integrado `recomendaciones_baja_confianza_no_sugiere_cantidad_alta` que reproduce el bug de "prueba pcr" (4 días, pico de 100u). |
| `frontend/src/types/generated.ts` | Regenerar | `cargo run --bin export_types`. |
| `frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx` | Modificar | Mostrar badge de confianza + tooltip con μ, σ, L, T, Z y razón. |
| `frontend/src/pages/solicitudes-compra/index.tsx` | Modificar | Si `confianza === 'baja'`, no autorrellenar `cantidad` desde `cantidad_sugerida_base`; usar 0 y dejar al usuario decidir. |

---

### Task 1: Migración — claves de configuración del forecast

**Files:**
- Create: `backend/migrations/046_config_forecast.sql`

- [ ] **Step 1: Crear archivo de migración**

```sql
-- 046_config_forecast.sql
-- Parámetros del nuevo algoritmo de predicción de compra (Periodic Review T,S).

INSERT INTO configuracion (clave, valor_texto)
VALUES ('nivel_servicio_z', '1.65')
ON CONFLICT (clave) DO NOTHING;
-- Z = 1.65 → cobertura del 95%. Otros valores típicos: 1.96 (97.5%), 2.33 (99%).

INSERT INTO configuracion (clave, valor_texto)
VALUES ('ventana_demanda_dias', '60')
ON CONFLICT (clave) DO NOTHING;
-- Días hacia atrás para construir la serie diaria de consumo.

INSERT INTO configuracion (clave, valor_texto)
VALUES ('dias_minimos_historia', '14')
ON CONFLICT (clave) DO NOTHING;
-- Si dias_con_consumo < umbral → confianza = baja, no se auto-sugiere cantidad.
```

- [ ] **Step 2: Aplicar la migración**

```bash
docker compose restart backend
docker compose logs backend --tail 30
```

Expected: en los logs aparece `Applied migration 046_config_forecast` (o similar) sin errores.

- [ ] **Step 3: Verificar que las claves existen**

```bash
docker exec 14marzoinventario-db-1 psql -U lab_user -d inventario_lab \
  -c "SELECT clave, valor_texto FROM configuracion WHERE clave IN ('nivel_servicio_z','ventana_demanda_dias','dias_minimos_historia');"
```

Expected: tres filas, con valores `1.65`, `60`, `14`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/046_config_forecast.sql
git commit -m "migration(046): config keys para forecast de compra (Z, ventana, umbral)"
```

---

### Task 2: Servicio puro `forecast.rs` con tests unitarios

**Files:**
- Create: `backend/src/services/forecast.rs`
- Modify: `backend/src/services/mod.rs`

- [ ] **Step 1: Escribir el archivo con tipos, funciones y tests**

Crear `backend/src/services/forecast.rs` con el siguiente contenido completo:

```rust
//! Forecast de demanda y política de inventario Periodic Review (T, S).
//!
//! Funciones puras, sin estado, fácilmente testeables. Los handlers leen la
//! serie diaria de consumo desde Postgres y delegan toda la matemática aquí.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confianza { Alta, Media, Baja }

impl Confianza {
    pub fn as_str(self) -> &'static str {
        match self {
            Confianza::Alta => "alta",
            Confianza::Media => "media",
            Confianza::Baja => "baja",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Urgencia { Critica, Alta, Media }

impl Urgencia {
    pub fn as_str(self) -> &'static str {
        match self {
            Urgencia::Critica => "critica",
            Urgencia::Alta => "alta",
            Urgencia::Media => "media",
        }
    }
}

/// Parámetros de configuración del algoritmo (vienen de la tabla `configuracion`).
#[derive(Debug, Clone, Copy)]
pub struct ForecastConfig {
    pub ventana_demanda_dias: i32,
    pub periodo_revision_dias: i32,
    pub dias_minimos_historia: i32,
    pub nivel_servicio_z: f64,
}

impl Default for ForecastConfig {
    fn default() -> Self {
        Self {
            ventana_demanda_dias: 60,
            periodo_revision_dias: 30,
            dias_minimos_historia: 14,
            nivel_servicio_z: 1.65,
        }
    }
}

/// Resultado del cálculo para un producto.
#[derive(Debug, Clone)]
pub struct ForecastResult {
    pub mu: f64,                 // demanda diaria esperada (u/día)
    pub sigma: f64,              // desviación estándar diaria (u/día)
    pub dias_con_consumo: i32,
    pub confianza: Confianza,
    pub razon: String,
    pub safety_stock: f64,       // Z · σ · √(L + T)
    pub target_stock: f64,       // S = μ·(L+T) + safety_stock
    pub reorder_point: f64,      // ROP = μ·L + Z·σ·√L
    pub cantidad_sugerida: f64,  // max(0, S − stock_actual − ya_pedido)  [unidades base]
    pub urgencia: Option<Urgencia>,
}

/// Winsoriza una serie al percentil 95: cualquier valor por encima del p95
/// queda recortado a p95. Útil para neutralizar picos de carga inicial /
/// pruebas / calibraciones que distorsionarían el promedio.
pub fn winsorize_p95(serie: &[f64]) -> Vec<f64> {
    if serie.is_empty() {
        return Vec::new();
    }
    let mut ordenado: Vec<f64> = serie.to_vec();
    ordenado.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = ordenado.len();
    // índice del p95 (interpolación nearest-rank)
    let idx = ((0.95 * (n as f64)).ceil() as usize).saturating_sub(1).min(n - 1);
    let p95 = ordenado[idx];
    serie.iter().map(|&v| v.min(p95)).collect()
}

/// Promedio móvil exponencial: μ_t = α·x_t + (1-α)·μ_{t-1}.
/// `serie` debe estar ordenada cronológicamente (más antiguo primero).
/// Inicializa μ_0 con el primer valor.
pub fn ewma(serie: &[f64], alpha: f64) -> f64 {
    if serie.is_empty() {
        return 0.0;
    }
    let mut mu = serie[0];
    for &x in &serie[1..] {
        mu = alpha * x + (1.0 - alpha) * mu;
    }
    mu
}

/// Desviación estándar muestral (n-1). Devuelve 0 si la serie tiene menos
/// de 2 elementos.
pub fn stddev_sample(serie: &[f64]) -> f64 {
    let n = serie.len();
    if n < 2 {
        return 0.0;
    }
    let media: f64 = serie.iter().sum::<f64>() / (n as f64);
    let var: f64 = serie.iter().map(|x| (x - media).powi(2)).sum::<f64>() / ((n - 1) as f64);
    var.sqrt()
}

pub fn classify_confianza(dias_con_consumo: i32, umbral_minimo: i32) -> Confianza {
    if dias_con_consumo >= 30 {
        Confianza::Alta
    } else if dias_con_consumo >= umbral_minimo {
        Confianza::Media
    } else {
        Confianza::Baja
    }
}

pub fn classify_urgencia(
    stock_actual: f64,
    ya_pedido: f64,
    stock_minimo: f64,
    mu: f64,
    lead_time: f64,
    reorder_point: f64,
    target_stock: f64,
) -> Option<Urgencia> {
    let stock_efectivo = stock_actual + ya_pedido;
    let critica = stock_efectivo < mu * lead_time;
    let bajo_minimo = stock_minimo > 0.0 && stock_actual < stock_minimo;

    if critica {
        Some(Urgencia::Critica)
    } else if stock_efectivo < reorder_point || bajo_minimo {
        Some(Urgencia::Alta)
    } else if stock_efectivo < target_stock {
        Some(Urgencia::Media)
    } else {
        None
    }
}

/// Cálculo completo para un producto. `serie_diaria` debe tener exactamente
/// `cfg.ventana_demanda_dias` elementos, ordenados cronológicamente.
pub fn compute_forecast(
    serie_diaria: &[f64],
    stock_actual: f64,
    stock_minimo: f64,
    ya_pedido: f64,
    lead_time_dias: i32,
    cfg: ForecastConfig,
) -> ForecastResult {
    let dias_con_consumo = serie_diaria.iter().filter(|&&v| v > 0.0).count() as i32;
    let confianza = classify_confianza(dias_con_consumo, cfg.dias_minimos_historia);

    let l = lead_time_dias.max(0) as f64;
    let t = cfg.periodo_revision_dias.max(0) as f64;
    let z = cfg.nivel_servicio_z;

    if confianza == Confianza::Baja {
        let cantidad = (stock_minimo - stock_actual - ya_pedido).max(0.0);
        let urgencia = if stock_actual < stock_minimo && stock_minimo > 0.0 {
            Some(Urgencia::Alta)
        } else if cantidad > 0.0 {
            Some(Urgencia::Media)
        } else {
            None
        };
        return ForecastResult {
            mu: 0.0,
            sigma: 0.0,
            dias_con_consumo,
            confianza,
            razon: format!(
                "Historial insuficiente ({} día(s) con consumo, mínimo {}). \
                 Sugerencia basada en stock mínimo manual.",
                dias_con_consumo, cfg.dias_minimos_historia
            ),
            safety_stock: 0.0,
            target_stock: stock_minimo,
            reorder_point: stock_minimo,
            cantidad_sugerida: cantidad,
            urgencia,
        };
    }

    let serie_w = winsorize_p95(serie_diaria);
    let mu = ewma(&serie_w, 0.2);
    let sigma = stddev_sample(&serie_w);

    let safety_stock = z * sigma * (l + t).sqrt();
    let safety_stock_lead = z * sigma * l.sqrt();
    let target_stock = mu * (l + t) + safety_stock;
    let reorder_point = mu * l + safety_stock_lead;

    let cantidad_sugerida = (target_stock - stock_actual - ya_pedido).max(0.0);
    let urgencia = classify_urgencia(
        stock_actual, ya_pedido, stock_minimo,
        mu, l, reorder_point, target_stock,
    );

    let razon = format!(
        "μ={:.2} u/día (EWMA winsorizada p95, {} días con consumo de {}), \
         σ={:.2}, L={:.0}d, T={:.0}d, Z={:.2}",
        mu, dias_con_consumo, serie_diaria.len(), sigma, l, t, z
    );

    ForecastResult {
        mu, sigma, dias_con_consumo, confianza, razon,
        safety_stock, target_stock, reorder_point,
        cantidad_sugerida, urgencia,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, eps: f64) -> bool { (a - b).abs() < eps }

    #[test]
    fn winsorize_recorta_picos_al_p95() {
        // 19 ceros + un valor extremo = el p95 (índice 18) es 0
        let mut s = vec![0.0; 19];
        s.push(100.0);
        let w = winsorize_p95(&s);
        assert_eq!(w[19], 0.0, "el pico debe quedar recortado al p95 (=0)");
    }

    #[test]
    fn winsorize_no_modifica_serie_uniforme() {
        let s = vec![5.0; 30];
        assert_eq!(winsorize_p95(&s), s);
    }

    #[test]
    fn ewma_da_mas_peso_a_valores_recientes() {
        // [10, 10, 10, 0, 0, 0] → EWMA debe estar más cerca de 0 que de 10
        let s = vec![10.0, 10.0, 10.0, 0.0, 0.0, 0.0];
        let mu = ewma(&s, 0.2);
        assert!(mu < 5.0, "EWMA debería bajar tras los ceros recientes, dio {}", mu);
    }

    #[test]
    fn ewma_serie_constante_devuelve_constante() {
        let s = vec![7.0; 20];
        assert!(approx(ewma(&s, 0.2), 7.0, 0.0001));
    }

    #[test]
    fn stddev_constante_es_cero() {
        assert_eq!(stddev_sample(&vec![3.0; 10]), 0.0);
    }

    #[test]
    fn stddev_caso_conocido() {
        // [2,4,4,4,5,5,7,9] → stddev muestral = 2.138
        let s = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        assert!(approx(stddev_sample(&s), 2.1380, 0.001));
    }

    #[test]
    fn confianza_se_clasifica_por_dias() {
        assert_eq!(classify_confianza(35, 14), Confianza::Alta);
        assert_eq!(classify_confianza(20, 14), Confianza::Media);
        assert_eq!(classify_confianza(13, 14), Confianza::Baja);
    }

    #[test]
    fn forecast_baja_confianza_usa_stock_minimo_no_extrapola() {
        // Reproduce el caso "prueba pcr": serie de 60 días, sólo 3 con consumo
        // (uno de 100, uno de 1, uno de 30). Con confianza baja NO debe sugerir
        // ~1093 unidades. Debe usar stock_mínimo como referencia.
        let mut serie = vec![0.0; 60];
        serie[56] = 100.0; // hace 4 días
        serie[57] = 1.0;   // hace 3 días
        serie[59] = 30.0;  // hoy
        let r = compute_forecast(&serie, 169.0, 50.0, 0.0, 10, ForecastConfig::default());
        assert_eq!(r.confianza, Confianza::Baja);
        assert_eq!(r.dias_con_consumo, 3);
        // Stock 169 ya cubre el mínimo 50 → cantidad sugerida = 0
        assert_eq!(r.cantidad_sugerida, 0.0);
        assert!(r.razon.contains("Historial insuficiente"));
    }

    #[test]
    fn forecast_alta_confianza_calcula_target_y_safety_stock() {
        // 60 días con consumo regular de 5 u/día → μ ≈ 5, σ ≈ 0
        let serie = vec![5.0; 60];
        let cfg = ForecastConfig::default();
        let r = compute_forecast(&serie, 100.0, 0.0, 0.0, 7, cfg);
        assert_eq!(r.confianza, Confianza::Alta);
        assert!(approx(r.mu, 5.0, 0.01));
        assert!(approx(r.sigma, 0.0, 0.01));
        // L+T = 37 → target = 5 × 37 = 185, safety = 0
        assert!(approx(r.target_stock, 185.0, 0.5));
        // sugerido = 185 − 100 − 0 = 85
        assert!(approx(r.cantidad_sugerida, 85.0, 0.5));
    }

    #[test]
    fn forecast_winsorizacion_neutraliza_outlier_de_carga() {
        // 60 días: 59 con consumo de 5 + 1 con consumo de 500 (carga inicial).
        // Sin winsorizar, μ saltaría a ~13. Con winsorización, debe quedar ~5.
        let mut serie = vec![5.0; 60];
        serie[0] = 500.0;
        let r = compute_forecast(&serie, 100.0, 0.0, 0.0, 7, ForecastConfig::default());
        assert!(r.mu < 6.0, "μ con winsorización debería ser ~5, dio {}", r.mu);
    }

    #[test]
    fn urgencia_critica_cuando_stock_no_alcanza_lead_time() {
        // μ=10, L=10 → necesita 100 unidades para cubrir lead time. Stock 50 → crítica.
        let u = classify_urgencia(50.0, 0.0, 0.0, 10.0, 10.0, 120.0, 400.0);
        assert_eq!(u, Some(Urgencia::Critica));
    }

    #[test]
    fn urgencia_alta_cuando_bajo_reorder_point() {
        // Stock 110 cubre lead time (μ·L=100) pero está bajo ROP (120).
        let u = classify_urgencia(110.0, 0.0, 0.0, 10.0, 10.0, 120.0, 400.0);
        assert_eq!(u, Some(Urgencia::Alta));
    }

    #[test]
    fn urgencia_none_cuando_cubierto() {
        let u = classify_urgencia(500.0, 0.0, 0.0, 10.0, 10.0, 120.0, 400.0);
        assert_eq!(u, None);
    }
}
```

- [ ] **Step 2: Registrar el módulo**

Editar `backend/src/services/mod.rs`. Añadir esta línea junto al resto de declaraciones de módulos (orden alfabético):

```rust
pub mod forecast;
```

- [ ] **Step 3: Ejecutar los tests del servicio**

```bash
cd backend && cargo test --lib services::forecast
```

Expected: los 11 tests pasan, todos verdes.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/forecast.rs backend/src/services/mod.rs
git commit -m "feat(forecast): servicio puro con winsorización, EWMA, σ y política (T,S)"
```

---

### Task 3: DTO `ItemRecomendado` con campos del nuevo cálculo

**Files:**
- Modify: `backend/src/dto/solicitud.rs:7-33`

- [ ] **Step 1: Reemplazar el struct `ItemRecomendado`**

Sustituir el bloque `pub struct ItemRecomendado { ... }` (líneas 7-33) por:

```rust
#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct ItemRecomendado {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_id: Option<i32>,
    pub proveedor_nombre: Option<String>,
    pub lead_time: i32,
    pub autonomia_dias: Option<f64>,
    pub nivel_urgencia: String,
    pub stock_actual: Decimal,
    pub stock_seguridad: Decimal,         // == producto.stock_minimo (alerta manual)
    pub consumo_diario: Decimal,          // μ (EWMA winsorizada)
    pub consumo_sigma: Decimal,           // σ diaria
    pub dias_historia: i32,               // longitud de la serie usada
    pub dias_con_consumo: i32,            // días no-cero en la serie
    pub confianza: String,                // "alta" | "media" | "baja"
    pub razon: String,                    // explicación humana del cálculo
    pub safety_stock: Decimal,            // Z·σ·√(L+T)
    pub target_stock: Decimal,            // S
    pub reorder_point: Decimal,           // ROP
    pub cantidad_sugerida_base: Decimal,
    pub presentacion_id: Option<i32>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub cantidad_sugerida_presentacion: Option<Decimal>,
    pub precio_ultima_recepcion: Option<Decimal>,
    pub unidad_base: String,
    pub unidad_base_plural: Option<String>,
    pub imagen_url: Option<String>,
    pub ya_pedido_unidades: Decimal,
}
```

- [ ] **Step 2: Verificar que compila (puede fallar el handler — esperado, se arregla en Task 4)**

```bash
cd backend && cargo check 2>&1 | tail -30
```

Expected: posibles errores en `handlers/solicitudes_compra.rs` por campos faltantes en la query SQL. Eso se arregla en la siguiente task.

- [ ] **Step 3: NO commitear todavía** — esperar a que el handler compile en la Task 4.

---

### Task 4: Reescribir handler `recomendaciones`

**Files:**
- Modify: `backend/src/handlers/solicitudes_compra.rs:304-459`

- [ ] **Step 1: Importar el servicio en la cabecera del archivo**

Buscar la sección `use crate::services::...` (cerca del top, ya hay imports a `idempotency` u otros). Añadir:

```rust
use crate::services::forecast::{self, compute_forecast, ForecastConfig};
```

(`self` es necesario para poder escribir `forecast::Confianza` más abajo; `compute_forecast` se importa por nombre porque se usa varias veces; `ForecastConfig` también se usa directamente.)

- [ ] **Step 2: Reemplazar la función `recomendaciones` completa**

Borrar todo el bloque `pub async fn recomendaciones(...) { ... }` (líneas ~304-459) y sustituirlo por:

```rust
pub async fn recomendaciones(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    // 1. Cargar configuración
    let cfg = load_forecast_config(&state.pool).await?;

    // 2. Una sola query: por producto, devuelve la serie diaria de consumo
    //    de los últimos `ventana_demanda_dias` días + metadata.
    let rows = sqlx::query!(
        r#"
        WITH ventana AS (
            SELECT NOW() - ($1::int * INTERVAL '1 day') AS desde
        ),
        dias AS (
            SELECT generate_series(
                (SELECT desde FROM ventana)::date,
                NOW()::date,
                INTERVAL '1 day'
            )::date AS dia
        ),
        productos_con_movimiento AS (
            SELECT DISTINCT l.producto_id
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
        ),
        consumo_dia AS (
            SELECT
                l.producto_id,
                m.created_at::date AS dia,
                SUM(m.cantidad)::FLOAT8 AS cantidad
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
            GROUP BY l.producto_id, m.created_at::date
        ),
        series AS (
            SELECT
                pcm.producto_id,
                array_agg(COALESCE(cd.cantidad, 0) ORDER BY d.dia)::FLOAT8[] AS serie
            FROM productos_con_movimiento pcm
            CROSS JOIN dias d
            LEFT JOIN consumo_dia cd
              ON cd.producto_id = pcm.producto_id AND cd.dia = d.dia
            GROUP BY pcm.producto_id
        ),
        stock_total AS (
            SELECT l.producto_id, SUM(s.cantidad)::FLOAT8 AS stock_actual
            FROM stock s
            JOIN lotes l ON l.id = s.lote_id
            GROUP BY l.producto_id
        ),
        pedidos_en_vuelo AS (
            SELECT
                scd.producto_id,
                SUM(scd.cantidad_sugerida)::FLOAT8 AS cantidad_pedida
            FROM solicitud_compra_detalle scd
            JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
            JOIN productos p2 ON p2.id = scd.producto_id
            LEFT JOIN proveedores prov2 ON prov2.id = p2.proveedor_id
            WHERE sc.estado = 'guardada'
              AND sc.fecha_creacion >= NOW() - (
                  COALESCE(p2.lead_time_propio,
                           prov2.dias_despacho_tierra,
                           prov2.dias_despacho_aereo, 7)::int
                  * 2 * INTERVAL '1 day'
              )
            GROUP BY scd.producto_id
        ),
        ultimo_precio AS (
            SELECT DISTINCT ON (rd.producto_id)
                rd.producto_id,
                CASE
                    WHEN rd.factor_conversion_usado IS NOT NULL AND rd.factor_conversion_usado > 0
                    THEN rd.precio_unitario / rd.factor_conversion_usado
                    ELSE rd.precio_unitario
                END AS precio_unitario
            FROM recepcion_detalle rd
            JOIN recepciones r ON r.id = rd.recepcion_id
            WHERE rd.precio_unitario IS NOT NULL
              AND r.estado IN ('completa', 'parcial')
            ORDER BY rd.producto_id, r.fecha_recepcion DESC
        ),
        pres AS (
            SELECT DISTINCT ON (producto_id)
                producto_id, id, nombre, nombre_plural, factor_conversion
            FROM presentaciones
            WHERE activa = true
            ORDER BY producto_id, factor_conversion DESC
        )
        SELECT
            p.id                                                              AS "producto_id!: Uuid",
            p.nombre                                                          AS "producto_nombre!: String",
            p.codigo_proveedor                                                AS "codigo_proveedor: String",
            p.codigo_maestro                                                  AS "codigo_maestro: String",
            prov.id                                                           AS "proveedor_id: i32",
            prov.nombre                                                       AS "proveedor_nombre: String",
            COALESCE(p.lead_time_propio,
                     prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                        AS "lead_time!: i32",
            COALESCE(st.stock_actual, 0)::FLOAT8                              AS "stock_actual!: f64",
            COALESCE(p.stock_minimo, 0)::FLOAT8                               AS "stock_minimo!: f64",
            COALESCE(pev.cantidad_pedida, 0)::FLOAT8                          AS "ya_pedido!: f64",
            s.serie                                                           AS "serie!: Vec<f64>",
            pres.id                                                           AS "presentacion_id: i32",
            pres.nombre                                                       AS "presentacion_nombre: String",
            pres.nombre_plural                                                AS "presentacion_nombre_plural: String",
            pres.factor_conversion::FLOAT8                                    AS "factor_conversion: f64",
            COALESCE(up.precio_unitario, p.precio_unidad)::FLOAT8             AS "precio_ultimo: f64",
            ub.nombre                                                         AS "unidad_base!: String",
            ub.nombre_plural                                                  AS "unidad_base_plural: String",
            p.imagen_url                                                      AS "imagen_url: String"
        FROM productos p
        JOIN series s ON s.producto_id = p.id
        LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
        LEFT JOIN stock_total st ON st.producto_id = p.id
        LEFT JOIN ultimo_precio up ON up.producto_id = p.id
        LEFT JOIN pres ON pres.producto_id = p.id
        LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        LEFT JOIN pedidos_en_vuelo pev ON pev.producto_id = p.id
        WHERE p.activo = true
          AND p.deleted_at IS NULL
        "#,
        cfg.ventana_demanda_dias
    )
    .fetch_all(&state.pool)
    .await?;

    // 3. Para cada producto, ejecutar el forecast en Rust
    let mut items: Vec<serde_json::Value> = Vec::new();
    for r in rows {
        let res = compute_forecast(
            &r.serie,
            r.stock_actual,
            r.stock_minimo,
            r.ya_pedido,
            r.lead_time,
            cfg,
        );

        // Solo aparecen en la lista los que tienen alguna urgencia
        let Some(urgencia) = res.urgencia else { continue };

        // Productos con confianza baja sólo se muestran si stock_actual < stock_minimo
        if res.confianza == forecast::Confianza::Baja && res.cantidad_sugerida == 0.0 {
            continue;
        }

        let cantidad_pres = r.factor_conversion
            .filter(|f| *f > 0.0)
            .map(|f| (res.cantidad_sugerida / f).ceil());

        let autonomia = if res.mu > 0.0 { Some(r.stock_actual / res.mu) } else { None };

        items.push(serde_json::json!({
            "producto_id": r.producto_id,
            "producto_nombre": r.producto_nombre,
            "codigo_proveedor": r.codigo_proveedor,
            "codigo_maestro": r.codigo_maestro,
            "proveedor_id": r.proveedor_id,
            "proveedor_nombre": r.proveedor_nombre,
            "lead_time": r.lead_time,
            "autonomia_dias": autonomia,
            "nivel_urgencia": urgencia.as_str(),
            "stock_actual": r.stock_actual,
            "stock_seguridad": r.stock_minimo,
            "consumo_diario": res.mu,
            "consumo_sigma": res.sigma,
            "dias_historia": r.serie.len() as i32,
            "dias_con_consumo": res.dias_con_consumo,
            "confianza": res.confianza.as_str(),
            "razon": res.razon,
            "safety_stock": res.safety_stock,
            "target_stock": res.target_stock,
            "reorder_point": res.reorder_point,
            "cantidad_sugerida_base": res.cantidad_sugerida.ceil(),
            "presentacion_id": r.presentacion_id,
            "presentacion_nombre": r.presentacion_nombre,
            "presentacion_nombre_plural": r.presentacion_nombre_plural,
            "factor_conversion": r.factor_conversion,
            "cantidad_sugerida_presentacion": cantidad_pres,
            "precio_ultima_recepcion": r.precio_ultimo,
            "unidad_base": r.unidad_base,
            "unidad_base_plural": r.unidad_base_plural,
            "imagen_url": r.imagen_url,
            "ya_pedido_unidades": r.ya_pedido,
        }));
    }

    // 4. Ordenar: críticas primero, luego por menor autonomía
    items.sort_by(|a, b| {
        let rank = |s: &str| match s {
            "critica" => 1, "alta" => 2, _ => 3
        };
        let ra = rank(a["nivel_urgencia"].as_str().unwrap_or(""));
        let rb = rank(b["nivel_urgencia"].as_str().unwrap_or(""));
        ra.cmp(&rb).then_with(|| {
            let aa = a["autonomia_dias"].as_f64().unwrap_or(f64::INFINITY);
            let bb = b["autonomia_dias"].as_f64().unwrap_or(f64::INFINITY);
            aa.partial_cmp(&bb).unwrap_or(std::cmp::Ordering::Equal)
        })
    });

    Ok(Json(serde_json::json!({ "data": items })))
}

/// Carga la configuración del forecast desde la tabla `configuracion`.
async fn load_forecast_config(pool: &sqlx::PgPool) -> Result<ForecastConfig, AppError> {
    let row = sqlx::query!(
        r#"
        SELECT
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'ventana_demanda_dias'), 60)   AS "ventana!: i32",
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'periodo_revision_dias'), 30)  AS "revision!: i32",
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'dias_minimos_historia'), 14)  AS "minimos!: i32",
            COALESCE((SELECT valor_texto::float8 FROM configuracion WHERE clave = 'nivel_servicio_z'), 1.65)  AS "z!: f64"
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(ForecastConfig {
        ventana_demanda_dias: row.ventana,
        periodo_revision_dias: row.revision,
        dias_minimos_historia: row.minimos,
        nivel_servicio_z: row.z,
    })
}
```

- [ ] **Step 3: Compilar el backend**

```bash
cd backend && cargo build 2>&1 | tail -40
```

Expected: compila sin errores. Si hay errores de tipos en la macro `query!`, suelen ser por mis anotaciones `AS "name!: type"` — verificar que el nombre tras `AS` coincida con el de la columna en SQL y que el tipo Rust sea consistente.

- [ ] **Step 4: Levantar el backend y probar el endpoint**

```bash
docker compose restart backend
sleep 5
curl -s http://localhost:8080/api/v1/solicitudes-compra/recomendaciones \
  -H "Authorization: Bearer $(./scripts/get-token.sh 2>/dev/null || echo TOKEN)" | head -100
```

Si no hay script de token, omitir y verificar desde el frontend.

Expected: respuesta JSON con `{"data": [...]}`. El producto `prueba pcr` ya **no** debe aparecer con cantidad sugerida 1093 — debería estar ausente (stock 169 cubre el mínimo 50) o bien con una recomendación realista basada en stock_minimo si tiene confianza baja.

- [ ] **Step 5: Commit**

```bash
git add backend/src/dto/solicitud.rs backend/src/handlers/solicitudes_compra.rs
git commit -m "feat(solicitudes): cálculo (T,S) con EWMA winsorizada, σ y nivel de confianza"
```

---

### Task 5: Actualizar `/horizonte` para reutilizar la misma lógica

**Files:**
- Modify: `backend/src/handlers/solicitudes_compra.rs:551-689`

Por consistencia, `/horizonte` debe usar el mismo μ y σ que `/recomendaciones` en lugar de su propio cálculo manual.

- [ ] **Step 1: Reemplazar la función `horizonte_sugerido` completa**

Borrar el bloque `async fn horizonte_sugerido(...) { ... }` (líneas ~551-689) y sustituirlo por:

```rust
async fn horizonte_sugerido(
    State(state): State<AppState>,
    Query(params): Query<HorizonteParams>,
) -> Result<Json<HorizonteResponse>, AppError> {
    let cfg = load_forecast_config(&state.pool).await?;

    // 1. Serie diaria, stock, ya_pedido, lead time del producto
    let row = sqlx::query!(
        r#"
        WITH ventana AS (SELECT NOW() - ($2::int * INTERVAL '1 day') AS desde),
        dias AS (
            SELECT generate_series((SELECT desde FROM ventana)::date, NOW()::date, INTERVAL '1 day')::date AS dia
        ),
        consumo_dia AS (
            SELECT m.created_at::date AS dia, SUM(m.cantidad)::FLOAT8 AS cantidad
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE l.producto_id = $1
              AND m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
            GROUP BY m.created_at::date
        ),
        serie AS (
            SELECT array_agg(COALESCE(cd.cantidad, 0) ORDER BY d.dia)::FLOAT8[] AS serie
            FROM dias d
            LEFT JOIN consumo_dia cd ON cd.dia = d.dia
        )
        SELECT
            COALESCE(p.stock_minimo, 0)::FLOAT8                              AS "stock_minimo!: f64",
            COALESCE((SELECT SUM(s.cantidad)::FLOAT8 FROM stock s
                      JOIN lotes l2 ON l2.id = s.lote_id WHERE l2.producto_id = p.id), 0)
                                                                              AS "stock_actual!: f64",
            COALESCE(p.lead_time_propio,
                     prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                        AS "lead_time!: i32",
            (SELECT serie FROM serie)                                         AS "serie!: Vec<f64>"
        FROM productos p
        LEFT JOIN proveedores prov ON prov.id = $3
        WHERE p.id = $1
        "#,
        params.producto_id,
        cfg.ventana_demanda_dias,
        params.proveedor_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

    // 2. Forecast
    let res = compute_forecast(
        &row.serie,
        row.stock_actual,
        row.stock_minimo,
        0.0, // no descuento ya_pedido aquí — el cliente ajusta horizonte sobre el item
        row.lead_time,
        cfg,
    );

    // 3. Horizonte sugerido = lead_time + revisión, clampado a un piso de 7d.
    //    Si la confianza es baja, no inventar horizonte: devolver lead_time × 3.
    let horizonte_sugerido = if res.confianza == forecast::Confianza::Baja {
        ((row.lead_time as f64 * 3.0) as i32).max(30)
    } else {
        let base = row.lead_time + cfg.periodo_revision_dias;
        let cv = if res.mu > 0.0 { res.sigma / res.mu } else { 0.0 };
        let mult = if cv < 0.3 { 1.0 } else if cv < 0.7 { 1.3 } else { 1.5 };
        let ajustado = (base as f64 * mult) as i32;
        let piso = ((row.lead_time as f64 * 1.5) as i32).max(7);
        ajustado.max(piso)
    };

    let cv = if res.mu > 0.0 { res.sigma / res.mu } else { 0.0 };

    Ok(Json(HorizonteResponse {
        horizonte_sugerido,
        razon: res.razon.clone(),
        consumo_diario: res.mu,
        stock_actual: row.stock_actual,
        stock_minimo: row.stock_minimo,
        factores: HorizonteFactores {
            ciclo_historico_dias: None,
            n_pedidos_historico: 0,
            coeficiente_variacion: (cv * 100.0).round() / 100.0,
            multiplicador_variabilidad: 1.0,
            lead_time: row.lead_time,
        },
    }))
}
```

- [ ] **Step 2: Compilar**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/handlers/solicitudes_compra.rs
git commit -m "refactor(horizonte): reutilizar forecast service para μ y σ"
```

---

### Task 6: Test de integración — bug de "prueba pcr"

**Files:**
- Modify: `backend/tests/solicitudes_test.rs`

- [ ] **Step 1: Añadir test al final del archivo `solicitudes_test.rs`**

Añadir esta función al final del archivo:

```rust
#[sqlx::test(migrations = "./migrations")]
async fn recomendaciones_baja_confianza_no_extrapola(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Crear producto con stock_minimo 50 y lead_time_propio 10
    let prod_id = setup_producto(&pool, &admin_token, &app).await;
    sqlx::query!("UPDATE productos SET stock_minimo = 50, lead_time_propio = 10 WHERE id = $1", prod_id)
        .execute(&pool).await.unwrap();

    // 2. Insertar lote con stock 169 en área 1 (recepción y consumo simulados)
    //    Para simplicidad: insertar lote y un movimiento INGRESO + 3 movimientos CONSUMO
    //    distribuidos en los últimos 4 días (reproduce el caso prueba pcr).
    let lote_id: Uuid = sqlx::query_scalar!(
        r#"INSERT INTO lotes (producto_id, codigo, fecha_vencimiento)
           VALUES ($1, 'LOT-TEST', NOW() + INTERVAL '180 days')
           RETURNING id"#,
        prod_id
    ).fetch_one(&pool).await.unwrap();

    let usuario_id: Uuid = sqlx::query_scalar!(
        "SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1"
    ).fetch_one(&pool).await.unwrap();

    // INGRESO 300u hace 4 días
    sqlx::query!(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'INGRESO', 300, 300, $2, NOW() - INTERVAL '4 days')"#,
        lote_id, usuario_id
    ).execute(&pool).await.unwrap();

    // CONSUMO 100u hace 4 días
    sqlx::query!(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'CONSUMO', 100, 200, $2, NOW() - INTERVAL '4 days')"#,
        lote_id, usuario_id
    ).execute(&pool).await.unwrap();

    // CONSUMO 1u hace 3 días
    sqlx::query!(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'CONSUMO', 1, 199, $2, NOW() - INTERVAL '3 days')"#,
        lote_id, usuario_id
    ).execute(&pool).await.unwrap();

    // CONSUMO 30u hoy
    sqlx::query!(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'CONSUMO', 30, 169, $2, NOW())"#,
        lote_id, usuario_id
    ).execute(&pool).await.unwrap();

    // 3. Llamar al endpoint de recomendaciones
    let (status, body) = common::get_json(&app, "/api/v1/solicitudes-compra/recomendaciones", &admin_token).await;
    assert_eq!(status, StatusCode::OK);

    // 4. El producto NO debe sugerir 1093 unidades. Como stock 169 > stock_minimo 50,
    //    y la confianza es baja (3 días con consumo), simplemente NO debe aparecer
    //    o debe aparecer con cantidad_sugerida_base = 0.
    let items = body["data"].as_array().expect("data debe ser array");
    let nuestro = items.iter().find(|i| {
        i["producto_id"].as_str() == Some(&prod_id.to_string())
    });

    if let Some(item) = nuestro {
        let cant = item["cantidad_sugerida_base"].as_f64().unwrap_or(-1.0);
        assert!(
            cant < 100.0,
            "con confianza baja y stock suficiente, la sugerencia debe ser baja, fue {}",
            cant
        );
        assert_eq!(item["confianza"].as_str(), Some("baja"));
    }
    // Si no aparece, también es válido — significa que clasificó "sin urgencia".
}
```

- [ ] **Step 2: Verificar el helper `get_json` existe en common**

```bash
grep -n "pub async fn get_json" backend/tests/common/mod.rs
```

Si no existe, añadirlo después de `post_json` con la misma forma pero usando `Method::GET` y sin body.

- [ ] **Step 3: Ejecutar el test**

```bash
cd backend && cargo test --test solicitudes_test recomendaciones_baja_confianza
```

Expected: pasa.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/solicitudes_test.rs backend/tests/common/mod.rs
git commit -m "test(solicitudes): regresión por baja confianza no extrapola sugerencia"
```

---

### Task 7: Regenerar tipos TypeScript

**Files:**
- Modify: `frontend/src/types/generated.ts` (auto)

- [ ] **Step 1: Ejecutar el exportador**

```bash
cd backend && cargo run --bin export_types
```

Expected: imprime los tipos generados y sobrescribe `frontend/src/types/generated.ts`.

- [ ] **Step 2: Verificar que `ItemRecomendado` tiene los nuevos campos**

```bash
grep -A 30 "ItemRecomendado" frontend/src/types/generated.ts
```

Expected: incluye `consumo_sigma`, `confianza`, `razon`, `dias_con_consumo`, `safety_stock`, `target_stock`, `reorder_point`.

- [ ] **Step 3: Compilar el frontend (se esperan errores en pages/solicitudes-compra)**

```bash
cd frontend && npm run build 2>&1 | tail -30
```

Expected: errores de TypeScript (campos del nuevo tipo no usados — eso se arregla en Task 8). NO commitear todavía.

---

### Task 8: UI — badge de confianza y tooltip de cálculo

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx`
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Step 1: Mostrar el badge de confianza en cada card**

En `quiebres-panel.tsx`, dentro del bloque `recomendaciones.map(r => { ... })`, después de la línea que define `const isAlta = r.nivel_urgencia === 'alta'` (alrededor de la línea 111), añadir:

```tsx
const confianza = (r.confianza ?? 'baja') as 'alta' | 'media' | 'baja'
const confianzaColor = confianza === 'alta' ? 'bg-success/15 text-success'
                     : confianza === 'media' ? 'bg-warning/15 text-warning'
                     : 'bg-base-300 text-base-content/60'
const confianzaLabel = confianza === 'alta' ? '✓ datos sólidos'
                     : confianza === 'media' ? '~ datos parciales'
                     : '⚠ historial corto'
```

Luego, dentro del primer bloque `<div className="flex items-start justify-between gap-1">` (≈ línea 139), debajo del span de urgencia, añadir un `<span>` adicional con la confianza:

```tsx
<span
  className={cn(
    "shrink-0 text-[8px] font-medium px-1.5 py-0.5 rounded-full leading-tight",
    confianzaColor
  )}
  title={r.razon ?? ''}
>
  {confianzaLabel}
</span>
```

Y en la línea de "Sug:" (≈ línea 161), envolver el texto con un `<span title={r.razon ?? ''}>` para que al hover se vea el desglose:

```tsx
{yaPedido === 0 && (
  <p className="text-[9px] text-base-content/35 font-medium" title={r.razon ?? ''}>
    Sug: {sugLabel}
  </p>
)}
```

- [ ] **Step 2: En el handler de "agregar al pedido", respetar confianza baja**

En `frontend/src/pages/solicitudes-compra/index.tsx`, dentro de `handleAddFromRec` (≈ línea 256), cuando `r.confianza === 'baja'`, **no** prefijar la cantidad con `cantidad_sugerida_base`. Buscar el bloque que asigna `cantidad` desde `cantidad_sugerida_base` (≈ línea 263 `const consumoDiario = parseFloat(r.consumo_diario.toString())`). Inmediatamente antes del `setItems(...)` final del handler, añadir:

```tsx
const sugBase = parseFloat(r.cantidad_sugerida_base.toString())
const cantidadInicial = r.confianza === 'baja' ? 0 : Math.ceil(sugBase)
```

Y luego usar `cantidadInicial` donde antes se usaba `Math.ceil(sugBase)` o equivalente. Si la lógica actual ya usa `cantidad_sugerida_base`, sustituir esa lectura por `cantidadInicial`.

- [ ] **Step 3: Compilar el frontend**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: build pasa sin errores de TypeScript.

- [ ] **Step 4: Levantar dev server y verificar manualmente**

```bash
cd frontend && npm run dev
```

Abrir http://localhost:5173/solicitudes-compra, seleccionar el proveedor de "prueba pcr" (PROVEEDOR MOLECULAR). Verificar:
- "prueba pcr" **no** sugiere ~1093 unidades.
- Si aparece, muestra el badge "⚠ historial corto" en gris/neutral.
- Hover sobre "Sug:" o el badge muestra el tooltip con μ, σ, L, T, Z.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/generated.ts frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "ui(solicitudes): badge de confianza, tooltip de cálculo y respeto de confianza baja"
```

---

### Task 9: Verificación manual end-to-end

- [ ] **Step 1: Reiniciar todo**

```bash
docker compose restart backend
# Levantar frontend si no está corriendo
```

- [ ] **Step 2: Ejecutar query de control sobre "prueba pcr"**

```bash
docker exec 14marzoinventario-db-1 psql -U lab_user -d inventario_lab -c "
SELECT
  p.nombre,
  p.stock_minimo,
  p.lead_time_propio,
  COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id=s.lote_id WHERE l.producto_id=p.id),0) AS stock,
  (SELECT COUNT(DISTINCT m.created_at::date)
     FROM movimientos m JOIN lotes l ON l.id=m.lote_id
     WHERE l.producto_id=p.id AND m.tipo='CONSUMO'
       AND m.created_at >= NOW() - INTERVAL '60 days') AS dias_con_consumo
FROM productos p WHERE p.codigo_interno='PRD-00002';"
```

Anotar el resultado para comparar con la respuesta del endpoint.

- [ ] **Step 3: Llamar al endpoint y verificar**

Desde el navegador (DevTools → Network) o con curl:

```
GET /api/v1/solicitudes-compra/recomendaciones
```

Buscar el item de PRD-00002 (si aparece). Verificar que:
- `confianza` == `"baja"` (con sólo 3 días de consumo)
- `cantidad_sugerida_base` ≤ stock_minimo (no se extrapola).
- `razon` contiene "Historial insuficiente".

- [ ] **Step 4: Probar con un producto de historial sólido**

Identificar un producto con ≥ 30 días de consumos en BD (si no existe uno real, el test de regresión ya lo cubre). Verificar que `confianza === 'alta'` y que `cantidad_sugerida_base` corresponde a `μ × (L+T) + Z·σ·√(L+T) − stock − ya_pedido`.

- [ ] **Step 5: Commit final con tag de feature**

```bash
git tag forecast-v1
git log --oneline -10
```

---

## Notas de operación

- Para ajustar el nivel de servicio sin redeploy: `UPDATE configuracion SET valor_texto = '2.33' WHERE clave = 'nivel_servicio_z';` (Z=2.33 → 99% cobertura).
- Para productos donde el laboratorio sabe que la demanda es errática y prefiere pedir menos a costa de quiebres puntuales, bajar Z a 1.28 (90%).
- El umbral `dias_minimos_historia=14` puede subirse a 21 para más exigencia o bajarse a 7 si los productos rotan muy rápido.
- `ventana_demanda_dias=60` es un buen default; subir a 90 si hay estacionalidad mensual fuerte; no bajar de 30.

## Rollback

Si algo falla en producción, revertir los commits desde la migration en orden inverso:

```bash
git revert <hash forecast-v1>..HEAD
```

La migration 046 sólo inserta filas; no necesita rollback de schema (las claves nuevas son ignoradas por el código viejo).
