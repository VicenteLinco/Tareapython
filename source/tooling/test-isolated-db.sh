#!/bin/bash
set -eo pipefail

SELF_TEST=0
if [[ "$1" == "--self-test" ]]; then
    SELF_TEST=1
    shift
fi

COMMAND=""
if [[ "$1" == "--" ]]; then
    shift
    COMMAND="$@"
elif [[ -n "$1" ]]; then
    COMMAND="$@"
fi

# Elimina DATABASE_URL heredado
unset DATABASE_URL
if [[ -f source/backend/.env ]]; then
    # We must not load .env for tests. 
    # Just in case, ensure no tools do it implicitly.
    :
fi

PORT=5434
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${PORT}/test_db_isolated"

# Parsea host y nombre
HOST=$(echo "$DATABASE_URL" | sed -E 's|^postgres://.*@([^:/]+).*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|^postgres://.*/([^?]+).*|\1|')

# Rechaza remoto
if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
    echo "Error: Host remoto detectado ($HOST)."
    exit 1
fi

# Rechaza base de datos sin test
if [[ ! "$DB_NAME" =~ test ]]; then
    echo "Error: Base de datos no es de prueba ($DB_NAME)."
    exit 1
fi

if [[ "$SELF_TEST" -eq 1 ]]; then
    # Probar canario remoto (simulado por variable de entorno para la prueba)
    if [[ "$TEST_CANARY" == "1" ]]; then
        export DATABASE_URL="postgres://postgres:postgres@remote.host.com/prod_db"
        HOST=$(echo "$DATABASE_URL" | sed -E 's|^postgres://.*@([^:/]+).*|\1|')
        if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
            echo "Rechazo exitoso de canario remoto."
            exit 0
        fi
        echo "Error: El canario remoto no fue rechazado."
        exit 1
    fi
    echo "Self-test completado."
    exit 0
fi

# Crea DB efímera
CONTAINER_NAME="pg-isolated-test-$$"

cleanup() {
    echo "Destruyendo DB efímera..."
    docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --name "$CONTAINER_NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$DB_NAME" -p "$PORT":5432 -d postgres:16-alpine > /dev/null

# Espera a que esté lista
until docker exec "$CONTAINER_NAME" pg_isready -U postgres -d "$DB_NAME" > /dev/null 2>&1; do
    sleep 0.5
done

echo "Base de datos aislada lista."

# Migraciones
if [[ -d source/backend/migrations ]]; then
    echo "Aplicando migraciones..."
    cd source/backend
    sqlx migrate run
    cd ../..
fi

if [[ -n "$COMMAND" ]]; then
    echo "Ejecutando: $COMMAND"
    eval "$COMMAND"
fi
