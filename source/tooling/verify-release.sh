#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)

if [[ ${1:-} == "--source" ]]; then
  python3 - "$repo_root" <<'PY'
from pathlib import Path
import ast
import os
import re
import stat
import sys

repo = Path(sys.argv[1]).resolve()

visible_directory_like = sorted(
    path.name
    for path in repo.iterdir()
    if not path.name.startswith(".") and (path.is_dir() or path.is_symlink())
)
if visible_directory_like != ["build", "source"]:
    raise SystemExit(f"Unexpected visible product directories/symlinks: {visible_directory_like}")

allowed_root_files = {
    "AGENTS.md",
    "CLAUDE.md",
    "Dockerfile",
    "LICENSE",
    "Makefile",
    "README.md",
    "compose.yaml",
    "render.yaml",
}
unexpected_root_files = sorted(
    path.name
    for path in repo.iterdir()
    if path.is_file() and not path.name.startswith(".") and path.name not in allowed_root_files
)
if unexpected_root_files:
    raise SystemExit(f"Unexpected visible root files: {unexpected_root_files}")

required = [
    "Dockerfile",
    "Makefile",
    "README.md",
    "compose.yaml",
    "render.yaml",
    ".dockerignore",
    ".env.example",
    ".gitignore",
    ".github/workflows/ci.yml",
    "build/.gitignore",
    "source/backend/Cargo.toml",
    "source/backend/Cargo.lock",
    "source/backend/.cargo/config.toml",
    "source/backend/.sqlx",
    "source/backend/migrations/001_initial_schema.sql",
    "source/backend/migrations/002_product_scoped_lab_fields.sql",
    "source/frontend/package.json",
    "source/frontend/package-lock.json",
    "source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md",
    "source/docs/CODING_START_PROMPT.md",
    "source/tooling/build-release.sh",
    "source/tooling/verify-release.sh",
    "source/tooling/clean-build.sh",
]
missing = [relative for relative in required if not (repo / relative).exists()]
if missing:
    raise SystemExit(f"Missing repository contract paths: {missing}")

obsolete = ["backend", "codigofuente", "migrations", "openspec", "scratch", "static"]
remaining = [relative for relative in obsolete if (repo / relative).exists()]
if remaining:
    raise SystemExit(f"Obsolete root authorities remain: {remaining}")

caches = [
    "source/backend/target",
    "source/frontend/node_modules",
    "source/frontend/dist",
    "source/frontend/.vite",
]
remaining_caches = [relative for relative in caches if (repo / relative).exists()]
if remaining_caches:
    raise SystemExit(f"Generated caches remain in source: {remaining_caches}")

unsafe_bins = [
    "source/backend/src/bin/hash_password.rs",
    "source/backend/src/bin/inspect_db.rs",
]
remaining_bins = [relative for relative in unsafe_bins if (repo / relative).exists()]
if remaining_bins:
    raise SystemExit(f"Unsafe diagnostic binaries remain: {remaining_bins}")

build_ignore = (repo / "build/.gitignore").read_text(encoding="utf-8").splitlines()
if build_ignore != ["*", "!.gitignore"]:
    raise SystemExit("build/.gitignore must ignore every generated sibling and preserve itself.")

dockerfile = (repo / "Dockerfile").read_text(encoding="utf-8")
for token in [
    "FROM ${NODE_IMAGE} AS frontend-builder",
    "COPY source/frontend/package.json source/frontend/package-lock.json",
    "FROM ${RUST_IMAGE} AS backend-builder",
    "COPY source/backend/.sqlx",
    "COPY source/backend/migrations",
    "ENV SQLX_OFFLINE=true",
    "cargo build --locked --release --bin inventario-lab-backend",
    "FROM scratch AS bundle-export",
    "FROM ${RUNTIME_IMAGE} AS runtime",
]:
    if token not in dockerfile:
        raise SystemExit(f"Dockerfile contract token missing: {token}")
