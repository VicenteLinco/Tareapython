#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
build_root="$repo_root/build"

python3 - "$repo_root" "$build_root" <<'PY'
from pathlib import Path
import shutil
import sys

repo = Path(sys.argv[1]).resolve()
build = Path(sys.argv[2]).resolve()
if build != repo / "build" or build.parent != repo:
    raise SystemExit("Refusing to clean an unexpected build path.")
if not (build / ".gitignore").is_file():
    raise SystemExit("Refusing to clean build without its permanent .gitignore boundary.")

removed = 0
for child in list(build.iterdir()):
    if child.name == ".gitignore":
        continue
    if child.is_symlink() or child.is_file():
        child.unlink()
    elif child.is_dir():
        shutil.rmtree(child)
    else:
        raise SystemExit(f"Refusing unknown build child type: {child.name}")
    removed += 1

print(f"Cleaned {removed} generated build children; build/.gitignore preserved.")
PY

