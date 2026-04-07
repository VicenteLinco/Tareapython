use uuid::Uuid;
use rust_decimal::Decimal;
use inventario_lab_backend::services::{area_service, recepcion_service, descarte_service};
use inventario_lab_backend::dto::{
    area::CreateArea,
    recepcion::{CreateRecepcion, DetalleRecepcionInput},
    descarte::{DescarteRequest, DescarteItem},
};

mod common;

#[sqlx::test]
async fn test_integridad_stock_y_servicios_refactorizados(pool: sqlx::PgPool) {
    let admin_id = common::get_admin_id(&pool).await;

    // 1. Crear Área
    let area = area_service::crear(&pool, CreateArea {
        nombre: format!("Area Test {}", Uuid::new_v4()),
        es_bodega: Some(true),
    }, admin_id).await.expect("Error al crear área");

    // 2. Crear Catálogos Base para el test
    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ($1) RETURNING id"
    ).bind(format!("Cat {}", Uuid::new_v4())).fetch_one(&pool).await.unwrap();

    let unidad_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad', 'Unidades') RETURNING id"
    ).fetch_one(&pool).await.unwrap();

    let proveedor_id: i32 = sqlx::query_scalar(
        "INSERT INTO proveedores (nombre) VALUES ('Prov Test') RETURNING id"
    ).fetch_one(&pool).await.unwrap();

    let producto_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO productos (id, codigo_interno, nombre, categoria_id, unidad_base_id, proveedor_id, stock_minimo) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        producto_id,
        format!("TEST-{}", Uuid::new_v4().to_string()[..8].to_string()),
        "Producto Test Refactor",
        categoria_id,
        unidad_id,
        proveedor_id,
        Decimal::from(10)
    ).execute(&pool).await.unwrap();

    // 3. Realizar Recepción (Ingreso de Stock)
    let fecha = chrono::Utc::now();
    let num_lote = format!("LOTE-{}", Uuid::new_v4().to_string()[..8].to_string());
    
    let req_recepcion = CreateRecepcion {
        proveedor_id,
        guia_despacho: Some("GUIA-TEST".into()),
        estado: Some("completa".into()),
        fecha_recepcion: fecha,
        nota: None,
        solicitud_id: None,
        detalle: vec![DetalleRecepcionInput {
            producto_id,
            numero_lote: num_lote.clone(),
            fecha_vencimiento: fecha.date_naive() + chrono::Days::new(365),
            presentacion_id: None,
            cantidad_presentaciones: Decimal::from(100),
            area_destino_id: area.id,
            costo_unitario: Some(Decimal::from(50)),
            precio_unitario: None,
        }],
    };

    recepcion_service::crear_recepcion(&pool, req_recepcion, admin_id)
        .await.expect("Error al crear recepción");

    // VERIFICACIÓN 1: El stock debe ser 100 en la tabla stock (gracias al trigger)
    let stock_actual: Decimal = sqlx::query_scalar(
        "SELECT cantidad FROM stock WHERE area_id = $1 AND lote_id IN (SELECT id FROM lotes WHERE producto_id = $2)"
    )
    .bind(area.id)
    .bind(producto_id)
    .fetch_one(&pool).await.expect("No se encontró registro de stock");

    assert_eq!(stock_actual, Decimal::from(100), "El stock inicial debería ser 100");

    // 4. Realizar Descarte (Salida de Stock)
    let lote_id = sqlx::query_scalar!(
        "SELECT id FROM lotes WHERE producto_id = $1 AND numero_lote = $2",
        producto_id, num_lote
    ).fetch_one(&pool).await.unwrap();

    let req_descarte = DescarteRequest {
        items: vec![DescarteItem {
            lote_id,
            area_id: area.id,
            cantidad: Decimal::from(30),
            tipo: "DESCARTE_DAÑADO".into(),
            nota: Some("Test de descarte".into()),
        }],
    };

    descarte_service::procesar_descartes(&pool, req_descarte, admin_id, "admin")
        .await.expect("Error al procesar descarte");

    // VERIFICACIÓN 2: El stock debe ser 70 (100 - 30)
    let stock_final: Decimal = sqlx::query_scalar(
        "SELECT cantidad FROM stock WHERE area_id = $1 AND lote_id = $2"
    )
    .bind(area.id)
    .bind(lote_id)
    .fetch_one(&pool).await.unwrap();

    assert_eq!(stock_final, Decimal::from(70), "El stock final debería ser 70 tras el descarte");

    // VERIFICACIÓN 3: La tabla movimientos debe tener la cantidad_resultante correcta calculada por el trigger
    let ultimo_mov_resultante: Decimal = sqlx::query_scalar(
        "SELECT cantidad_resultante FROM movimientos WHERE lote_id = $1 AND tipo = 'DESCARTE_DAÑADO' ORDER BY created_at DESC LIMIT 1"
    )
    .bind(lote_id)
    .fetch_one(&pool).await.unwrap();

    assert_eq!(ultimo_mov_resultante, Decimal::from(70), "La cantidad resultante en movimientos debe ser 70");

    println!("✅ Test de integridad de stock y servicios completado con éxito.");
}
