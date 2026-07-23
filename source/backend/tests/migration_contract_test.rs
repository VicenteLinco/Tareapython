use std::{fs, path::Path};

use sha2::{Digest, Sha256};

fn sql_files(directory: &Path) -> Vec<String> {
    let mut files = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()))
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension().and_then(|ext| ext.to_str()) == Some("sql"))
                .then(|| entry.file_name().to_string_lossy().into_owned())
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn sha256_hex(contents: &[u8]) -> String {
    format!("{:x}", Sha256::digest(contents))
}

#[test]
fn migrations_preserve_the_baseline_and_append_only_history() {
    let canonical = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");

    let canonical_files = vec![
        "001_initial_schema.sql".to_owned(),
        "002_product_scoped_lab_fields.sql".to_owned(),
    ];
    assert_eq!(sql_files(&canonical), canonical_files);

    let canonical_sql = fs::read_to_string(canonical.join(&canonical_files[0])).unwrap();
    assert_eq!(
        sha256_hex(canonical_sql.as_bytes()),
        "a22a9bff9442dac7233ca96b725f5a5359605961b600a1c03a0d43181e522bf9",
        "the already-applied 001 baseline must never be rewritten"
    );

    let product_fields_sql = fs::read(canonical.join(&canonical_files[1])).unwrap();
    assert_eq!(
        sha256_hex(&product_fields_sql),
        "0a7a568f8c4ba5ebf027861a4cbe4fe0406dfdf8c91e5187b2f5d07c459c0fd1",
        "the append-only 002 migration drifted"
    );

    let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|candidate| candidate.join(".git").exists())
        .expect("the backend must live inside the repository checkout");
    assert!(
        !repository_root.join("migrations").exists(),
        "a duplicate root migration authority must not exist"
    );

    let obsolete_signature = "fn_estado_vencimiento(p_tiene_vencido boolean, p_proxima_venc_usable date, p_rastrea_vencimiento boolean DEFAULT true, p_riesgo_dias integer DEFAULT 30, p_proximo_dias integer DEFAULT 90)";
    assert!(
        !canonical_sql.contains(obsolete_signature),
        "obsolete five-argument fn_estado_vencimiento overload remains"
    );
    let removed_column = ["es", "cenabas"].join("_");
    assert!(!canonical_sql.to_lowercase().contains(&removed_column));
}
