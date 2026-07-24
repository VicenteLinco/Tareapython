use crate::errors::AppError;
use serde::Deserialize;
use sqlx::PgPool;
use std::time::Duration;
use tracing::{info, warn};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DispositivoMapeado {
    pub nombre: String,
    pub fabricante: Option<String>,
    pub sku_ref: Option<String>,
    pub clase_riesgo: Option<String>,
    pub descripcion: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FdaGudidDevice {
    #[serde(rename = "brandName")]
    brand_name: Option<String>,
    #[serde(rename = "companyName")]
    company_name: Option<String>,
    #[serde(rename = "versionModelNumber")]
    version_model_number: Option<String>,
    #[serde(rename = "deviceDescription")]
    device_description: Option<String>,
    #[serde(rename = "catalogNumber")]
    catalog_number: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FdaGudidContainer {
    device: Option<FdaGudidDevice>,
}

#[derive(Debug, Deserialize)]
struct FdaGudidResponse {
    gudid: Option<FdaGudidContainer>,
}

#[derive(Debug, Deserialize)]
struct EudamedResponse {
    name: Option<String>,
    manufacturer: Option<String>,
    sku_ref: Option<String>,
    clase_riesgo: Option<String>,
}

pub async fn lookup_dispositivo(pool: &PgPool, code: &str) -> Result<DispositivoMapeado, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(3000))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build reqwest client: {}", e)))?;

    // 1. FDA AccessGUDID lookup
    let fda_url_base = std::env::var("FDA_API_URL").unwrap_or_else(|_| {
        "https://accessgudid.nlm.nih.gov/api/v2/devices/lookup.json".to_string()
    });

    let fda_url = if fda_url_base.contains("{code}") {
        fda_url_base.replace("{code}", code)
    } else if fda_url_base.contains('?') {
        format!("{}&di={}", fda_url_base, code)
    } else {
        format!("{}?di={}", fda_url_base, code)
    };

    info!("Querying FDA AccessGUDID: {}", fda_url);
    match client.get(&fda_url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<FdaGudidResponse>().await {
            Ok(fda_res) => {
                if let Some(gudid) = fda_res.gudid
                    && let Some(device) = gudid.device {
                        let brand = device.brand_name.clone().unwrap_or_default();
                        let desc = device.device_description.clone().unwrap_or_default();
                        let (name, final_desc) = if brand.is_empty() && desc.is_empty() {
                            (format!("Dispositivo sin nombre (GTIN: {})", code), None)
                        } else if !brand.is_empty() && !desc.is_empty() {
                            (format!("{} - {}", brand, desc), Some(desc))
                        } else if !brand.is_empty() {
                            (brand, None)
                        } else {
                            (desc.clone(), Some(desc))
                        };

                        let fabricante = device
                            .company_name
                            .clone()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());

                        let sku_ref = device
                            .catalog_number
                            .clone()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .or_else(|| device.version_model_number.clone());

                        return Ok(DispositivoMapeado {
                            nombre: name,
                            fabricante,
                            sku_ref,
                            clase_riesgo: None,
                            descripcion: final_desc,
                        });
                    }
            }
            Err(err) => {
                warn!("Failed to parse FDA GUDID response for {}: {}", code, err);
            }
        },
        Ok(resp) => {
            warn!(
                "FDA AccessGUDID returned status {} for code: {}",
                resp.status(),
                code
            );
        }
        Err(err) => {
            warn!(
                "FDA AccessGUDID query failed or timed out for code: {}. Error: {}",
                code, err
            );
        }
    }

    // 2. EUDAMED API search fallback
    let eudamed_url_base = std::env::var("EUDAMED_API_URL")
        .unwrap_or_else(|_| "https://eudamed-mock.example.com/api/v1/devices/{code}".to_string());

    let eudamed_url = if eudamed_url_base.contains("{code}") {
        eudamed_url_base.replace("{code}", code)
    } else if eudamed_url_base.contains('?') {
        format!("{}&code={}", eudamed_url_base, code)
    } else {
        format!("{}/{}", eudamed_url_base, code)
    };

    info!("Querying EUDAMED: {}", eudamed_url);
    match client.get(&eudamed_url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<EudamedResponse>().await {
            Ok(eudamed_res) => {
                let name = eudamed_res.name.clone().unwrap_or_default();
                if !name.is_empty() {
                    let fabricante = eudamed_res
                        .manufacturer
                        .clone()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .or_else(|| Some("EUDAMED Manufacturer".to_string()));
                    return Ok(DispositivoMapeado {
                        nombre: name,
                        fabricante,
                        sku_ref: eudamed_res.sku_ref.clone(),
                        clase_riesgo: eudamed_res.clase_riesgo.clone(),
                        descripcion: None,
                    });
                }
            }
            Err(err) => {
                warn!("Failed to parse EUDAMED response for {}: {}", code, err);
            }
        },
        Ok(resp) => {
            warn!(
                "EUDAMED returned status {} for code: {}",
                resp.status(),
                code
            );
        }
        Err(err) => {
            warn!(
                "EUDAMED query failed or timed out for code: {}. Error: {}",
                code, err
            );
        }
    }

    // 3. Local historical lookup
    info!("Querying local catalog for code: {}", code);
    #[derive(sqlx::FromRow)]
    struct LocalProductRow {
        nombre: String,
        clase_riesgo: Option<String>,
        sku: Option<String>,
        fabricante: Option<String>,
        descripcion: Option<String>,
    }

    let local_prod = sqlx::query_as::<_, LocalProductRow>(
        r#"SELECT p.nombre, p.clase_riesgo, pres.sku, p.fabricante, p.descripcion 
           FROM productos p
           JOIN presentaciones pres ON pres.producto_id = p.id
           WHERE (pres.gtin = $1 OR pres.sku = $1 OR pres.codigo_barras = $1)
             AND p.deleted_at IS NULL
           LIMIT 1"#,
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;

    if let Some(prod) = local_prod {
        return Ok(DispositivoMapeado {
            nombre: prod.nombre,
            fabricante: prod
                .fabricante
                .or_else(|| Some("Histórico Local".to_string())),
            sku_ref: prod.sku,
            clase_riesgo: prod.clase_riesgo,
            descripcion: prod.descripcion,
        });
    }

    Err(AppError::NotFound(format!(
        "Dispositivo con código '{}' no encontrado en registros regulatorios ni catálogo local.",
        code
    )))
}
