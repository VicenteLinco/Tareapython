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
        // [10×10, 0×10] con α=0.2: EWMA debe quedar por debajo del promedio simple (5.0)
        // porque los ceros recientes (alta ponderación) arrastran la media hacia abajo.
        let mut s = vec![10.0; 10];
        s.extend(vec![0.0; 10]);
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
