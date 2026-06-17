#!/bin/bash
# Script para iniciar los sistemas de Inventario Laboratorio Clínico en Linux

# Obtener directorio del script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=================================================="
echo "   INICIAR INVENTARIO - LABORATORIO CLINICO"
echo "=================================================="
echo ""

# 1. Verificar socket de Podman o Docker daemon
echo "[1/4] Verificando Docker/Podman..."
PODMAN_SOCKET="/run/user/$(id -u)/podman/podman.sock"

if [ -S "$PODMAN_SOCKET" ]; then
    export DOCKER_HOST="unix://$PODMAN_SOCKET"
    echo "OK: Detectado Podman rootless (socket activo)."
elif docker info >/dev/null 2>&1; then
    echo "OK: Docker estándar corriendo."
else
    echo "ERROR: Docker/Podman no está corriendo o no es accesible."
    echo "Por favor, inicia Docker o el servicio de Podman socket."
    echo ""
    read -p "Presiona Enter para salir..."
    exit 1
fi

# 2. Levantar contenedores mediante docker-compose
echo ""
echo "[2/4] Levantando contenedores (Base de datos y Backend)..."
docker-compose up --build -d
if [ $? -ne 0 ]; then
    echo "ERROR: Falló docker-compose up."
    echo ""
    read -p "Presiona Enter para salir..."
    exit 1
fi
echo "OK: Contenedores iniciados."

# 3. Esperar backend
echo ""
echo "[3/4] Esperando que el backend esté listo en puerto 8080..."
backend_ok=false
for i in {1..20}; do
    sleep 3
    if curl -s http://localhost:8080/health > /dev/null; then
        backend_ok=true
        break
    fi
    echo "     Intento $i/20..."
done

if [ "$backend_ok" = true ]; then
    echo "OK: Backend listo."
else
    echo "WARN: El backend está tardando en iniciar, continuando..."
fi

# 4. Iniciar frontend (React / Vite)
echo ""
echo "[4/4] Iniciar frontend (npm run dev)..."
echo "Abriendo el navegador en http://localhost:5173..."
sleep 2

# Abrir navegador en segundo plano
if command -v xdg-open > /dev/null; then
    xdg-open http://localhost:5173 &
elif command -v sensible-browser > /dev/null; then
    sensible-browser http://localhost:5173 &
fi

# Correr el frontend en primer plano para ver los logs
cd "$DIR/frontend"
npm run dev
