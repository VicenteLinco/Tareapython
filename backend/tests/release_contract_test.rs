use std::fs;
use std::path::Path;

fn repository_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend must live below the repository root")
}

#[test]
fn production_image_builds_backend_from_source() {
    let dockerfile = fs::read_to_string(repository_root().join("dockerfile"))
        .expect("the production dockerfile must exist");

    assert!(dockerfile.contains("cargo build --locked --release"));
    assert!(dockerfile.contains("COPY backend/migrations"));
    assert!(dockerfile.contains("COPY backend/.sqlx ./.sqlx"));
    assert!(dockerfile.contains("ENV SQLX_OFFLINE=true"));
    assert!(dockerfile.contains("COPY --from=backend-builder"));
    assert!(!dockerfile.contains("COPY inventario-lab-backend"));
}

#[test]
fn release_inputs_exclude_prebuilt_backend_binary() {
    assert!(
        !repository_root().join("inventario-lab-backend").exists(),
        "release inputs must not include a stale prebuilt backend binary"
    );
}