for forbidden in ["COPY build/", "COPY backend/", "COPY codigofuente/", "COPY inventario-lab-backend"]:
    if forbidden in dockerfile:
        raise SystemExit(f"Dockerfile consumes forbidden previous output: {forbidden}")

dockerignore = (repo / ".dockerignore").read_text(encoding="utf-8").splitlines()
for required_ignore in [".git", ".env", "build", "source/docs", "source/tooling", "source/backend/target", "source/frontend/node_modules", "uploads"]:
    if required_ignore not in dockerignore:
        raise SystemExit(f".dockerignore is missing: {required_ignore}")

render = (repo / "render.yaml").read_text(encoding="utf-8")
for token in ["runtime: docker", "dockerfilePath: ./Dockerfile", "dockerContext: .", "healthCheckPath: /health", "autoDeployTrigger: checksPass"]:
    if token not in render:
        raise SystemExit(f"Render contract token missing: {token}")
if not re.search(r"- key: JWT_REFRESH_SECRET\s+sync: false", render):
    raise SystemExit("Render must declare JWT_REFRESH_SECRET with sync: false and no value.")

compose = (repo / "compose.yaml").read_text(encoding="utf-8")
for token in ["dockerfile: Dockerfile", "target: runtime", "JWT_REFRESH_SECRET", "condition: service_healthy"]:
    if token not in compose:
        raise SystemExit(f"Compose contract token missing: {token}")

makefile = (repo / "Makefile").read_text(encoding="utf-8")
for target in ["check:", "build:", "verify-build:", "release:", "clean:"]:
    if target not in makefile:
        raise SystemExit(f"Make target missing: {target}")

env_example = {}
for raw_line in (repo / ".env.example").read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    env_example[key] = value
for key in ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"]:
    if key not in env_example or "CHANGE_ME" not in env_example[key]:
        raise SystemExit(f"Sensitive template variable must remain a placeholder: {key}")

ast.parse((repo / "source/tooling/dev-data/generate_mock_data.py").read_text(encoding="utf-8"))
for script in [
    "source/tooling/apply-dev-seed.sh",
    "source/tooling/build-release.sh",
    "source/tooling/verify-release.sh",
    "source/tooling/clean-build.sh",
]:
    mode = stat.S_IMODE((repo / script).stat().st_mode)
    if mode & 0o111 == 0:
        raise SystemExit(f"Tooling script is not executable: {script}")

print("Source contract PASS: visible dirs=2; canonical paths/config/tooling verified; no caches or legacy roots.")
PY
  exit 0
fi

