use inventario_lab_backend::domain::{
    ConfianzaForecast, ControlLote, EstadoConteoItem, EstadoConteoSesion, EstadoEnvioProveedor,
    EstadoOrdenCompra, EstadoRecepcion, EstadoSolicitud, UrgenciaReposicion,
    EstadoCatalogo, OrigenRegistro,
};
use inventario_lab_backend::dto::{
    area::{
        AsignarProductosRequest, CreateArea, ProductoAreaConfigInput, ProductoAreaRow, UpdateArea,
    },
    categoria::{CreateCategoria, UpdateCategoria},
    descarte::{DescarteItem, DescarteRequest, DescarteResponse},
    proveedor::{CreateProveedor, ProveedorQuery, UpdateProveedor},
    recepcion::{
        CreateRecepcion, DetalleRecepcionInput, DetalleRecepcionRow, LoteCreado,
        PaginatedRecepciones, RecepcionListItem, RecepcionQuery, RecepcionReconciliacionRow,
        SubirFotoInput,
    },
    solicitud::{
        CancelarEnvioInput, CreateSolicitudItem, EnvioProveedorView, ItemRecomendado,
        ProveedorResumen, RegistrarEnvioInput, SolicitudDetalle, SolicitudDetalleItem,
        SolicitudResumen, UpdateSolicitudRequest,
    },
    unidad_basica::{CreateUnidadBasica, UpdateUnidadBasica},
    usuario::{
        AreaSimple, CreateUsuario, ResetPasswordRequest, UpdateUsuario, UsuarioQuery,
        UsuarioResponse,
    },
};
/// Genera tipos TypeScript desde los modelos y DTOs Rust usando specta.
/// Ejecutar con: cargo run --bin export_types
use inventario_lab_backend::models::{
    area::Area, categoria::Categoria, lote::Lote, presentacion::Presentacion, producto::Producto,
    proveedor::Proveedor, unidad_basica::UnidadBasica, usuario::Usuario,
};
use inventario_lab_backend::services::stock_ops::MovimientoGenerado;
use specta_typescript::{Typescript, export};
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::Path;

fn main() {
    let conf = Typescript::default();
    let out_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../frontend/src/types/generated.ts");

    let mut output = String::new();
    writeln!(
        output,
        "// @generated: Generado automáticamente por el backend."
    )
    .unwrap();
    writeln!(
        output,
        "// Ejecutar `cargo run --bin export_types` para regenerar."
    )
    .unwrap();
    writeln!(output, "// NO editar manualmente.\n").unwrap();

    macro_rules! append {
        ($t:ty) => {
            match export::<$t>(&conf) {
                Ok(ts) => {
                    output.push_str(&ts);
                    output.push('\n');
                }
                Err(e) => eprintln!("Error exportando {}: {}", stringify!($t), e),
            }
        };
    }

    // Enums de dominio
    append!(EstadoSolicitud);
    append!(EstadoRecepcion);
    append!(EstadoOrdenCompra);
    append!(EstadoConteoSesion);
    append!(EstadoConteoItem);
    append!(EstadoEnvioProveedor);
    append!(ConfianzaForecast);
    append!(UrgenciaReposicion);
    append!(ControlLote);
    append!(EstadoCatalogo);
    append!(OrigenRegistro);

    // Modelos
    append!(Area);
    append!(Categoria);
    append!(UnidadBasica);
    append!(Proveedor);
    append!(Producto);
    append!(Presentacion);
    append!(Lote);
    append!(Usuario);

    // DTOs Áreas
    append!(CreateArea);
    append!(UpdateArea);
    append!(ProductoAreaRow);
    append!(ProductoAreaConfigInput);
    append!(AsignarProductosRequest);

    // DTOs Proveedores
    append!(CreateProveedor);
    append!(UpdateProveedor);
    append!(ProveedorQuery);

    // DTOs Usuarios
    append!(CreateUsuario);
    append!(UpdateUsuario);
    append!(UsuarioResponse);
    append!(AreaSimple);
    append!(UsuarioQuery);
    append!(ResetPasswordRequest);

    // DTOs Categorías
    append!(CreateCategoria);
    append!(UpdateCategoria);

    // DTOs Unidades Básicas
    append!(CreateUnidadBasica);
    append!(UpdateUnidadBasica);

    // DTOs Solicitudes
    append!(ItemRecomendado);
    append!(UpdateSolicitudRequest);
    append!(CreateSolicitudItem);
    append!(RegistrarEnvioInput);
    append!(CancelarEnvioInput);
    append!(EnvioProveedorView);
    append!(ProveedorResumen);
    append!(SolicitudResumen);
    append!(SolicitudDetalle);
    append!(SolicitudDetalleItem);

    // DTOs Descartes
    append!(DescarteRequest);
    append!(DescarteItem);
    append!(DescarteResponse);
    append!(MovimientoGenerado);

    // DTOs Recepciones
    append!(RecepcionQuery);
    append!(PaginatedRecepciones);
    append!(RecepcionListItem);
    append!(SubirFotoInput);
    append!(CreateRecepcion);
    append!(DetalleRecepcionInput);
    append!(DetalleRecepcionRow);
    append!(RecepcionReconciliacionRow);
    append!(LoteCreado);

    // Tipos de error de API — añadidos manualmente (no vienen de specta)
    writeln!(output, r#"export type ApiErrorCode ="#).unwrap();
    writeln!(output, r#"  | "NOT_FOUND""#).unwrap();
    writeln!(output, r#"  | "VALIDATION_ERROR""#).unwrap();
    writeln!(output, r#"  | "CONFLICT""#).unwrap();
    writeln!(output, r#"  | "FORBIDDEN""#).unwrap();
    writeln!(output, r#"  | "UNAUTHORIZED""#).unwrap();
    writeln!(output, r#"  | "RATE_LIMITED""#).unwrap();
    writeln!(output, r#"  | "INTERNAL_ERROR""#).unwrap();
    writeln!(output, r#"  | "UNIQUE_VIOLATION""#).unwrap();
    writeln!(output, r#"  | "FOREIGN_KEY_VIOLATION""#).unwrap();
    writeln!(output, r#"  | "CHECK_VIOLATION""#).unwrap();
    writeln!(output, r#"  | "NOT_NULL_VIOLATION""#).unwrap();
    writeln!(output, r#"  | "STOCK_INSUFICIENTE""#).unwrap();
    writeln!(output, r#"  | "STOCK_INSUFICIENTE_BATCH""#).unwrap();
    writeln!(output, r#"  | "LOTE_AGOTADO""#).unwrap();
    writeln!(output, r#"  | "LOTE_VENCIDO""#).unwrap();
    writeln!(output, r#"  | "VERSION_CONFLICT""#).unwrap();
    writeln!(output, r#"  | (string & {{}});"#).unwrap();
    writeln!(output).unwrap();
    writeln!(output, r#"export interface ApiError {{"#).unwrap();
    writeln!(output, r#"  code: ApiErrorCode;"#).unwrap();
    writeln!(output, r#"  message: string;"#).unwrap();
    writeln!(output, r#"  details?: Record<string, unknown>;"#).unwrap();
    writeln!(output, r#"}}"#).unwrap();
    writeln!(output).unwrap();

    match fs::write(&out_path, &output) {
        Ok(_) => println!("Tipos exportados a {:?}", out_path),
        Err(e) => eprintln!("Error escribiendo archivo: {}", e),
    }
}
