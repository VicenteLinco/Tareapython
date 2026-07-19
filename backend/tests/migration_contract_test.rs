use std::{fs, path::Path};

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

#[test]
fn migrations_are_a_single_clean_baseline() {
    let embedded = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let canonical = Path::new(env!("CARGO_MANIFEST_DIR")).join("../migrations");

    let expected = vec!["001_initial_schema.sql".to_owned()];
    assert_eq!(sql_files(&canonical), expected);
    assert_eq!(sql_files(&embedded), expected);

    let canonical_sql = fs::read_to_string(canonical.join(&expected[0])).unwrap();
    let embedded_sql = fs::read_to_string(embedded.join(&expected[0])).unwrap();
    assert_eq!(embedded_sql, canonical_sql, "embedded migrations drifted");
    let gitignore =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.gitignore")).unwrap();
    assert!(
        gitignore.lines().any(|line| line == "!backend/migrations/"),
        "embedded migration directory must be tracked for clean-checkout builds"
    );
    assert!(
        gitignore
            .lines()
            .any(|line| line == "!backend/migrations/*.sql"),
        "embedded SQL migrations must be tracked for clean-checkout builds"
    );

    let obsolete_signature = "fn_estado_vencimiento(p_tiene_vencido boolean, p_proxima_venc_usable date, p_rastrea_vencimiento boolean DEFAULT true, p_riesgo_dias integer DEFAULT 30, p_proximo_dias integer DEFAULT 90)";
    assert!(
        !canonical_sql.contains(obsolete_signature),
        "obsolete five-argument fn_estado_vencimiento overload remains"
    );
    let removed_column = ["es", "cenabas"].join("_");
    assert!(!canonical_sql.to_lowercase().contains(&removed_column));
}
