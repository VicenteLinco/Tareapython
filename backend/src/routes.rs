use axum::Router;
use axum::middleware;
use axum::routing::{get, post};
use tower_http::services::ServeDir;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::auth::middleware::require_auth;
use crate::db::AppState;
use crate::handlers;

#[derive(OpenApi)]
#[openapi(
    paths(
        handlers::auth_handler::login,
    ),
    components(
        schemas(
            crate::auth::models::LoginRequest,
            crate::auth::models::LoginResponse,
        )
    ),
    tags(
        (name = "auth", description = "Autenticación de usuarios")
    )
)]
struct ApiDoc;

pub fn create_routes(state: AppState) -> Router<AppState> {
    let enable_swagger = state.config.enable_swagger;
    // Auth protegido (bajo /api/v1/auth)
    let auth_protected = Router::new()
        .merge(handlers::auth_handler::protected_routes())
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // Resto de rutas protegidas (bajo /api/v1)
    let protected = Router::new()
        // Catálogos
        .nest("/categorias", handlers::categorias::routes())
        .nest("/unidades-basicas", handlers::unidades_basicas::routes())
        .nest("/areas", handlers::areas::routes())
        .nest("/proveedores", handlers::proveedores::routes())
        // Usuarios
        .nest("/usuarios", handlers::usuarios::routes())
        // Productos y presentaciones
        .nest("/productos", handlers::productos::routes())
        .nest(
            "/productos/{producto_id}/presentaciones",
            handlers::presentaciones::nested_routes(),
        )
        .nest("/presentaciones", handlers::presentaciones::direct_routes())
        // Par level endpoints — per-product global par levels
        .route(
            "/productos/{id}/par-level",
            get(handlers::par_levels::get_par_level).put(handlers::par_levels::upsert_par_level),
        )
        // Par level recalculation (admin only)
        .route(
            "/par-levels/recalculate",
            post(handlers::par_levels::recalculate_par_levels),
        )
        .nest(
            "/presentacion-formatos",
            handlers::presentacion_formatos::routes(),
        )
        // Stock y lotes (lectura)
        .nest("/stock", handlers::stock::routes())
        .nest("/lotes", handlers::lotes::routes())
        // Operaciones de escritura
        .nest("/consumos", handlers::consumos::routes())
        .nest("/recepciones", handlers::recepciones::routes())
        .nest(
            "/solicitudes-compra",
            handlers::solicitudes_compra::routes(),
        )
        .nest("/ordenes-compra", handlers::ordenes_compra::routes())
        .nest("/descartes", handlers::descartes::routes())
        .nest("/conteo", handlers::conteo::routes())
        // Reportes
        .nest("/reportes", handlers::reportes::routes())
        // Ledger y audit (lectura)
        .nest("/movimientos", handlers::movimientos::routes())
        .nest("/audit-log", handlers::audit_log::routes())
        // Etiquetas (barcode data endpoints)
        .nest("/etiquetas", handlers::etiquetas::routes())
        // Configuración del sistema
        .nest("/configuracion", handlers::configuracion::routes())
        // Setup (carga inicial)
        .nest("/setup", handlers::setup::routes())
        // Uploads privados (documentos de recepcion, guias, etc.)
        .nest("/uploads", handlers::uploads::routes())
        // Middleware de auth
        .route_layer(middleware::from_fn_with_state(state, require_auth));

    let mut router = Router::new()
        .merge(handlers::health::routes())
        .nest("/api/v1/auth", handlers::auth_handler::public_routes())
        .nest("/api/v1/auth", auth_protected)
        .nest_service(
            "/api/v1/uploads/productos",
            ServeDir::new("uploads/productos"),
        )
        .nest("/api/v1", protected);

    if enable_swagger {
        router = router
            .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()));
    }

    router
}
