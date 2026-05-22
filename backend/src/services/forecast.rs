//! Forecast de demanda y política de inventario Periodic Review (T, S).
//!
//! Funciones puras, sin estado, fácilmente testeables. Los handlers leen la
//! serie diaria de consumo desde Postgres y delegan toda la matemática aquí.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confianza {
    Alta,
    Media,
    Baja,
}

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
pub enum Urgencia {
    Critica,
    Alta,
    Media,
}

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
    pub factor_historial_corto: f64,
}

impl Default for ForecastConfig {
    fn default() -> Self {
        Self {
            ventana_demanda_dias: 60,
            periodo_revision_dias: 30,
            dias_minimos_historia: 14,
            nivel_servicio_z: 1.65,
            factor_historial_corto: 0.35,
        }
    }
}

/// Resultado del cálculo para un producto.
#[derive(Debug, Clone)]
pub struct ForecastResult {
    pub mu: f64,    // demanda diaria esperada (u/día)
    pub sigma: f64, // desviación estándar diaria (u/día)
    pub dias_con_consumo: i32,
    pub confianza: Confianza,
    pub razon: String,
    pub safety_stock: f64,      // Z · σ · √(L + T)
    pub target_stock: f64,      // S = μ·(L+T) + safety_stock
    pub reorder_point: f64,     // ROP = μ·L + Z·σ·√L
    pub cantidad_sugerida: f64, // max(0, S − stock_actual − ya_pedido)  [unidades base]
    pub urgencia: Option<Urgencia>,
}

#[derive(Debug, Clone, Copy)]
pub struct ShortHistoryEstimate {
    pub consumo_diario: f64,
    pub promedio_ventana: f64,
    pub promedio_reciente_desc: f64,
    pub dias_desde_primer_consumo: i32,
    pub factor_descuento: f64,
}

/// Winsoriza una serie al percentil 95 calculado sobre los valores no-cero.
/// Los ceros (días sin consumo) son parte del patrón de demanda intermitente,
/// no outliers, por lo que no deben influir en el umbral de recorte.
pub fn winsorize_p95(serie: &[f64]) -> Vec<f64> {
    if serie.is_empty() {
        return Vec::new();
    }
    let no_ceros: Vec<f64> = serie.iter().copied().filter(|&v| v > 0.0).collect();
    if no_ceros.is_empty() {
        return serie.to_vec();
    }
    let mut ordenado = no_ceros.clone();
    ordenado.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = ordenado.len();
    let idx = ((0.95 * (n as f64)).ceil() as usize)
        .saturating_sub(1)
        .min(n - 1);
    let p95 = ordenado[idx];
    serie.iter().map(|&v| if v > 0.0 { v.min(p95) } else { 0.0 }).collect()
}

/// Estima el consumo diario base usando la ventana real desde el primer consumo.
/// Sin factor de descuento: divide el total consumido entre los días transcurridos
/// desde el primer evento, no entre toda la ventana de observación.
/// Devuelve 0.0 si no hay consumo o solo hay un evento (insuficiente para proyectar).
pub fn consumo_base_adaptivo(serie: &[f64]) -> f64 {
    let total: f64 = serie.iter().sum();
    if total <= 0.0 {
        return 0.0;
    }
    let dias_con_consumo = serie.iter().filter(|&&v| v > 0.0).count();
    if dias_con_consumo < 2 {
        return 0.0;
    }
    let primer_idx = serie.iter().position(|&v| v > 0.0).unwrap_or(serie.len());
    let dias_reales = (serie.len().saturating_sub(primer_idx)).max(1) as f64;
    total / dias_reales
}

