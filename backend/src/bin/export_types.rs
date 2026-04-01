/// Genera tipos TypeScript desde los modelos Rust usando specta.
/// Ejecutar con: cargo run --bin export_types
use inventario_lab_backend::models::{
    area::Area,
    categoria::Categoria,
    lote::Lote,
    presentacion::Presentacion,
    producto::Producto,
    proveedor::Proveedor,
    unidad_basica::UnidadBasica,
    usuario::Usuario,
};
use specta_typescript::{export, Typescript};
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::Path;

fn main() {
    let conf = Typescript::default();
    let out_path = Path::new("../frontend/src/types/generated.ts");

    let mut output = String::new();
    writeln!(output, "// @generated: Generado automáticamente por el backend.").unwrap();
    writeln!(output, "// Ejecutar `cargo run --bin export_types` para regenerar.").unwrap();
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

    append!(Area);
    append!(Categoria);
    append!(UnidadBasica);
    append!(Proveedor);
    append!(Producto);
    append!(Presentacion);
    append!(Lote);
    append!(Usuario);

    match fs::write(out_path, &output) {
        Ok(_) => println!("Tipos exportados a {:?}", out_path),
        Err(e) => eprintln!("Error escribiendo archivo: {}", e),
    }
}
