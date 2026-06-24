use std::time::Duration;
use serde::Deserialize;
use sqlx::PgPool;
use tracing::{info, warn};
use crate::errors::AppError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DispositivoMapeado {
    pub nombre: String,
    pub fabricante: String,
    pub sku_ref: Option<String>,
    pub clase_riesgo: Option<String>,
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

pub async fn lookup_dispositivo(
    pool: &PgPool,
    code: &str,
) -> Result<DispositivoMapeado, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(3000))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build reqwest client: {}", e)))?;

    // 1. FDA AccessGUDID lookup
    let fda_url_base = std::env::var("FDA_API_URL")
        .unwrap_or_else(|_| "https://accessgudid.nlm.nih.gov/api/v2/devices/lookup.json".to_string());

    let fda_url = if fda_url_base.contains("{code}") {
        fda_url_base.replace("{code}", code)
    } else if fda_url_base.contains('?') {
        format!("{}&di={}", fda_url_base, code)
    } else {
        format!("{}?di={}", fda_url_base, code)
    };

    info!("Querying FDA AccessGUDID: {}", fda_url);
    match client.get(&fda_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<FdaGudidResponse>().await {
                Ok(fda_res) => {
                    if let Some(gudid) = fda_res.gudid {
                        if let Some(device) = gudid.device {
                            let brand = device.brand_name.clone().unwrap_or_default();
                            let desc = device.device_description.clone().unwrap_or_default();
                            let name = if !brand.is_empty() && !desc.is_empty() {
                                format!("{} - {}", brand, desc)
                            } else if !brand.is_empty() {
                                brand
                            } else {
                                desc
                            };

                            if !name.is_empty() {
                                let fabricante = device.company_name.unwrap_or_else(|| "FDA Manufacturer".to_string());
                                return Ok(DispositivoMapeado {
                                    nombre: name,
                                    fabricante,
                                    sku_ref: device.version_model_number,
                                    clase_riesgo: None,
                                });
                            }
                        }
                    }
                }
                Err(err) => {
                    warn!("Failed to parse FDA GUDID response for {}: {}", code, err);
                }
            }
        }
        Ok(resp) => {
            warn!("FDA AccessGUDID returned status {} for code: {}", resp.status(), code);
        }
        Err(err) => {
            warn!("FDA AccessGUDID query failed or timed out for code: {}. Error: {}", code, err);
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
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<EudamedResponse>().await {
                Ok(eudamed_res) => {
                    let name = eudamed_res.name.clone().unwrap_or_default();
                    if !name.is_empty() {
                        return Ok(DispositivoMapeado {
                            nombre: name,
                            fabricante: eudamed_res.manufacturer.unwrap_or_else(|| "EUDAMED Manufacturer".to_string()),
                            sku_ref: eudamed_res.sku_ref,
                            clase_riesgo: eudamed_res.clase_riesgo,
                        });
                    }
                }
                Err(err) => {
                    warn!("Failed to parse EUDAMED response for {}: {}", code, err);
                }
            }
        }
        Ok(resp) => {
            warn!("EUDAMED returned status {} for code: {}", resp.status(), code);
        }
        Err(err) => {
            warn!("EUDAMED query failed or timed out for code: {}. Error: {}", code, err);
        }
    }

    // 3. Local historical lookup
    info!("Querying local catalog for code: {}", code);
    #[derive(sqlx::FromRow)]
    struct LocalProductRow {
        nombre: String,
        clase_riesgo: Option<String>,
        sku: Option<String>,
    }

    let local_prod = sqlx::query_as::<_, LocalProductRow>(
        r#"SELECT nombre, clase_riesgo, sku FROM productos
           WHERE (pres_gtin = $1 OR sku = $1 OR pres_codigo_barras = $1)
             AND deleted_at IS NULL
           LIMIT 1"#
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;

    if let Some(prod) = local_prod {
        return Ok(DispositivoMapeado {
            nombre: prod.nombre,
            fabricante: "Histórico Local".to_string(),
            sku_ref: prod.sku,
            clase_riesgo: prod.clase_riesgo,
        });
    }

    Err(AppError::NotFound(format!(
        "Dispositivo con código '{}' no encontrado en registros regulatorios ni catálogo local.",
        code
    )))
}