/// Devuelve el mayor promedio de consumo diario observado en cualquier ventana
/// de 7 días consecutivos dentro de la serie. Sirve como proxy del "peor pico"
/// reciente para calcular un escenario conservador de días de autonomía.
/// Requiere al menos 7 elementos; con menos retorna 0.0 (sin pico definible).
pub fn consumo_pico_7d(serie: &[f64]) -> f64 {
    if serie.len() < 7 {
        return 0.0;
    }
    serie
        .windows(7)
        .map(|w| w.iter().sum::<f64>() / 7.0)
        .fold(0.0_f64, f64::max)
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

/// Estima demanda para planificar horizontes cuando existe consumo real pero
/// aun no hay suficientes dias para confiar en el forecast automatico.
pub fn estimate_short_history_demand(
    serie_diaria: &[f64],
    min_dias_historia: i32,
    factor_descuento: f64,
) -> Option<ShortHistoryEstimate> {
    let dias_con_consumo = serie_diaria.iter().filter(|&&v| v > 0.0).count() as i32;
    if dias_con_consumo <= 1 || dias_con_consumo >= min_dias_historia {
        return None;
    }

    let total_consumo: f64 = serie_diaria.iter().sum();
    if total_consumo <= 0.0 {
        return None;
    }

    let dias_ventana = serie_diaria.len().max(1) as f64;
    let primer_idx = serie_diaria
        .iter()
        .position(|&v| v > 0.0)
        .unwrap_or(serie_diaria.len().saturating_sub(1));
    let dias_desde_primer = (serie_diaria.len().saturating_sub(primer_idx)).max(1) as f64;

    let promedio_ventana = total_consumo / dias_ventana;
    let promedio_reciente_desc = (total_consumo / dias_desde_primer) * factor_descuento;
    let consumo_diario = promedio_ventana.max(promedio_reciente_desc);

    Some(ShortHistoryEstimate {
        consumo_diario,
        promedio_ventana,
        promedio_reciente_desc,
        dias_desde_primer_consumo: dias_desde_primer as i32,
        factor_descuento,
    })
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
        stock_actual,
        ya_pedido,
        stock_minimo,
        mu,
        l,
        reorder_point,
        target_stock,
    );

    let razon = format!(
        "μ={:.2} u/día (EWMA winsorizada p95, {} días con consumo de {}), \
         σ={:.2}, L={:.0}d, T={:.0}d, Z={:.2}",
        mu,
        dias_con_consumo,
        serie_diaria.len(),
        sigma,
        l,
        t,
        z
    );

    ForecastResult {
        mu,
        sigma,
        dias_con_consumo,
        confianza,
        razon,
        safety_stock,
        target_stock,
        reorder_point,
        cantidad_sugerida,
        urgencia,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, eps: f64) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn winsorize_recorta_pico_real_entre_no_ceros() {
        // 19 valores normales de 5 + un outlier de 100 → p95 de no-ceros recorta 100
        let mut s = vec![5.0; 19];
        s.push(100.0);
        let w = winsorize_p95(&s);
        // p95 de [5×19, 100]: índice 18 de 20 sorted = 5... wait, sorted=[5,5,...,5,100]
        // p95 = sorted[ceil(0.95*20)-1] = sorted[18] = 5
        assert_eq!(w[19], 5.0, "el outlier real debe quedar recortado al p95 de no-ceros");
    }

    #[test]
    fn winsorize_no_recorta_consumos_reales_en_serie_esparsa() {
        // 57 ceros + consumos de 10, 30, 100 → con la corrección NO se recortan
        let mut s = vec![0.0; 57];
        s.push(10.0);
        s.push(30.0);
        s.push(100.0);
        let w = winsorize_p95(&s);
        // p95 de no-ceros [10,30,100]: índice 2 de 3 = 100
        assert_eq!(w[57], 10.0);
        assert_eq!(w[58], 30.0);
        assert_eq!(w[59], 100.0, "los consumos reales no deben recortarse en serie esparsa");
    }

    #[test]
    fn winsorize_no_modifica_serie_uniforme() {
        let s = vec![5.0; 30];
        assert_eq!(winsorize_p95(&s), s);
    }

    #[test]
    fn consumo_base_adaptivo_usa_ventana_real() {
        // Consumos de 100, 30, 10 en los últimos 6 días de una ventana de 60
        let mut s = vec![0.0; 54];
        s.push(100.0); // día 54
        s.push(0.0);
        s.push(30.0);  // día 56
        s.push(0.0);
        s.push(0.0);
        s.push(10.0);  // día 59
        assert_eq!(s.len(), 60);
        let c = consumo_base_adaptivo(&s);
        // dias_reales = 60 - 54 = 6, total = 140 → 140/6 ≈ 23.33
        assert!((c - 23.333).abs() < 0.01, "consumo_base_adaptivo dio {}", c);
    }

    #[test]
    fn consumo_base_adaptivo_un_evento_devuelve_cero() {
        let mut s = vec![0.0; 59];
        s.push(100.0);
        assert_eq!(consumo_base_adaptivo(&s), 0.0);
    }

    #[test]
    fn consumo_pico_7d_detecta_semana_de_alta_demanda() {
        // 53 días normales a 5/día + 7 días de pico a 30/día
        let mut s = vec![5.0; 53];
        s.extend(vec![30.0; 7]);
        let pico = consumo_pico_7d(&s);
        assert!((pico - 30.0).abs() < 0.01, "pico esperado 30, dio {}", pico);
    }

    #[test]
    fn consumo_pico_7d_serie_uniforme_igual_al_promedio() {
        let s = vec![7.0; 30];
        assert!((consumo_pico_7d(&s) - 7.0).abs() < 0.01);
    }

    #[test]
    fn consumo_pico_7d_serie_menor_de_7_devuelve_cero() {
        // Sin 7 días no hay ventana completa: no hay "pico" definible
        let s = vec![10.0, 20.0, 5.0];
        assert_eq!(consumo_pico_7d(&s), 0.0);
    }

    #[test]
    fn ewma_da_mas_peso_a_valores_recientes() {
        // [10×10, 0×10] con α=0.2: EWMA debe quedar por debajo del promedio simple (5.0)
        // porque los ceros recientes (alta ponderación) arrastran la media hacia abajo.
        let mut s = vec![10.0; 10];
        s.extend(vec![0.0; 10]);
        let mu = ewma(&s, 0.2);
        assert!(
            mu < 5.0,
            "EWMA debería bajar tras los ceros recientes, dio {}",
            mu
        );
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
        serie[57] = 1.0; // hace 3 días
        serie[59] = 30.0; // hoy
        let r = compute_forecast(&serie, 169.0, 50.0, 0.0, 10, ForecastConfig::default());
        assert_eq!(r.confianza, Confianza::Baja);
        assert_eq!(r.dias_con_consumo, 3);
        // Stock 169 ya cubre el mínimo 50 → cantidad sugerida = 0
        assert_eq!(r.cantidad_sugerida, 0.0);
        assert!(r.razon.contains("Historial insuficiente"));
    }

    #[test]
    fn estimacion_historial_corto_combina_ventana_y_reciente_descontado() {
        let mut serie = vec![0.0; 61];
        serie[55] = 100.0;
        serie[56] = 1.0;
        serie[59] = 30.0;

        let est = estimate_short_history_demand(&serie, 14, 0.35)
            .expect("debe estimar con 3 dias de consumo");

        assert_eq!(est.dias_desde_primer_consumo, 6);
        assert!(approx(est.promedio_ventana, 131.0 / 61.0, 0.001));
        assert!(approx(
            est.promedio_reciente_desc,
            (131.0 / 6.0) * 0.35,
            0.001
        ));
        assert!(approx(est.consumo_diario, (131.0 / 6.0) * 0.35, 0.001));
    }

    #[test]
    fn estimacion_historial_corto_no_estima_con_un_solo_dia() {
        let mut serie = vec![0.0; 60];
        serie[59] = 100.0;
        assert!(estimate_short_history_demand(&serie, 14, 0.35).is_none());
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
        assert!(
            r.mu < 6.0,
            "μ con winsorización debería ser ~5, dio {}",
            r.mu
        );
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

    // ─── Escenarios D6 requeridos ────────────────────────────────────────────

    /// D6-F1: Consumo estable diario → confianza Alta, cantidad_sugerida > 0
    /// cuando stock_actual < target, μ ≈ consumo_diario.
    #[test]
    fn forecast_consumo_estable() {
        // 60 días con consumo constante de 10 u/día → 60 días con consumo ≥ 30 → Alta
        let serie = vec![10.0; 60];
        let cfg = ForecastConfig::default();
        let r = compute_forecast(&serie, 50.0, 0.0, 0.0, 7, cfg);
        assert_eq!(r.confianza, Confianza::Alta, "consumo estable debe dar confianza Alta");
        assert!(r.mu > 9.5 && r.mu < 10.5, "μ debe estar cerca de 10, dio {}", r.mu);
        assert!(r.cantidad_sugerida > 0.0, "debe sugerir compra cuando stock < target");
    }

    /// D6-F2: Consumo esporádico (muchos ceros) → confianza Baja o Media según
    /// cuántos días tienen consumo real.
    #[test]
    fn forecast_consumo_esporadico() {
        // 60 días: solo 5 días con consumo → dias_con_consumo < 14 → Baja
        let mut serie = vec![0.0; 60];
        serie[10] = 20.0;
        serie[25] = 15.0;
        serie[40] = 30.0;
        serie[50] = 10.0;
        serie[58] = 5.0;
        let cfg = ForecastConfig::default();
        let r = compute_forecast(&serie, 100.0, 50.0, 0.0, 7, cfg);
        assert_eq!(
            r.confianza,
            Confianza::Baja,
            "consumo esporádico con <14 días activos debe dar confianza Baja"
        );
        assert_eq!(r.dias_con_consumo, 5);
        // Con confianza baja y stock_actual=100 >= stock_minimo=50 → cantidad_sugerida = 0
        assert_eq!(r.cantidad_sugerida, 0.0);
    }

    /// D6-F3: Sin historia (todos ceros) → confianza Baja, usa stock_mínimo como referencia.
    #[test]
    fn forecast_sin_historia() {
        // 60 días con cero consumo (producto nuevo o sin movimientos)
        let serie = vec![0.0; 60];
        let cfg = ForecastConfig::default();
        // stock_actual=0, stock_minimo=100 → debe sugerir 100
        let r = compute_forecast(&serie, 0.0, 100.0, 0.0, 7, cfg);
        assert_eq!(r.confianza, Confianza::Baja, "sin historia debe dar confianza Baja");
        assert_eq!(r.dias_con_consumo, 0);
        assert_eq!(r.mu, 0.0);
        // cantidad_sugerida = stock_minimo - stock_actual - ya_pedido = 100 - 0 - 0 = 100
        assert!(
            approx(r.cantidad_sugerida, 100.0, 0.01),
            "sin historia debe sugerir stock_mínimo, dio {}",
            r.cantidad_sugerida
        );
        assert!(r.razon.contains("Historial insuficiente"));
    }
}
