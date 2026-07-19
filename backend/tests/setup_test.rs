mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_persists_typed_product_custom_fields(pool: PgPool) {
    let definition_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO lab_campo_definicion (nombre, tipo_dato, alcance, activo) \
         VALUES ('Número de registro', 'entero', 'producto', true) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let key = format!("lab_{definition_id}");
    let result = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        b"nombre,registro\nReactivo personalizado,42\n",
        inventario_lab_backend::services::setup_service::ImportConfig {
            mapping: [("nombre".into(), "nombre".into()), (key, "registro".into())]
                .into_iter()
                .collect(),
            required_fields: vec![],
            dry_run: false,
        },
    )
    .await
    .unwrap();

    assert!(result.valido);
    let value: i32 = sqlx::query_scalar(
        "SELECT v.valor_entero FROM lab_campo_producto_valor v \
         JOIN productos p ON p.id = v.producto_id \
         WHERE p.nombre = 'Reactivo personalizado' AND v.definicion_id = $1",
    )
    .bind(definition_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(value, 42);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_rejects_invalid_product_custom_values_atomically(pool: PgPool) {
    let definition_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO lab_campo_definicion (nombre, tipo_dato, alcance, activo) \
         VALUES ('Fecha sanitaria', 'fecha', 'producto', true) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let result = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        b"nombre [tipo=texto; requerido=si],lab_fecha [nombre=Fecha sanitaria; tipo=fecha; requerido=no]\nReactivo invalido,19/07/2026\n",
        inventario_lab_backend::services::setup_service::ImportConfig {
            mapping: [
                ("nombre".into(), "nombre [tipo=texto; requerido=si]".into()),
                (
                    format!("lab_{definition_id}"),
                    "lab_fecha [nombre=Fecha sanitaria; tipo=fecha; requerido=no]".into(),
                ),
            ]
            .into_iter()
            .collect(),
            required_fields: vec![],
            dry_run: false,
        },
    )
    .await
    .unwrap();

    assert!(!result.valido);
    assert_eq!(result.importados, 0);
    assert_eq!(
        result.errores[0].codigo.as_deref(),
        Some("INVALID_CUSTOM_DATE")
    );
    assert_eq!(
        result.errores[0].campo.as_deref(),
        Some(format!("lab_{definition_id}").as_str())
    );
    assert!(result.errores[0].mensaje.contains("Fecha sanitaria"));
    assert!(
        result.errores[0]
            .mensaje
            .contains("tipo fecha (AAAA-MM-DD)")
    );
    assert!(result.errores[0].mensaje.contains("19/07/2026"));
    let persisted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM productos WHERE nombre = 'Reactivo invalido')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!persisted);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_custom_list_error_names_type_received_value_and_valid_options(pool: PgPool) {
    let definition_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO lab_campo_definicion (nombre, tipo_dato, opciones_lista, alcance, activo) \
         VALUES ('Clasificación sanitaria', 'lista', '[\"A\", \"B\"]', 'producto', true) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let key = format!("lab_{definition_id}");
    let result = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        b"nombre [tipo=texto; requerido=si],clasificacion [tipo=lista; opciones=A|B]\nReactivo lista,C\n",
        inventario_lab_backend::services::setup_service::ImportConfig {
            mapping: [
                ("nombre".into(), "nombre [tipo=texto; requerido=si]".into()),
                (key.clone(), "clasificacion [tipo=lista; opciones=A|B]".into()),
            ]
            .into_iter()
            .collect(),
            required_fields: vec![],
            dry_run: true,
        },
    )
    .await
    .unwrap();

    assert!(!result.valido);
    let error = &result.errores[0];
    assert_eq!(error.campo.as_deref(), Some(key.as_str()));
    assert_eq!(error.codigo.as_deref(), Some("INVALID_CUSTOM_OPTION"));
    assert!(error.mensaje.contains("Clasificación sanitaria"));
    assert!(error.mensaje.contains("tipo lista"));
    assert!(error.mensaje.contains("valor recibido: 'C'"));
    assert!(error.mensaje.contains("opciones válidas: A, B"));
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_reports_required_custom_field_only_once(pool: PgPool) {
    let definition_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO lab_campo_definicion (nombre, tipo_dato, alcance, requerido, activo) \
         VALUES ('Registro obligatorio', 'texto', 'producto', true, true) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let key = format!("lab_{definition_id}");
    let result = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        b"nombre,registro\nReactivo sin registro,\n",
        inventario_lab_backend::services::setup_service::ImportConfig {
            mapping: [
                ("nombre".into(), "nombre".into()),
                (key.clone(), "registro".into()),
            ]
            .into_iter()
            .collect(),
            required_fields: vec![key.clone()],
            dry_run: true,
        },
    )
    .await
    .unwrap();

    let matching: Vec<_> = result
        .errores
        .iter()
        .filter(|error| error.campo.as_deref() == Some(key.as_str()))
        .collect();
    assert_eq!(matching.len(), 1, "{:?}", result.errores);
    assert_eq!(matching[0].codigo.as_deref(), Some("REQUIRED_CUSTOM_FIELD"));
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_estado_inicial(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/setup/estado", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["carga_inicial_completada"], false);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_importar_productos_csv(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let csv_content = "\
nombre,desc,unidad,minimo
Glucosa Oxidasa,Reactivo para glucosa,unidad,500
Hemoglobina A1c,Kit HbA1c,unidad,100
Buffer pH 7.0,Buffer de calibración,unidad,1000
";

    let config = serde_json::json!({
        "mapping": {
            "nombre": "nombre",
            "descripcion": "desc",
            "unidad": "unidad",
            "stock_minimo": "minimo"
        },
        "required_fields": [],
        "dry_run": false
    });

    let boundary = "----TestBoundary";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        config_json = config,
        csv_content = csv_content,
        boundary = boundary
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!({}));

    assert_eq!(
        status,
        StatusCode::OK,
        "Status should be 200, got body: {:?}",
        json
    );
    assert_eq!(json["importados"].as_u64().unwrap(), 3);
    assert_eq!(json["errores"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_accepts_name_only_and_blank_optional_columns(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let csv_content = "nombre,unidad,minimo\nReactivo solo nombre,,\n";
    let dry_run = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        csv_content.as_bytes(),
        inventario_lab_backend::services::setup_service::ImportConfig {
            mapping: [
                ("nombre".to_string(), "nombre".to_string()),
                ("unidad".to_string(), "unidad".to_string()),
                ("stock_minimo".to_string(), "minimo".to_string()),
            ]
            .into(),
            required_fields: vec![],
            dry_run: true,
        },
    )
    .await
    .unwrap();
    assert!(dry_run.valido, "{dry_run:?}");
    assert_eq!(dry_run.preview[0]["unidad_base"], "");
    let before_commit: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM productos WHERE nombre = 'Reactivo solo nombre'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(before_commit, 0, "dry-run must not persist products");

    let config = serde_json::json!({
        "mapping": {
            "nombre": "nombre",
            "unidad": "unidad",
            "stock_minimo": "minimo"
        },
        "dry_run": false
    });
    let boundary = "----NameOnlyBoundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"config\"\r\n\r\n{config}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\nContent-Type: text/csv\r\n\r\n{csv_content}\r\n--{boundary}--\r\n"
    );
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {token}"))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["importados"], 1);
    assert!(json["errores"].as_array().unwrap().is_empty(), "{json:?}");

    let stored_unit: Option<i32> = sqlx::query_scalar(
        "SELECT unidad_base_id FROM productos WHERE nombre = 'Reactivo solo nombre'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_unit, None);
    let presentations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM presentaciones pr JOIN productos p ON p.id = pr.producto_id WHERE p.nombre = 'Reactivo solo nombre'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        presentations, 0,
        "name-only import must not invent a unit presentation"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_without_unit_preserves_independent_data_and_warns_for_commercial_data(
    pool: PgPool,
) {
    let csv = "nombre,unidad,proveedor,codigo,precio,contenido\n\
Proveedor sin unidad,,Proveedor Uno,,,\n\
Codigo sin unidad,,,SKU-2,,\n\
Precio sin unidad,,,,12.50,\n\
Contenido sin unidad,,,,,24\n\
Comercial mixto,,Proveedor Mixto,SKU-5,99.90,50\n";
    let config = || inventario_lab_backend::services::setup_service::ImportConfig {
        mapping: [
            ("nombre".to_string(), "nombre".to_string()),
            ("unidad".to_string(), "unidad".to_string()),
            ("proveedor".to_string(), "proveedor".to_string()),
            ("codigo_proveedor".to_string(), "codigo".to_string()),
            ("precio_unitario".to_string(), "precio".to_string()),
            ("contenido".to_string(), "contenido".to_string()),
        ]
        .into(),
        required_fields: vec![],
        dry_run: true,
    };

    let dry_run = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        csv.as_bytes(),
        config(),
    )
    .await
    .unwrap();
    assert!(
        dry_run.valido,
        "warnings must not invalidate valid rows: {dry_run:?}"
    );
    assert_eq!(dry_run.advertencias.len(), 5, "{dry_run:?}");

    let mut commit_config = config();
    commit_config.dry_run = false;
    let committed = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        csv.as_bytes(),
        commit_config,
    )
    .await
    .unwrap();
    assert_eq!(committed.importados, 5);
    assert_eq!(committed.advertencias.len(), dry_run.advertencias.len());
    assert_eq!(
        committed
            .advertencias
            .iter()
            .map(|warning| (&warning.fila, &warning.mensaje))
            .collect::<Vec<_>>(),
        dry_run
            .advertencias
            .iter()
            .map(|warning| (&warning.fila, &warning.mensaje))
            .collect::<Vec<_>>()
    );

    let empty_presentations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM presentaciones WHERE btrim(nombre) = '' OR btrim(nombre_plural) = ''",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(empty_presentations, 0);
    let presentations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM presentaciones")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        presentations, 0,
        "no presentation may be invented without a unit"
    );
    let providers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM proveedores WHERE nombre IN ('Proveedor Uno', 'Proveedor Mixto')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        providers, 0,
        "unitless commercial rows must not create orphan providers"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_finalizar_y_bloquear(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Finalizar
    let (status, json) = common::post_json(
        &app,
        "/api/v1/setup/finalizar",
        &token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["mensaje"], "Configuración finalizada");

    // Verificar que ya no se puede importar
    let config = serde_json::json!({
        "mapping": { "nombre": "nombre" },
        "dry_run": false
    });
    let boundary = "----Bound";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"test.csv\"\r\n\r\n\
         nombre\nTest\r\n\
         --{boundary}--\r\n",
        config_json = config,
        boundary = boundary
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_importar_stock_csv(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Importar productos primero
    let csv_productos = "\
nombre,desc,unidad,minimo
Glucosa Oxidasa,Reactivo para glucosa,unidad,500
";
    let config_productos = serde_json::json!({
        "mapping": {
            "nombre": "nombre",
            "descripcion": "desc",
            "unidad": "unidad",
            "stock_minimo": "minimo"
        },
        "dry_run": false
    });
    let boundary = "----TestBoundary";
    let body_productos = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        config_json = config_productos,
        csv_content = csv_productos,
        boundary = boundary
    );
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_productos))
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 2. Importar stock para ese producto
    let csv_stock = "\
producto,lote,vencimiento,area,cantidad,costo
Glucosa Oxidasa,LOT-1234,2026-12-31,Laboratorio Central,50,1500
";
    let body_stock = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"stock.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        csv_content = csv_stock,
        boundary = boundary
    );
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-stock")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_stock))
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response_json: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(response_json["importados"], 0);
    assert_eq!(response_json["errores"], 1);
    assert!(response_json.to_string().contains("PRODUCT_NOT_READY"));

    // 3. Verificar que se cargó el stock en la tabla stock
    let stock_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock WHERE cantidad > 0")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stock_count, 0, "non-ready products must be quarantined");

    // 4. Verificar que stock_snapshot tiene la misma cantidad (CQRS / global)
    let snapshot_stock: Option<rust_decimal::Decimal> =
        sqlx::query_scalar("SELECT stock_actual FROM stock_snapshot")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(snapshot_stock, None);

    // 5. Verificar que se registraron movimientos y que el balance es sano
    let (bc_status, bc_json) = common::get_json(&app, "/api/v1/stock/balance-check", &token).await;
    assert_eq!(bc_status, StatusCode::OK);
    assert_eq!(bc_json["sano"], true);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_import_rejects_malformed_optional_numbers_atomically(pool: PgPool) {
    let csv = "nombre,unidad,uso,dias,precio,contenido,minimo\nProducto válido,unidad,12,30,10.5,2,3\nProducto inválido,unidad,no-numero,treinta,barato,0,abc\n";
    let mapping = [
        ("nombre", "nombre"),
        ("unidad", "unidad"),
        ("promedio_uso_mensual_inicial", "uso"),
        ("dias_estabilidad_abierto", "dias"),
        ("precio_unitario", "precio"),
        ("contenido", "contenido"),
        ("stock_minimo", "minimo"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let result = inventario_lab_backend::services::setup_service::importar_catalogo(
        &pool,
        csv.as_bytes(),
        inventario_lab_backend::services::setup_service::ImportConfig {
            mapping,
            required_fields: vec![],
            dry_run: false,
        },
    )
    .await
    .unwrap();
    assert!(!result.valido, "{result:?}");
    assert_eq!(result.importados, 0, "invalid files must be atomic");
    let codes = result
        .errores
        .iter()
        .filter_map(|e| e.codigo.as_deref())
        .collect::<Vec<_>>();
    assert!(
        codes.iter().filter(|&&c| c == "INVALID_NUMBER").count() >= 3,
        "{result:?}"
    );
    assert!(codes.contains(&"INVALID_INTEGER"), "{result:?}");
    assert!(codes.contains(&"NON_POSITIVE_FACTOR"), "{result:?}");
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM productos WHERE nombre LIKE 'Producto %'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_stock_import_quarantines_products_not_ready_without_trigger_error(pool: PgPool) {
    let product_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO productos (codigo_interno, nombre, estado_catalogo) VALUES ('NOT-READY', 'Producto pendiente', 'incompleto') RETURNING id"
    ).fetch_one(&pool).await.unwrap();
    let admin_id = common::get_admin_id(&pool).await;

    let csv = "producto,lote,vencimiento,area,cantidad,costo\nProducto pendiente,L-1,2027-01-01,Central,4,10\n";
    let result = inventario_lab_backend::services::setup_service::importar_inventario(
        &pool,
        csv.as_bytes(),
        admin_id,
    )
    .await
    .unwrap();

    assert_eq!(result["importados"], 0);
    assert_eq!(result["errores"], 1);
    assert!(result.to_string().contains("PRODUCT_NOT_READY"));
    let lots: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lotes WHERE producto_id = $1")
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(lots, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn unitless_product_is_searchable_but_rejects_unit_dependent_operations(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let product_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ('UNIT-LESS', 'Producto sin unidad buscable', NULL) RETURNING id"
    ).fetch_one(&pool).await.unwrap();
    let app = common::test_app(pool.clone());
    let (status, json) = common::get_json(
        &app,
        "/api/v1/productos?search=sin%20unidad%20buscable",
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(
        json.to_string().contains("Producto sin unidad buscable"),
        "{json:?}"
    );

    let admin_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM usuarios WHERE email = 'admin.fixture@laboratorio.test'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let err = inventario_lab_backend::services::presentacion_service::PresentacionService::crear(
        &pool,
        product_id,
        inventario_lab_backend::services::presentacion_service::CrearPresentacionParams {
            nombre: "Caja".into(),
            nombre_plural: "Cajas".into(),
            factor_conversion: rust_decimal::Decimal::ONE,
            codigo_barras: None,
            gtin: None,
            gs1_habilitado: None,
            sku: None,
        },
        admin_id,
    )
    .await
    .unwrap_err();
    assert!(
        err.to_string().contains("no tiene unidad de medida"),
        "{err:?}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn real_csv_fixtures_round_trip_through_multipart_api(pool: PgPool) {
    async fn upload(
        pool: PgPool,
        token: &str,
        csv: &'static str,
        dry_run: bool,
    ) -> serde_json::Value {
        let app = common::test_app(pool);
        let config = serde_json::json!({
            "mapping": {
                "nombre":"nombre", "unidad":"unidad", "proveedor":"proveedor",
                "codigo_proveedor":"codigo_proveedor", "precio_unitario":"precio_unitario",
                "contenido":"contenido", "promedio_uso_mensual_inicial":"promedio_uso_mensual_inicial",
                "dias_estabilidad_abierto":"dias_estabilidad_abierto", "stock_minimo":"stock_minimo"
            }, "required_fields": [], "dry_run": dry_run
        });
        let boundary = "----RepositoryFixtureBoundary";
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"config\"\r\n\r\n{config}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fixture.csv\"\r\nContent-Type: text/csv\r\n\r\n{csv}\r\n--{boundary}--\r\n"
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/setup/importar-productos")
                    .header("Authorization", format!("Bearer {token}"))
                    .header(
                        "Content-Type",
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(status, StatusCode::OK, "{json:?}");
        json
    }

    let token = common::admin_access_token(&pool).await;
    let valid = include_str!("fixtures/product_import_valid.csv");
    let dry = upload(pool.clone(), &token, valid, true).await;
    assert_eq!(dry["total_filas"], 4);
    assert_eq!(dry["advertencias"].as_array().unwrap().len(), 1, "{dry:?}");
    assert_eq!(dry["preview"][0]["unidad_base"], "");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM productos")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let committed = upload(pool.clone(), &token, valid, false).await;
    assert_eq!(committed["importados"], 4, "{committed:?}");
    let products: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM productos WHERE nombre IN ('Solo nombre','Opcionales vacíos','Reactivo completo','Comercial sin unidad')").fetch_one(&pool).await.unwrap();
    assert_eq!(products, 4);
    let null_units: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM productos WHERE nombre IN ('Solo nombre','Opcionales vacíos','Comercial sin unidad') AND unidad_base_id IS NULL").fetch_one(&pool).await.unwrap();
    assert_eq!(null_units, 3);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM presentaciones")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM ofertas_proveedor")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM proveedores WHERE nombre = 'Proveedor Omitido'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    let invalid = include_str!("fixtures/product_import_invalid.csv");
    let rejected = upload(pool.clone(), &token, invalid, false).await;
    assert_eq!(rejected["importados"], 0, "{rejected:?}");
    assert!(!rejected["valido"].as_bool().unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM productos WHERE nombre = 'Fila válida'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}
