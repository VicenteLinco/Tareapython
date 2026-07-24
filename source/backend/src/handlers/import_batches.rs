use crate::{
    auth::models::Claims,
    db::AppState,
    errors::AppError,
    services::{
        product_contract,
        setup_service::{self, ImportConfig},
    },
};
use axum::{
    Extension, Json, Router,
    extract::{Multipart, Path, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
const MAX_ROWS: usize = 5_000;
const MAX_COLUMNS: usize = 64;
const MAX_CELL_BYTES: usize = 4 * 1024;

async fn admin(claims: &Claims) -> Result<(), AppError> {
    crate::auth::middleware::require_role(&["admin"])(claims)
}

pub async fn create(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    mut mp: Multipart,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    setup_service::require_setup_mode(&s.pool).await?;
    let mut bytes = None;
    let mut name = "import.csv".to_string();
    let mut key = None;
    while let Some(f) = mp
        .next_field()
        .await
        .map_err(|e| AppError::Validation(e.to_string()))?
    {
        match f.name() {
            Some("file") => {
                name = f.file_name().unwrap_or("import.csv").to_string();
                let b = f
                    .bytes()
                    .await
                    .map_err(|e| AppError::Validation(e.to_string()))?;
                if b.len() > MAX_FILE_BYTES {
                    return Err(AppError::Validation("El archivo supera 5 MiB".into()));
                }
                bytes = Some(b.to_vec())
            }
            Some("idempotency_key") => {
                key = Some(
                    f.text()
                        .await
                        .map_err(|e| AppError::Validation(e.to_string()))?,
                )
            }
            _ => {}
        }
    }
    let bytes = bytes.ok_or_else(|| AppError::Validation("Archivo no encontrado".into()))?;
    let mut rdr = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(bytes.as_slice());
    let headers = rdr
        .headers()
        .map_err(|e| AppError::Validation(format!("CSV inválido: {e}")))?
        .clone();
    if headers.len() > MAX_COLUMNS {
        return Err(AppError::Validation("El CSV supera 64 columnas".into()));
    }
    let mapping: HashMap<String, String> = product_contract::importable_fields()
        .iter()
        .filter_map(|d| {
            headers
                .iter()
                .find(|h| {
                    product_contract::normalize_header(h) == d.key
                        || d.aliases.iter().any(|a| {
                            product_contract::normalize_header(h)
                                == product_contract::normalize_header(a)
                        })
                })
                .map(|h| (d.key.to_string(), h.to_string()))
        })
        .collect();
    let mut rows = Vec::new();
    for (i, r) in rdr.records().enumerate() {
        if i >= MAX_ROWS {
            return Err(AppError::Validation("El CSV supera 5000 filas".into()));
        }
        let r = r.map_err(|e| AppError::Validation(format!("Fila {} inválida: {e}", i + 2)))?;
        if r.iter().any(|v| v.len() > MAX_CELL_BYTES) {
            return Err(AppError::Validation(format!(
                "Fila {} contiene una celda mayor a 4 KiB",
                i + 2
            )));
        }
        let raw: serde_json::Map<String, Value> = headers
            .iter()
            .zip(r.iter())
            .map(|(h, v)| (h.to_string(), json!(v.trim())))
            .collect();
        let normalized: serde_json::Map<String, Value> = mapping
            .iter()
            .map(|(field, col)| (field.clone(), raw.get(col).cloned().unwrap_or(json!(""))))
            .collect();
        rows.push((i as i32 + 2, Value::Object(raw), Value::Object(normalized)));
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let idem = key.unwrap_or_else(|| digest.clone());
    let mut tx = s.pool.begin().await?;
    let id:Uuid=sqlx::query_scalar("INSERT INTO import_batches(source_name,source_sha256,source_bytes,idempotency_key,created_by,mapping) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(created_by,idempotency_key) DO UPDATE SET updated_at=now() RETURNING id").bind(name).bind(digest).bind(bytes).bind(idem).bind(c.sub).bind(json!(mapping)).fetch_one(&mut *tx).await?;
    for (n, raw, norm) in rows {
        sqlx::query("INSERT INTO import_rows(batch_id,row_number,raw,normalized) VALUES($1,$2,$3,$4) ON CONFLICT(batch_id,row_number) DO NOTHING").bind(id).bind(n).bind(raw).bind(norm).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    get_inner(&s, id).await.map(Json)
}

async fn get_inner(s: &AppState, id: Uuid) -> Result<Value, AppError> {
    let b: Value =
        sqlx::query_scalar("SELECT to_jsonb(b) - 'source_bytes' FROM import_batches b WHERE id=$1")
            .bind(id)
            .fetch_optional(&s.pool)
            .await?
            .ok_or_else(|| AppError::NotFound("Lote de importación no encontrado".into()))?;
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM import_rows r WHERE batch_id=$1 ORDER BY row_number",
    )
    .bind(id)
    .fetch_all(&s.pool)
    .await?;
    Ok(json!({"batch":b,"rows":rows}))
}
pub async fn get_one(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    Ok(Json(get_inner(&s, id).await?))
}
pub async fn list(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    let v:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(b)-'source_bytes' FROM import_batches b ORDER BY created_at DESC LIMIT 100").fetch_all(&s.pool).await?;
    Ok(Json(json!(v)))
}

#[derive(Deserialize)]
pub struct ValidateBody {
    pub mapping: Option<HashMap<String, String>>,
    pub duplicate_strategy: Option<String>,
    pub revision: i64,
}
pub async fn validate(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(body): Json<ValidateBody>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    let strategy = body.duplicate_strategy.unwrap_or_else(|| "review".into());
    if !["skip", "fill_blank", "review"].contains(&strategy.as_str()) {
        return Err(AppError::Validation(
            "Estrategia de duplicados inválida".into(),
        ));
    }
    let mut tx = s.pool.begin().await?;
    let current: i64 =
        sqlx::query_scalar("SELECT revision FROM import_batches WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if current != body.revision {
        return Err(AppError::VersionConflict {
            esperada: body.revision,
            actual: current,
        });
    }
    if let Some(m) = body.mapping {
        sqlx::query("UPDATE import_batches SET mapping=$2 WHERE id=$1")
            .bind(id)
            .bind(json!(m))
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE import_rows SET status=CASE WHEN nullif(btrim(normalized->>'nombre'),'') IS NULL THEN 'error' WHEN nullif(btrim(normalized->>'unidad_base_id'),'') IS NULL AND nullif(btrim(normalized->>'unidad'),'') IS NULL THEN 'incomplete' ELSE 'valid' END, diagnostics=CASE WHEN nullif(btrim(normalized->>'nombre'),'') IS NULL THEN '[{\"code\":\"NAME_REQUIRED\",\"field\":\"nombre\"}]'::jsonb WHEN nullif(btrim(normalized->>'unidad_base_id'),'') IS NULL AND nullif(btrim(normalized->>'unidad'),'') IS NULL THEN '[{\"code\":\"UNIT_MISSING\",\"field\":\"unidad_base_id\"}]'::jsonb ELSE '[]'::jsonb END WHERE batch_id=$1").bind(id).execute(&mut *tx).await?;
    let counts:Value=sqlx::query_scalar("SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM import_rows WHERE batch_id=$1 GROUP BY status)x").bind(id).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE import_batches SET status='validated',duplicate_strategy=$2,counts=$3,revision=revision+1,updated_at=now() WHERE id=$1").bind(id).bind(strategy).bind(&counts).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"counts":counts,"revision":current+1})))
}

#[derive(Deserialize)]
pub struct TransformBody {
    pub field: String,
    pub value: Value,
    pub mode: String,
    pub revision: i64,
    pub preview_token: Option<String>,
}
fn transform_token(id: Uuid, revision: i64, field: &str, value: &Value, mode: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{id}:{revision}:{field}:{value}:{mode}").as_bytes())
    )
}
fn validate_typed(field: &str, value: &Value) -> Result<(), AppError> {
    let d = product_contract::importable_fields()
        .into_iter()
        .find(|d| d.key == field)
        .ok_or_else(|| AppError::Validation("Campo no soportado".into()))?;
    let text = value.as_str().unwrap_or("");
    use crate::dto::producto::ProductFieldType::*;
    match d.field_type {
        Integer => {
            text.parse::<i64>()
                .map_err(|_| AppError::Validation("Se esperaba un entero".into()))?;
        }
        Decimal => {
            text.parse::<rust_decimal::Decimal>()
                .map_err(|_| AppError::Validation("Se esperaba un decimal".into()))?;
        }
        Boolean => {
            if !["true", "false", "1", "0", "si", "sí", "no"]
                .contains(&text.to_lowercase().as_str())
            {
                return Err(AppError::Validation("Se esperaba un booleano".into()));
            }
        }
        Enum
            if !d.allowed_values.contains(&text) => {
                return Err(AppError::Validation(
                    "Valor fuera del catálogo permitido".into(),
                ));
            }
        _ => {}
    }
    Ok(())
}
pub async fn transform_preview(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(b): Json<TransformBody>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    validate_typed(&b.field, &b.value)?;
    if !["blank_only", "overwrite_all"].contains(&b.mode.as_str()) {
        return Err(AppError::Validation("Modo inválido".into()));
    }
    let cur: i64 = sqlx::query_scalar("SELECT revision FROM import_batches WHERE id=$1")
        .bind(id)
        .fetch_one(&s.pool)
        .await?;
    if cur != b.revision {
        return Err(AppError::VersionConflict {
            esperada: b.revision,
            actual: cur,
        });
    }
    let affected: i64 = if b.mode == "blank_only" {
        sqlx::query_scalar("SELECT count(*) FROM import_rows WHERE batch_id=$1 AND coalesce(normalized->>$2,'')='' ").bind(id).bind(&b.field).fetch_one(&s.pool).await?
    } else {
        sqlx::query_scalar("SELECT count(*) FROM import_rows WHERE batch_id=$1")
            .bind(id)
            .fetch_one(&s.pool)
            .await?
    };
    Ok(Json(
        json!({"affected":affected,"readiness_may_change":b.field=="unidad_base_id"||b.field=="unidad","preview_token":transform_token(id,cur,&b.field,&b.value,&b.mode),"revision":cur}),
    ))
}
pub async fn transform_apply(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(b): Json<TransformBody>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    validate_typed(&b.field, &b.value)?;
    let token = transform_token(id, b.revision, &b.field, &b.value, &b.mode);
    if b.preview_token.as_deref() != Some(&token) {
        return Err(AppError::Validation(
            "La confirmación no coincide con la vista previa".into(),
        ));
    }
    let mut tx = s.pool.begin().await?;
    let cur: i64 = sqlx::query_scalar("SELECT revision FROM import_batches WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if cur != b.revision {
        return Err(AppError::VersionConflict {
            esperada: b.revision,
            actual: cur,
        });
    }
    let q = if b.mode == "blank_only" {
        "UPDATE import_rows SET normalized=jsonb_set(normalized,ARRAY[$2],$3,true) WHERE batch_id=$1 AND coalesce(normalized->>$2,'')=''"
    } else {
        "UPDATE import_rows SET normalized=jsonb_set(normalized,ARRAY[$2],$3,true) WHERE batch_id=$1"
    };
    let n = sqlx::query(q)
        .bind(id)
        .bind(&b.field)
        .bind(&b.value)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i32;
    sqlx::query("INSERT INTO import_transforms(batch_id,field,mode,typed_value,affected_count,created_by) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(&b.field).bind(&b.mode).bind(&b.value).bind(n).bind(c.sub).execute(&mut *tx).await?;
    sqlx::query("UPDATE import_batches SET revision=revision+1,status='mapped',updated_at=now() WHERE id=$1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"affected":n,"revision":cur+1})))
}

#[derive(Deserialize)]
pub struct CommitBody {
    pub revision: i64,
}
pub async fn commit(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(body): Json<CommitBody>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    setup_service::require_setup_mode(&s.pool).await?;
    let mut tx = s.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *tx)
        .await?;
    let (revision, strategy, status): (i64, String, String) = sqlx::query_as(
        "SELECT revision,duplicate_strategy,status FROM import_batches WHERE id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if revision != body.revision {
        return Err(AppError::VersionConflict {
            esperada: body.revision,
            actual: revision,
        });
    }
    if status == "committed" {
        tx.rollback().await?;
        return Ok(Json(
            json!({"committed":true,"idempotent_replay":true,"revision":revision}),
        ));
    }
    if status != "validated" {
        return Err(AppError::Conflict(
            "El lote debe validarse antes de confirmar".into(),
        ));
    }
    sqlx::query("UPDATE import_rows SET normalized=jsonb_set(normalized,'{codigo_interno}',to_jsonb('BATCH-'||substr(replace($1::text,'-',''),1,8)||'-'||row_number::text),true) WHERE batch_id=$1 AND coalesce(normalized->>'codigo_interno','')=''").bind(id).execute(&mut *tx).await?;
    let staged:Vec<Value>=sqlx::query_scalar("SELECT normalized FROM import_rows WHERE batch_id=$1 AND status<>'error' ORDER BY row_number").bind(id).fetch_all(&mut *tx).await?;
    let mut fields = product_contract::importable_fields()
        .into_iter()
        .map(|f| f.key.to_string())
        .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    let mut csv = csv::Writer::from_writer(Vec::new());
    csv.write_record(&fields)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    for row in staged {
        csv.write_record(
            fields
                .iter()
                .map(|field| row.get(field).and_then(Value::as_str).unwrap_or("")),
        )
        .map_err(|e| AppError::Validation(e.to_string()))?;
    }
    let bytes = csv
        .into_inner()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let mapping = fields.iter().map(|f| (f.clone(), f.clone())).collect();
    sqlx::query("UPDATE import_batches SET status='committing' WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let result = setup_service::importar_catalogo_en_tx(
        &mut tx,
        &bytes,
        ImportConfig {
            mapping,
            required_fields: vec!["nombre".into()],
            dry_run: false,
        },
    )
    .await?;
    if !result.valido {
        tx.rollback().await?;
        return Ok(Json(json!({"committed":false,"result":result})));
    }
    // Link staged rows back to the products created by the importer.  The
    // importer may normalize or regenerate the internal code, so retain a
    // name fallback to ensure rollback/dependency checks see the created row.
    sqlx::query("UPDATE import_rows r SET status=CASE WHEN r.status='error' THEN r.status ELSE 'committed' END,matched_product_id=p.id,outcome=jsonb_build_object('committed',r.status<>'error','product_id',p.id) FROM productos p WHERE r.batch_id=$1 AND (p.codigo_interno=r.normalized->>'codigo_interno' OR (p.nombre=r.normalized->>'nombre' AND p.origen_registro='importacion_csv'))").bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE import_batches SET status='committed',counts=$2,revision=revision+1,committed_at=now(),updated_at=now() WHERE id=$1").bind(id).bind(json!({"imported":result.importados,"skipped":result.omitidos,"errors":result.errores.len(),"duplicate_strategy":strategy})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"committed":true,"result":result,"revision":revision+1}),
    ))
}

pub async fn rollback(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    let mut tx = s.pool.begin().await?;
    let status: String =
        sqlx::query_scalar("SELECT status FROM import_batches WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if status != "committed" {
        return Err(AppError::Conflict(
            "Solo se puede revertir un lote confirmado".into(),
        ));
    }
    let dependencies:i64=sqlx::query_scalar("SELECT count(*) FROM import_rows r JOIN lotes l ON l.producto_id=r.matched_product_id WHERE r.batch_id=$1").bind(id).fetch_one(&mut *tx).await?;
    if dependencies > 0 {
        return Err(AppError::BusinessLogic(
            "La importación tiene operaciones posteriores y no puede revertirse".into(),
            "IMPORT_ROLLBACK_BLOCKED".into(),
        ));
    }
    // Break the audit-row foreign-key reference before removing imported
    // products; the row history itself must survive rollback.
    sqlx::query("UPDATE import_rows SET matched_product_id=NULL,status='rolled_back',outcome=outcome||'{\"rolled_back\":true}'::jsonb WHERE batch_id=$1").bind(id).execute(&mut *tx).await?;
    let deleted=sqlx::query("DELETE FROM productos p WHERE p.origen_registro='importacion_csv' AND p.id IN (SELECT (outcome->>'product_id')::uuid FROM import_rows WHERE batch_id=$1)").bind(id).execute(&mut *tx).await?.rows_affected();
    sqlx::query("UPDATE import_batches SET status='rolled_back',revision=revision+1,updated_at=now() WHERE id=$1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"rolled_back":true,"products_deleted":deleted})))
}

pub async fn download(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path((id, kind)): Path<(Uuid, String)>,
) -> Result<axum::response::Response, AppError> {
    use axum::response::IntoResponse;
    admin(&c).await?;
    let bytes = if kind == "original" {
        sqlx::query_scalar("SELECT source_bytes FROM import_batches WHERE id=$1")
            .bind(id)
            .fetch_one(&s.pool)
            .await?
    } else {
        let rows:Vec<(i32,Value,Value)>=sqlx::query_as("SELECT row_number,normalized,diagnostics FROM import_rows WHERE batch_id=$1 ORDER BY row_number").bind(id).fetch_all(&s.pool).await?;
        serde_json::to_vec(&rows).unwrap()
    };
    Ok((
        [(
            "content-type",
            if kind == "original" {
                "text/csv"
            } else {
                "application/json"
            },
        )],
        bytes,
    )
        .into_response())
}
pub async fn cancel(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    let n=sqlx::query("UPDATE import_batches SET status='cancelled',revision=revision+1 WHERE id=$1 AND status IN ('uploaded','mapped','validated','failed')").bind(id).execute(&s.pool).await?.rows_affected();
    if n == 0 {
        return Err(AppError::Conflict("El lote ya no se puede cancelar".into()));
    }
    Ok(Json(json!({"cancelled":true})))
}

#[derive(Deserialize)]
pub struct EnrichmentBody {
    pub unidad_base_id: Option<i32>,
    pub action: String,
    pub reason: Option<String>,
}
pub async fn enrichment_queue(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(x) FROM (SELECT p.id,p.codigo_interno,p.nombre,p.unidad_base_id,p.estado_catalogo,p.motivo_rechazo,r.inventory_ready,r.missing_fields FROM productos p JOIN product_readiness r ON r.producto_id=p.id WHERE p.estado_catalogo<>'aprobado' ORDER BY p.created_at DESC)x").fetch_all(&s.pool).await?;
    Ok(Json(json!(rows)))
}
pub async fn enrich(
    State(s): State<AppState>,
    Extension(c): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(b): Json<EnrichmentBody>,
) -> Result<Json<Value>, AppError> {
    admin(&c).await?;
    let mut tx = s.pool.begin().await?;
    if let Some(unit) = b.unidad_base_id {
        sqlx::query("UPDATE productos SET unidad_base_id=$2,updated_at=now() WHERE id=$1")
            .bind(id)
            .bind(unit)
            .execute(&mut *tx)
            .await?;
    }
    let ready: bool = sqlx::query_scalar(
        "SELECT activo AND unidad_base_id IS NOT NULL FROM productos WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    match b.action.as_str() {
        "recalculate" => {
            sqlx::query("UPDATE productos SET estado_catalogo=CASE WHEN unidad_base_id IS NULL THEN 'incompleto' ELSE 'pendiente_aprobacion' END,motivo_rechazo=NULL WHERE id=$1").bind(id).execute(&mut *tx).await?;
        }
        "approve" if ready => {
            sqlx::query(
                "UPDATE productos SET estado_catalogo='aprobado',motivo_rechazo=NULL WHERE id=$1",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        "approve" => {
            return Err(AppError::BusinessLogic(
                "El producto todavía no tiene unidad de medida".into(),
                "PRODUCT_NOT_READY".into(),
            ));
        }
        "reject" => {
            let reason = b
                .reason
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| AppError::Validation("El rechazo requiere un motivo".into()))?;
            sqlx::query(
                "UPDATE productos SET estado_catalogo='rechazado',motivo_rechazo=$2 WHERE id=$1",
            )
            .bind(id)
            .bind(reason)
            .execute(&mut *tx)
            .await?;
        }
        _ => return Err(AppError::Validation("Acción inválida".into())),
    };
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}

pub fn child_routes() -> Router<AppState> {
    Router::new()
        .route("/{id}", get(get_one))
        .route("/{id}/validate", post(validate))
        .route("/{id}/transforms/preview", post(transform_preview))
        .route("/{id}/transforms/apply", post(transform_apply))
        .route("/{id}/commit", post(commit))
        .route("/{id}/cancel", post(cancel))
        .route("/{id}/rollback", post(rollback))
        .route("/{id}/downloads/{kind}", get(download))
        .route("/enrichment", get(enrichment_queue))
        .route("/enrichment/{id}", post(enrich))
}
