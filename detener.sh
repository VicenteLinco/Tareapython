#!/bin/bash
# Script para detener los sistemas de Inventario Laboratorio Clínico en Linux

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=================================================="
echo "   DETENER INVENTARIO - LABORATORIO CLINICO"
echo "=================================================="
echo ""

# Configurar DOCKER_HOST si existe el socket de Podman
PODMAN_SOCKET="/run/user/$(id -u)/podman/podman.sock"
if [ -S "$PODMAN_SOCKET" ]; then
    export DOCKER_HOST="unix://$PODMAN_SOCKET"
fi

# 1. Detener frontend (Node/Vite)
echo "[1/2] Deteniendo Frontend (Node)..."
pkill -f "vite" || pkill -f "node.*dev" || echo "Frontend ya estaba detenido o no se pudo matar directamente."

# 2. Docker Compose down
echo ""
echo "[2/2] Deteniendo contenedores Docker/Podman..."
docker-compose down
if [ $? -eq 0 ]; then
    echo "OK: Contenedores detenidos."
else
    echo "WARN: Error al detener contenedores."
fi

echo ""
echo "Todos los servicios han sido detenidos."
echo ""
read -p "Presiona Enter para cerrar..."