staging_mode=false
if [[ ${1:-} == "--staging" ]]; then
  [[ $# -eq 2 ]] || {
    printf 'Usage: %s --staging <build/.staging.*/payload>\n' "$0" >&2
    exit 2
  }
  staging_mode=true
  bundle=$2
else
  [[ $# -le 1 ]] || {
    printf 'Usage: %s [build/linux-amd64]\n' "$0" >&2
    exit 2
  }
  bundle=${1:-"$repo_root/build/linux-amd64"}
fi
python3 - "$repo_root" "$bundle" "$staging_mode" <<'PY'
from pathlib import Path
import hashlib
import json
import os
import re
import stat
import sys

repo = Path(sys.argv[1]).resolve()
bundle = Path(sys.argv[2]).resolve()
staging_mode = sys.argv[3] == "true"
build_root = (repo / "build").resolve()
if staging_mode:
    if bundle.name != "payload" or bundle.parent.parent != build_root or not bundle.parent.name.startswith(".staging."):
        raise SystemExit("Refusing to verify an unexpected staging bundle path.")
elif bundle != build_root / "linux-amd64" or build_root not in bundle.parents:
    raise SystemExit("Refusing to verify a bundle outside build/linux-amd64.")
if not bundle.is_dir():
    raise SystemExit(f"Bundle does not exist: {bundle}")
if stat.S_IMODE(bundle.stat().st_mode) != 0o755:
    raise SystemExit("Bundle root must be mode 0755.")

expected_top = {
    "inventario-lab-backend",
    "static",
    "config.example.env",
    "manifest.json",
    "SHA256SUMS",
}
actual_top = {path.name for path in bundle.iterdir()}
if actual_top != expected_top:
    raise SystemExit(f"Unexpected bundle top-level entries: {sorted(actual_top)}")

for path in bundle.rglob("*"):
    if path.is_symlink():
        raise SystemExit(f"Bundle must not contain symlinks: {path.relative_to(bundle)}")

binary = bundle / "inventario-lab-backend"
if not binary.is_file() or stat.S_IMODE(binary.stat().st_mode) & 0o111 == 0:
    raise SystemExit("Backend binary is missing or not executable.")
if not (bundle / "static/index.html").is_file():
    raise SystemExit("Frontend static/index.html is missing.")

for path in bundle.rglob("*"):
    relative = path.relative_to(bundle).as_posix()
    forbidden_name = next(
        (
            part
            for part in path.relative_to(bundle).parts
            if part.lower() == ".env"
            or part.lower().startswith(".env.")
            or part.lower().endswith(".log")
        ),
        None,
    )
    if forbidden_name is not None:
        raise SystemExit(f"Forbidden environment/log path in bundle: {relative}")
    if not path.is_file():
        continue
    lowered = relative.lower()
    if lowered.endswith((".rs", ".ts", ".tsx", ".sql", ".pem", ".key", ".dump")):
        raise SystemExit(f"Forbidden source/secret/runtime file in bundle: {relative}")
    if any(part in {"source", "target", "node_modules", "migrations", "uploads", ".git"} for part in path.relative_to(bundle).parts):
        raise SystemExit(f"Forbidden directory in bundle: {relative}")

manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
if manifest.get("schemaVersion") != 1 or manifest.get("target") != "linux-amd64":
    raise SystemExit("Manifest schema/target is invalid.")
if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("revision", "")):
    raise SystemExit("Manifest revision must be a full Git SHA.")
if not isinstance(manifest.get("dirty"), bool):
    raise SystemExit("Manifest dirty flag must be explicit.")
migrations = manifest.get("migrations")
if not isinstance(migrations, list) or not migrations:
    raise SystemExit("Manifest must contain ordered embedded migration hashes.")
for migration in migrations:
    if set(migration) != {"file", "sha256"} or not re.fullmatch(r"[0-9a-f]{64}", migration["sha256"]):
        raise SystemExit("Manifest migration entries may contain only file and SHA-256.")

config = {}
for raw_line in (bundle / "config.example.env").read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    config[key] = value
for key in ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"]:
    if key not in config or "CHANGE_ME" not in config[key]:
        raise SystemExit(f"Bundled config contains a non-placeholder sensitive value: {key}")

checksum_file = bundle / "SHA256SUMS"
declared = {}
for line in checksum_file.read_text(encoding="utf-8").splitlines():
    digest, separator, relative = line.partition("  ")
    if separator != "  " or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise SystemExit(f"Malformed SHA256SUMS line: {line!r}")
    if relative.startswith("/") or ".." in Path(relative).parts or relative in declared:
        raise SystemExit(f"Unsafe or duplicate checksum path: {relative}")
    declared[relative] = digest

actual_files = sorted(
    path.relative_to(bundle).as_posix()
    for path in bundle.rglob("*")
    if path.is_file() and path.name != "SHA256SUMS"
)
if sorted(declared) != actual_files:
    raise SystemExit("SHA256SUMS inventory does not match bundle files.")
for relative, expected in declared.items():
    digest = hashlib.sha256((bundle / relative).read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"Checksum mismatch: {relative}")

print(f"Bundle contract PASS: {len(actual_files)} files; checksums valid; revision={manifest['revision'][:12]}; dirty={str(manifest['dirty']).lower()}.")
PY
