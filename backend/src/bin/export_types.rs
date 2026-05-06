use inventario_lab_backend::dto::{
    area::{AsignarProductosRequest, CreateArea, ProductoAreaRow, UpdateArea},
    categoria::{CreateCategoria, UpdateCategoria},
    descarte::{DescarteItem, DescarteRequest, DescarteResponse},
    proveedor::{CreateProveedor, ProveedorQuery, UpdateProveedor},
    recepcion::{
        CreateRecepcion, DetalleRecepcionInput, DetalleRecepcionRow, LoteCreado,
        PaginatedRecepciones, RecepcionListItem, RecepcionQuery, SubirFotoInput,
    },
    solicitud::{
        CreateSolicitudItem, ItemRecomendado, SolicitudDetalle, SolicitudDetalleItem,
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
    let out_path = Path::new("../frontend/src/types/generated.ts");

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
    append!(LoteCreado);

    match fs::write(out_path, &output) {
        Ok(_) => println!("Tipos exportados a {:?}", out_path),
        Err(e) => eprintln!("Error escribiendo archivo: {}", e),
    }
}
