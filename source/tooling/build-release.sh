#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

release_mode=false
if [[ ${1:-} == "--release" ]]; then
  release_mode=true
elif [[ $# -ne 0 ]]; then
  printf 'Usage: %s [--release]\n' "$0" >&2
  exit 2
fi

for command in docker git python3; do
  command -v "$command" >/dev/null || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 2
  }
done
docker buildx version >/dev/null 2>&1 || {
  printf '%s\n' "Docker Buildx is required for an isolated local export." >&2
  exit 2
}

revision=$(git rev-parse --verify HEAD)
source_date_epoch=$(git show -s --format=%ct HEAD)
cargo_version=$(python3 - <<'PY'
import tomllib
from pathlib import Path
print(tomllib.loads(Path("source/backend/Cargo.toml").read_text(encoding="utf-8"))["package"]["version"])
PY
)
frontend_version=$(python3 - <<'PY'
import json
from pathlib import Path
print(json.loads(Path("source/frontend/package.json").read_text(encoding="utf-8"))["version"])
PY
)

dirty=false
if [[ -n $(git status --porcelain=v1 --untracked-files=all) ]]; then
  dirty=true
fi
version_identity=$(git describe --tags --always)
if $dirty; then
  version_identity="${version_identity}-dirty"
  printf '%s\n' "NOTICE: make build accepts the dirty source tree; manifest dirty=true."
fi

if $release_mode; then
  failures=()
  [[ $dirty == false ]] || failures+=("working tree/index is not clean")
  [[ -f LICENSE ]] || failures+=("LICENSE is missing; a maintainer must choose the license")
  expected_tag="v${cargo_version}"
  exact_tag=$(git describe --tags --exact-match HEAD 2>/dev/null || true)
  [[ $exact_tag == "$expected_tag" ]] || failures+=("annotated tag must be exactly ${expected_tag}; current=${exact_tag:-none}")
  if [[ -n $exact_tag ]]; then
    [[ $(git cat-file -t "$exact_tag" 2>/dev/null || true) == "tag" ]] || failures+=("release tag must be annotated")
  fi
  if (( ${#failures[@]} )); then
    printf '%s\n' "Release blocked:" >&2
    printf ' - %s\n' "${failures[@]}" >&2
    exit 2
  fi
fi

build_root="$repo_root/build"
mkdir -p "$build_root"
[[ -f "$build_root/.gitignore" ]] || {
  printf '%s\n' "build/.gitignore boundary is missing." >&2
  exit 2
}
staging=$(mktemp -d "$build_root/.staging.XXXXXX")
payload="$staging/payload"

cleanup_staging() {
  python3 - "$repo_root" "$staging" <<'PY'
from pathlib import Path
import shutil
import sys
repo = Path(sys.argv[1]).resolve()
staging = Path(sys.argv[2])
if staging.exists():
    resolved = staging.resolve()
    build = (repo / "build").resolve()
    if resolved.parent != build or not resolved.name.startswith(".staging."):
        raise SystemExit("Refusing to clean unexpected staging path.")
    shutil.rmtree(resolved)
PY
}
trap cleanup_staging EXIT

docker buildx build \
  --platform linux/amd64 \
  --file Dockerfile \
  --target bundle-export \
  --build-arg "VCS_REF=$revision" \
  --build-arg "SOURCE_DATE_EPOCH=$source_date_epoch" \
  --output "type=local,dest=$payload" \
  .

cp -- .env.example "$payload/config.example.env"

python3 - "$payload" "$revision" "$source_date_epoch" "$version_identity" "$cargo_version" "$frontend_version" "$dirty" "$release_mode" <<'PY'
from pathlib import Path
import hashlib
import json
import os
import re
import stat
import sys

payload = Path(sys.argv[1])
revision = sys.argv[2]
source_date_epoch = int(sys.argv[3])
version_identity = sys.argv[4]
cargo_version = sys.argv[5]
frontend_version = sys.argv[6]
dirty = sys.argv[7] == "true"
release_mode = sys.argv[8] == "true"
repo = Path.cwd()

if not (payload / "inventario-lab-backend").is_file() or not (payload / "static/index.html").is_file():
    raise SystemExit("Docker bundle-export did not produce the required backend/static pair.")

def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

dockerfile = (repo / "Dockerfile").read_text(encoding="utf-8")
images = {}
for name in ("NODE_IMAGE", "RUST_IMAGE", "RUNTIME_IMAGE"):
    match = re.search(rf"^ARG {name}=(.+)$", dockerfile, re.MULTILINE)
    if not match:
        raise SystemExit(f"Dockerfile image identity missing: {name}")
    images[name.removesuffix("_IMAGE").lower()] = match.group(1)

migrations = [
    {"file": path.name, "sha256": digest(path)}
    for path in sorted((repo / "source/backend/migrations").glob("*.sql"))
]
manifest = {
    "artifacts": {
        "backend": "inventario-lab-backend",
        "config": "config.example.env",
        "static": "static",
    },
    "buildMode": "release" if release_mode else "local",
    "dirty": dirty,
    "frontendPackageVersion": frontend_version,
    "lockfiles": {
        "cargo": digest(repo / "source/backend/Cargo.lock"),
        "npm": digest(repo / "source/frontend/package-lock.json"),
    },
    "migrations": migrations,
    "packageVersion": cargo_version,
    "productName": "inventario-lab",
    "revision": revision,
    "schemaVersion": 1,
    "sourceDateEpoch": source_date_epoch,
    "target": "linux-amd64",
    "toolchainImages": images,
    "versionIdentity": version_identity,
}
(payload / "manifest.json").write_text(
    json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

for path in payload.rglob("*"):
    if path.is_symlink():
        raise SystemExit(f"Unexpected symlink in Docker export: {path}")
    if path.is_dir():
        path.chmod(0o755)
    elif path.name == "inventario-lab-backend":
        path.chmod(0o755)
    else:
        path.chmod(0o644)
    os.utime(path, (source_date_epoch, source_date_epoch), follow_symlinks=False)
payload.chmod(0o755)

files = sorted(
    path for path in payload.rglob("*") if path.is_file() and path.name != "SHA256SUMS"
)
with (payload / "SHA256SUMS").open("w", encoding="utf-8", newline="") as stream:
    for path in files:
        stream.write(f"{digest(path)}  {path.relative_to(payload).as_posix()}\n")
(payload / "SHA256SUMS").chmod(0o644)
os.utime(payload / "SHA256SUMS", (source_date_epoch, source_date_epoch))
PY

source/tooling/verify-release.sh --staging "$payload"

python3 - "$repo_root" "$payload" <<'PY'
from pathlib import Path
import os
import shutil
import sys

repo = Path(sys.argv[1]).resolve()
payload = Path(sys.argv[2]).resolve()
build = (repo / "build").resolve()
destination = build / "linux-amd64"
backup = build / ".previous-linux-amd64"
if payload.parent.parent != build or not payload.parent.name.startswith(".staging."):
    raise SystemExit("Refusing to publish an unexpected staging payload.")
if backup.exists() or backup.is_symlink():
    if backup.is_dir() and not backup.is_symlink():
        shutil.rmtree(backup)
    else:
        backup.unlink()
if destination.exists() or destination.is_symlink():
    os.replace(destination, backup)
try:
    os.replace(payload, destination)
    destination.chmod(0o755)
except Exception:
    if backup.exists() or backup.is_symlink():
        os.replace(backup, destination)
    raise
if backup.exists() or backup.is_symlink():
    if backup.is_dir() and not backup.is_symlink():
        shutil.rmtree(backup)
    else:
        backup.unlink()
PY

printf 'Built %s from revision %s (dirty=%s, versionIdentity=%s).\n' \
  "$build_root/linux-amd64" "$revision" "$dirty" "$version_identity"
