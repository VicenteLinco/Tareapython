use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

static BUNDLE_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|candidate| candidate.join(".git").exists())
        .expect("the backend must live inside the repository checkout")
        .to_path_buf()
}

fn visible_directory_like_entries(root: &Path) -> Vec<String> {
    let mut entries = fs::read_dir(root)
        .expect("the repository root must be readable")
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }

            let file_type = entry
                .file_type()
                .unwrap_or_else(|error| panic!("cannot inspect {name}: {error}"));
            (file_type.is_dir() || file_type.is_symlink()).then_some(name)
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
}

struct SyntheticBundle {
    payload: PathBuf,
    staging: PathBuf,
}

impl SyntheticBundle {
    fn new() -> Self {
        let root = repository_root();
        let sequence = BUNDLE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let staging = root.join(format!(
            "build/.staging.contract-{}-{sequence}",
            std::process::id()
        ));
        let payload = staging.join("payload");

        fs::create_dir_all(payload.join("static/nested"))
            .expect("the synthetic staging bundle must be creatable");
        fs::write(
            payload.join("inventario-lab-backend"),
            b"synthetic executable\n",
        )
        .expect("the synthetic backend must be writable");
        fs::set_permissions(
            payload.join("inventario-lab-backend"),
            fs::Permissions::from_mode(0o755),
        )
        .expect("the synthetic backend mode must be configurable");
        fs::write(payload.join("static/index.html"), b"<!doctype html>\n")
            .expect("the synthetic frontend must be writable");
        fs::write(
            payload.join("config.example.env"),
            b"DATABASE_URL=CHANGE_ME\nJWT_SECRET=CHANGE_ME\nJWT_REFRESH_SECRET=CHANGE_ME\n",
        )
        .expect("the synthetic config must be writable");
        fs::write(
            payload.join("manifest.json"),
            concat!(
                "{\n",
                "  \"schemaVersion\": 1,\n",
                "  \"target\": \"linux-amd64\",\n",
                "  \"revision\": \"0000000000000000000000000000000000000000\",\n",
                "  \"dirty\": true,\n",
                "  \"migrations\": [{\"file\": \"001.sql\", \"sha256\": ",
                "\"0000000000000000000000000000000000000000000000000000000000000000\"}]\n",
                "}\n"
            ),
        )
        .expect("the synthetic manifest must be writable");
        fs::set_permissions(&payload, fs::Permissions::from_mode(0o755))
            .expect("the synthetic bundle root mode must be configurable");

        Self { payload, staging }
    }

    fn write(&self, relative: &str, contents: &[u8]) {
        let path = self.payload.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("the synthetic fixture parent must be creatable");
        }
        fs::write(path, contents).expect("the synthetic fixture must be writable");
    }

    fn set_root_mode(&self, mode: u32) {
        fs::set_permissions(&self.payload, fs::Permissions::from_mode(mode))
            .expect("the synthetic bundle root mode must be configurable");
    }

    fn refresh_checksums(&self) {
        let mut files = Vec::new();
        collect_files(&self.payload, &self.payload, &mut files);
        files.retain(|relative| relative != Path::new("SHA256SUMS"));
        files.sort();

        let mut checksums = String::new();
        for relative in files {
            let output = Command::new("sha256sum")
                .arg(self.payload.join(&relative))
                .output()
                .expect("sha256sum must be available for the release contract");
            assert!(output.status.success(), "sha256sum must succeed");
            let digest = String::from_utf8(output.stdout)
                .expect("sha256sum output must be UTF-8")
                .split_whitespace()
                .next()
                .expect("sha256sum must emit a digest")
                .to_owned();
            checksums.push_str(&format!("{digest}  {}\n", relative.display()));
        }
        fs::write(self.payload.join("SHA256SUMS"), checksums)
            .expect("the checksum inventory must be writable");
    }

    fn verify(&self) -> Output {
        Command::new(repository_root().join("source/tooling/verify-release.sh"))
            .arg("--staging")
            .arg(&self.payload)
            .output()
            .expect("the release verifier must execute")
    }
}

