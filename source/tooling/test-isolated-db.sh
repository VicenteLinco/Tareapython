#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# OPS-TEST-WRAPPER-001: Ephemeral DB Isolation Harness
# ==============================================================================
# Ensures tests run against a disposable, ephemeral PostgreSQL container.
# Rejects inherited DATABASE_URL or remote databases before creating pool.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Function to sanitize DB URL for logging (redacts passwords)
sanitize_url() {
  local raw_url="$1"
  echo "$raw_url" | sed -E 's|://[^@]+@|://*****@|g'
}

# Validate URL is strictly local and uses a test database name
validate_db_url() {
  local db_url="$1"

  # Reject empty
  if [[ -z "$db_url" ]]; then
    echo "ERROR: DATABASE_URL is empty" >&2
    return 1
  fi

  # Check host: allow only loopback, localhost, 127.0.0.1, ::1, or local container IPs
  if echo "$db_url" | grep -qE '@(neon\.tech|rds\.amazonaws\.com|render\.com|\.cloud|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})'; then
    echo "SECURITY ERROR [OPS-TEST-WRAPPER-001]: Remote database host detected in URL '$(sanitize_url "$db_url")'. Refusing execution." >&2
    return 1
  fi

  # Must contain loopback or container network host
  if ! echo "$db_url" | grep -qE '@(localhost|127\.0\.0\.1|::1|postgres|db|172\.[0-9]+\.|10\.[0-9]+\.)'; then
    echo "SECURITY ERROR [OPS-TEST-WRAPPER-001]: Non-loopback database host detected in URL '$(sanitize_url "$db_url")'. Refusing execution." >&2
    return 1
  fi

  # Validate database name has test prefix or suffix
  local db_name
  db_name="$(echo "$db_url" | sed -E 's|^.*[/:]([a-zA-Z0-9_]+)(\?.*)?$|\1|')"

  if ! echo "$db_name" | grep -qE '(^test_|_test$|^test$|test_db)'; then
    echo "SECURITY ERROR [OPS-TEST-WRAPPER-001]: Database name '$db_name' does not contain 'test' prefix/suffix. Refusing execution." >&2
    return 1
  fi

  return 0
}

# Self-test handler
run_self_test() {
  echo "=== Running OPS-TEST-WRAPPER-001 Self-Test ==="

  # Test 1: Canary Remote URL Rejection
  local canary_remote="postgres://user:secret123@ep-remote-canary.neon.tech/production_db"
  echo "[Self-Test 1/3] Testing rejection of remote canary URL..."
  if validate_db_url "$canary_remote" 2>/dev/null; then
    echo "FAIL: Remote canary URL was unexpectedly accepted!" >&2
    exit 1
  else
    echo "PASS: Remote canary URL correctly rejected before process/pool creation."
  fi

  # Test 2: Non-test DB Name Rejection
  local canary_prod="postgres://postgres:pass@127.0.0.1:5432/production_data"
  echo "[Self-Test 2/3] Testing rejection of production DB name..."
  if validate_db_url "$canary_prod" 2>/dev/null; then
    echo "FAIL: Production DB name was unexpectedly accepted!" >&2
    exit 1
  else
    echo "PASS: Production DB name correctly rejected."
  fi

  # Test 3: Happy Path validation
  local canary_valid="postgres://postgres:pass@127.0.0.1:54321/test_db_canary"
  echo "[Self-Test 3/3] Testing validation of valid local test DB URL..."
  if validate_db_url "$canary_valid" >/dev/null 2>&1; then
    echo "PASS: Local test DB URL accepted."
  else
    echo "FAIL: Local test DB URL was unexpectedly rejected!" >&2
    exit 1
  fi

  echo "=== All Self-Test Canary Verification Checks Passed! ==="
  exit 0
}

# Parse flags
WORKDIR=""
COMMAND=()
IS_SELF_TEST=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --self-test)
      IS_SELF_TEST=true
      shift
      ;;
    --workdir)
      WORKDIR="$2"
      shift 2
      ;;
    --)
      shift
      COMMAND=("$@")
      break
      ;;
    *)
      if [[ "$IS_SELF_TEST" == false && ${#COMMAND[@]} -eq 0 ]]; then
        COMMAND=("$@")
        break
      fi
      shift
      ;;
  esac
done

if [[ "$IS_SELF_TEST" == true ]]; then
  run_self_test
fi

if [[ ${#COMMAND[@]} -eq 0 ]]; then
  echo "Usage: $0 [--workdir <dir>] -- <command> [args...]" >&2
  echo "       $0 --self-test" >&2
  exit 1
fi

# Step 1: Wipe inherited environment variables
unset DATABASE_URL
unset POSTGRES_URL
unset SQLX_OFFLINE
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

# Step 2: Determine random port and unique container name
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()')
DB_NAME="test_db_${PORT}"
CONTAINER_NAME="test-pg-${PORT}-$$"

# Step 3: Setup Trap to ensure cleanup on exit or signal
cleanup() {
  local exit_code=$?
  echo "[OPS-TEST-WRAPPER-001] Cleaning up ephemeral PostgreSQL container $CONTAINER_NAME..." >&2
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  exit $exit_code
}
trap cleanup EXIT INT TERM HUP

# Step 4: Launch ephemeral PostgreSQL container
echo "[OPS-TEST-WRAPPER-001] Spawning ephemeral PostgreSQL container on port $PORT..." >&2
docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB="$DB_NAME" \
  -p "$PORT:5432" \
  postgres:16-alpine >/dev/null

# Step 5: Wait for Postgres to be ready
echo "[OPS-TEST-WRAPPER-001] Waiting for PostgreSQL to accept connections..." >&2
READY=false
for i in {1..30}; do
  if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 0.5
done

if [[ "$READY" != true ]]; then
  echo "[OPS-TEST-WRAPPER-001] ERROR: PostgreSQL container failed to become ready in time." >&2
  exit 1
fi
sleep 2

# Step 6: Construct and validate isolated DATABASE_URL
ISOLATED_URL="postgres://postgres:testpass@127.0.0.1:${PORT}/${DB_NAME}?sslmode=disable"
validate_db_url "$ISOLATED_URL"

export DATABASE_URL="$ISOLATED_URL"
echo "[OPS-TEST-WRAPPER-001] Isolated DATABASE_URL set to: $(sanitize_url "$DATABASE_URL")" >&2

# Step 7: Ephemeral DB ready for application/test migration runner
echo "[OPS-TEST-WRAPPER-001] Ephemeral PostgreSQL ready for test runner." >&2

# Step 8: Execute command in target directory
if [[ -n "$WORKDIR" ]]; then
  echo "[OPS-TEST-WRAPPER-001] Changing directory to $WORKDIR..." >&2
  cd "${PROJECT_ROOT}/${WORKDIR}" || cd "$WORKDIR"
fi

echo "[OPS-TEST-WRAPPER-001] Executing command: ${COMMAND[*]}" >&2
"${COMMAND[@]}"
