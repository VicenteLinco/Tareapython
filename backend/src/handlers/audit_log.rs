use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::{PaginatedResponse, PaginationParams};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
struct AuditQuery {
    tabla: Option<String>,
    registro_id: Option<String>,
    usuario_id: Option<Uuid>,
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AuditLogItem {
    id: i64,
    tabla: String,
    registro_id: String,
    accion: String,
    datos_anteriores: Option<serde_json::Value>,
    datos_nuevos: Option<serde_json::Value>,
    usuario_nombre: String,
    created_at: DateTime<Utc>,
}

async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<AuditQuery>,
) -> Result<Json<PaginatedResponse<AuditLogItem>>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions: Vec<String> = vec!["TRUE".to_string()];
    let mut param_idx = 0u32;

    if params.tabla.is_some() {
        param_idx += 1;
        conditions.push(format!("al.tabla = ${}", param_idx));
    }
    if params.registro_id.is_some() {
        param_idx += 1;
        conditions.push(format!("al.registro_id = ${}", param_idx));
    }
    if params.usuario_id.is_some() {
        param_idx += 1;
        conditions.push(format!("al.usuario_id = ${}", param_idx));
    }
    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("al.created_at >= ${}::date", param_idx));
    }
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "al.created_at < ${}::date + INTERVAL '1 day'",
            param_idx
        ));
    }

    let where_clause = conditions.join(" AND ");

    let count_sql = format!("SELECT COUNT(*) FROM audit_log al WHERE {}", where_clause);
    let data_sql = format!(
        r#"SELECT al.id, al.tabla, al.registro_id, al.accion,
                  al.datos_anteriores, al.datos_nuevos,
                  u.nombre as usuario_nombre, al.created_at
           FROM audit_log al
           JOIN usuarios u ON u.id = al.usuario_id
           WHERE {}
           ORDER BY al.created_at DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        param_idx + 1,
        param_idx + 2,
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
    let mut data_query = sqlx::query_as::<_, AuditLogItem>(&data_sql);

    if let Some(v) = &params.tabla {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = &params.registro_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.usuario_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.desde {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.hasta {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }

    data_query = data_query.bind(limit).bind(offset);

    let total = count_query.fetch_one(&state.pool).await?;
    let data = data_query.fetch_all(&state.pool).await?;

    Ok(Json(PaginatedResponse::new(
        data,
        total,
        pagination.page(),
        limit,
    )))
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(listar))
}