impl Drop for SyntheticBundle {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.staging);
    }
}

fn collect_files(base: &Path, directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("the synthetic bundle must be readable") {
        let path = entry.expect("the synthetic entry must be readable").path();
        if path.is_dir() {
            collect_files(base, &path, files);
        } else if path.is_file() {
            files.push(
                path.strip_prefix(base)
                    .expect("the synthetic file must remain inside its bundle")
                    .to_path_buf(),
            );
        }
    }
}

#[test]
fn repository_exposes_only_source_and_build_product_directories() {
    assert_eq!(
        visible_directory_like_entries(&repository_root()),
        ["build", "source"],
        "visible product directories and directory-like symlinks must match the repository contract"
    );
}

#[test]
fn source_and_build_have_single_authoritative_locations() {
    let root = repository_root();

    for required in [
        "source/backend/Cargo.toml",
        "source/backend/migrations/001_initial_schema.sql",
        "source/backend/migrations/002_product_scoped_lab_fields.sql",
        "source/frontend/package.json",
        "source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md",
        "source/tooling/build-release.sh",
        "source/tooling/verify-release.sh",
        "build/.gitignore",
    ] {
        assert!(
            root.join(required).exists(),
            "missing required path: {required}"
        );
    }

    for obsolete in [
        "backend",
        "codigofuente",
        "migrations",
        "openspec",
        "scratch",
        "static",
        "source/backend/src/bin/hash_password.rs",
        "source/backend/src/bin/inspect_db.rs",
    ] {
        assert!(
            !root.join(obsolete).exists(),
            "obsolete root authority remains: {obsolete}"
        );
    }
}

#[test]
fn production_image_builds_current_source_without_previous_build_output() {
    let root = repository_root();
    let dockerfile = fs::read_to_string(root.join("Dockerfile"))
        .expect("the canonical production Dockerfile must exist");

    assert!(dockerfile.contains("cargo build --locked --release"));
    assert!(dockerfile.contains("COPY source/backend/migrations"));
    assert!(dockerfile.contains("COPY source/backend/.sqlx"));
    assert!(dockerfile.contains("ENV SQLX_OFFLINE=true"));
    assert!(dockerfile.contains("COPY source/frontend/package.json"));
    assert!(dockerfile.contains("COPY --from=backend-builder"));
    assert!(!dockerfile.contains("COPY build/"));
    assert!(!dockerfile.contains("COPY backend/"));
    assert!(!dockerfile.contains("COPY codigofuente/"));
    assert!(!dockerfile.contains("COPY inventario-lab-backend"));
}

#[test]
fn release_inputs_exclude_root_prebuilt_backend_binary() {
    assert!(
        !repository_root().join("inventario-lab-backend").exists(),
        "release inputs must not include a stale prebuilt backend binary"
    );
}

#[test]
fn bundle_verifier_rejects_nested_environment_and_log_files() {
    for forbidden in [
        "static/nested/.env",
        "static/nested/runtime.log",
        "static/nested/.env.local",
        "static/runtime.log/asset.js",
    ] {
        let bundle = SyntheticBundle::new();
        bundle.write(forbidden, b"synthetic non-secret content\n");
        bundle.refresh_checksums();

        let output = bundle.verify();
        assert!(
            !output.status.success(),
            "the verifier accepted forbidden nested path {forbidden}: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn bundle_verifier_requires_a_world_traversable_root() {
    let bundle = SyntheticBundle::new();
    bundle.set_root_mode(0o700);
    bundle.refresh_checksums();

    let output = bundle.verify();
    assert!(
        !output.status.success(),
        "the verifier accepted a 0700 bundle root: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn release_builder_normalizes_the_bundle_root_before_publication() {
    let script = fs::read_to_string(repository_root().join("source/tooling/build-release.sh"))
        .expect("the release builder must be readable");

    assert!(
        script.contains("payload.chmod(0o755)"),
        "the staging payload root must be normalized before verification and publication"
    );
}
