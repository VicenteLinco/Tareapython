mod common;

use axum::http::StatusCode;
use sqlx::PgPool;

// Characterization tests del módulo de configuración. Fijan el contrato actual
// (envelope, enmascarado de secretos, RBAC, branding público, verificar-pin)
// ANTES de mover el SQL a `configuracion_service`. Si el refactor es fiel,
// siguen pasando sin cambios.

/// GET /api/v1/configuracion — devuelve los campos esperados con sus defaults
/// cuando la tabla `configuracion` está vacía.
#[sqlx::test(migrations = "./migrations")]
async fn test_obtener_configuracion_defaults(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, json) = common::get_json(&app, "/api/v1/configuracion", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    assert_eq!(
        json["nombre_laboratorio"].as_str(),
        Some("Laboratorio Clínico")
    );
    assert_eq!(json["moneda_codigo"].as_str(), Some("CLP"));
    assert_eq!(json["moneda_simbolo"].as_str(), Some("$"));
    assert_eq!(json["dias_autonomia_objetivo"].as_i64(), Some(15));
    assert_eq!(json["lead_time_default"].as_i64(), Some(3));
    assert_eq!(json["conteo_ciego"].as_bool(), Some(false));
    assert_eq!(json["ia_proveedor"].as_str(), Some("gemini"));
    // Sin secretos seteados, las keys vienen vacías (no enmascaradas).
    assert_eq!(json["ia_api_key"].as_str(), Some(""));
}

/// PUT /api/v1/configuracion — un cambio se persiste y se refleja en el GET.
#[sqlx::test(migrations = "./migrations")]
async fn test_actualizar_configuracion_persiste(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "nombre_laboratorio": "Lab Central de Pruebas",
            "dias_autonomia_objetivo": 21
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, json) = common::get_json(&app, "/api/v1/configuracion", &token).await;
    assert_eq!(
        json["nombre_laboratorio"].as_str(),
        Some("Lab Central de Pruebas")
    );
    assert_eq!(json["dias_autonomia_objetivo"].as_i64(), Some(21));
}

/// PUT con una API key la persiste, pero el GET la devuelve enmascarada (`***`).
/// Esta es la regla de seguridad del módulo: nunca exponer secretos.
#[sqlx::test(migrations = "./migrations")]
async fn test_secretos_se_enmascaran(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({ "ia_api_key": "super-secret-key-123" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, json) = common::get_json(&app, "/api/v1/configuracion", &token).await;
    assert_eq!(
        json["ia_api_key"].as_str(),
        Some("***"),
        "una API key seteada debe devolverse enmascarada"
    );
}

/// Enviar `***` como API key NO sobrescribe el valor real (es el placeholder
/// que el GET devolvió; reenviarlo es un no-op).
#[sqlx::test(migrations = "./migrations")]
async fn test_enviar_placeholder_no_borra_secreto(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Setea un secreto real
    common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({ "ia_api_key": "real-key" }),
    )
    .await;

    // Reenvía el placeholder
    common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({ "ia_api_key": "***" }),
    )
    .await;

    // El valor real sigue ahí (en DB)
    let valor: String =
        sqlx::query_scalar("SELECT valor_texto FROM configuracion WHERE clave = 'ia_api_key'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        valor, "real-key",
        "el placeholder *** no debe sobrescribir el secreto"
    );
}

/// PUT /api/v1/configuracion — un no-admin recibe 403.
#[sqlx::test(migrations = "./migrations")]
async fn test_actualizar_requiere_admin(pool: PgPool) {
    let token = common::create_tecnologo_token(&pool, &[1]).await;
    let app = common::test_app(pool.clone());

    let (status, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({ "nombre_laboratorio": "Hackeado" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "solo admin puede actualizar configuración"
    );
}

/// GET /api/v1/branding — endpoint público: nombre del laboratorio + imagen de
/// login, sin secretos.
#[sqlx::test(migrations = "./migrations")]
async fn test_branding_publico(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, json) = common::get_json(&app, "/api/v1/branding", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    assert!(json["nombre_laboratorio"].is_string());
    assert!(json["login_imagen_base64"].is_string());
    // El branding NO debe filtrar secretos
    assert!(json.get("ia_api_key").is_none());
    assert!(json.get("whatsapp_api_key").is_none());
}

/// POST /api/v1/configuracion/verificar-pin — sin PIN configurado, cualquier
/// valor es válido (estado de setup inicial).
#[sqlx::test(migrations = "./migrations")]
async fn test_verificar_pin_sin_pin_configurado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, json) = common::post_json(
        &app,
        "/api/v1/configuracion/verificar-pin",
        &token,
        serde_json::json!({ "pin": "0000" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["valido"].as_bool(), Some(true));
}

/// Con un PIN configurado, verificar-pin compara correctamente.
#[sqlx::test(migrations = "./migrations")]
async fn test_verificar_pin_con_pin_configurado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({ "pin_kiosko": "4321" }),
    )
    .await;

    let (_, ok) = common::post_json(
        &app,
        "/api/v1/configuracion/verificar-pin",
        &token,
        serde_json::json!({ "pin": "4321" }),
    )
    .await;
    assert_eq!(ok["valido"].as_bool(), Some(true));

    let (_, bad) = common::post_json(
        &app,
        "/api/v1/configuracion/verificar-pin",
        &token,
        serde_json::json!({ "pin": "9999" }),
    )
    .await;
    assert_eq!(bad["valido"].as_bool(), Some(false));
}

