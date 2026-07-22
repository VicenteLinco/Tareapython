#!/usr/bin/env bash
set -euo pipefail

tooling_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
seed_file="$tooling_dir/dev-data/seed_dev.sql"

check_contract() {
  test -f "$seed_file"
  grep -Fq -- "DEV-ONLY: destructive seed" "$seed_file"
  command -v python3 >/dev/null
}

if [[ ${1:-} == "--check" ]]; then
  check_contract
  printf '%s\n' "Development seed guard is structurally valid."
  exit 0
fi

check_contract

if [[ ${ALLOW_DESTRUCTIVE_DEV_SEED:-} != "1" ]]; then
  printf '%s\n' "Refusing destructive seed: set ALLOW_DESTRUCTIVE_DEV_SEED=1 explicitly." >&2
  exit 2
fi

if [[ -z ${DATABASE_URL:-} ]]; then
  printf '%s\n' "Refusing destructive seed: DATABASE_URL must be provided explicitly." >&2
  exit 2
fi

mapfile -d '' connection_parts < <(
  python3 - "$DATABASE_URL" <<'PY'
from urllib.parse import unquote, urlparse
import sys

parsed = urlparse(sys.argv[1])
host = parsed.hostname or ""
database = parsed.path.removeprefix("/")
if parsed.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("Refusing destructive seed: unsupported database URL scheme.")
if host not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit("Refusing destructive seed: database host must be loopback.")
if not database.startswith(("inventario_lab_dev", "inventario_lab_test")):
    raise SystemExit("Refusing destructive seed: database name must use a dev/test prefix.")
for value in (
    host,
    str(parsed.port or 5432),
    database,
    unquote(parsed.username or ""),
    unquote(parsed.password or ""),
):
    sys.stdout.buffer.write(value.encode() + b"\0")
PY
)

if (( ${#connection_parts[@]} != 5 )); then
  printf '%s\n' "Refusing destructive seed: database URL could not be parsed safely." >&2
  exit 2
fi

export PGHOST=${connection_parts[0]}
export PGPORT=${connection_parts[1]}
export PGDATABASE=${connection_parts[2]}
export PGUSER=${connection_parts[3]}
export PGPASSWORD=${connection_parts[4]}
unset DATABASE_URL connection_parts

exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --file="$seed_file"
