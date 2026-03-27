use axum::middleware;
use axum::Router;

use crate::auth::middleware::require_auth;
use crate::db::AppState;
use crate::handlers;

pub fn create_routes(state: AppState) -> Router<AppState> {
    // Auth protegido (bajo /api/v1/auth)
    let auth_protected = Router::new()
        .merge(handlers::auth_handler::protected_routes())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_auth,
        ));

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
        // Stock y lotes (lectura)
        .nest("/stock", handlers::stock::routes())
        .nest("/lotes", handlers::lotes::routes())
        // Operaciones de escritura
        .nest("/consumos", handlers::consumos::routes())
        .nest("/recepciones", handlers::recepciones::routes())
        .nest("/transferencias", handlers::transferencias::routes())
        .nest("/descartes", handlers::descartes::routes())
        .nest("/conteo", handlers::conteo::routes())
        // Ledger y audit (lectura)
        .nest("/movimientos", handlers::movimientos::routes())
        .nest("/audit-log", handlers::audit_log::routes())
        // Configuración del sistema
        .nest("/configuracion", handlers::configuracion::routes())
        // Setup (carga inicial)
        .nest("/setup", handlers::setup::routes())
        // Middleware de auth
        .route_layer(middleware::from_fn_with_state(state, require_auth));

    Router::new()
        .merge(handlers::health::routes())
        .nest("/api/v1/auth", handlers::auth_handler::public_routes())
        .nest("/api/v1/auth", auth_protected)
        .nest("/api/v1", protected)
}