/// GET /api/v1/configuracion — devuelve vencimiento defaults
#[sqlx::test(migrations = "./migrations")]
async fn test_vencimiento_configuracion_defaults(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, json) = common::get_json(&app, "/api/v1/configuracion", &token).await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(json["vencimiento_alerta_activa"].as_bool(), Some(true));
    assert_eq!(json["vencimiento_vida_util_minima_dias"].as_i64(), Some(30));
    assert_eq!(json["vencimiento_margen_tolerancia_pct"].as_i64(), Some(10));
}

/// PUT /api/v1/configuracion — permite valores válidos
#[sqlx::test(migrations = "./migrations")]
async fn test_actualizar_vencimiento_valores_validos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "vencimiento_alerta_activa": false,
            "vencimiento_vida_util_minima_dias": 45,
            "vencimiento_margen_tolerancia_pct": 15
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, json) = common::get_json(&app, "/api/v1/configuracion", &token).await;
    assert_eq!(json["vencimiento_alerta_activa"].as_bool(), Some(false));
    assert_eq!(json["vencimiento_vida_util_minima_dias"].as_i64(), Some(45));
    assert_eq!(json["vencimiento_margen_tolerancia_pct"].as_i64(), Some(15));
}

/// PUT /api/v1/configuracion — valida restricciones de valor
#[sqlx::test(migrations = "./migrations")]
async fn test_actualizar_vencimiento_valores_invalidos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Margen tolerancia > 100
    let (status1, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "vencimiento_margen_tolerancia_pct": 101
        }),
    )
    .await;
    assert_eq!(status1, StatusCode::UNPROCESSABLE_ENTITY);

    // 2. Margen tolerancia < 0
    let (status2, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "vencimiento_margen_tolerancia_pct": -5
        }),
    )
    .await;
    assert_eq!(status2, StatusCode::UNPROCESSABLE_ENTITY);

    // 3. Vida útil < 0
    let (status3, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "vencimiento_vida_util_minima_dias": -10
        }),
    )
    .await;
    assert_eq!(status3, StatusCode::UNPROCESSABLE_ENTITY);
}

/// PUT /api/v1/configuracion — valida restricciones de valores de forecast/demanda
#[sqlx::test(migrations = "./migrations")]
async fn test_actualizar_forecast_valores_invalidos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. ventana_consumo_dias < 14 (debe ser >= 14)
    let (status1, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "ventana_consumo_dias": 10
        }),
    )
    .await;
    assert_eq!(status1, StatusCode::UNPROCESSABLE_ENTITY);

    // 2. factor_historial_corto > 1.0 (debe estar en [0.0, 1.0])
    let (status2, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "factor_historial_corto": 1.5
        }),
    )
    .await;
    assert_eq!(status2, StatusCode::UNPROCESSABLE_ENTITY);

    // 3. factor_historial_corto < 0.0 (debe estar en [0.0, 1.0])
    let (status3, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "factor_historial_corto": -0.5
        }),
    )
    .await;
    assert_eq!(status3, StatusCode::UNPROCESSABLE_ENTITY);

    // 4. periodo_revision_dias < 1 (debe ser >= 1)
    let (status4, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "periodo_revision_dias": 0
        }),
    )
    .await;
    assert_eq!(status4, StatusCode::UNPROCESSABLE_ENTITY);
}

/// PUT /api/v1/configuracion — permite valores válidos de forecast/demanda y los mapea correctamente
#[sqlx::test(migrations = "./migrations")]
async fn test_actualizar_forecast_valores_validos_y_mapeo(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Actualizar con valores válidos
    let (status, _) = common::put_json(
        &app,
        "/api/v1/configuracion",
        &token,
        serde_json::json!({
            "ventana_consumo_dias": 20,
            "factor_historial_corto": 0.5,
            "periodo_revision_dias": 15
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Obtener y verificar que retorne correctamente
    let (_, json) = common::get_json(&app, "/api/v1/configuracion", &token).await;
    assert_eq!(json["ventana_consumo_dias"].as_i64(), Some(20));
    assert_eq!(json["factor_historial_corto"].as_f64(), Some(0.5));
    assert_eq!(json["periodo_revision_dias"].as_i64(), Some(15));

    // Verificar en base de datos que se haya mapeado "ventana_consumo_dias" a "ventana_demanda_dias"
    let valor_ventana: String = sqlx::query_scalar(
        "SELECT valor_texto FROM configuracion WHERE clave = 'ventana_demanda_dias'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(valor_ventana, "20");
}
