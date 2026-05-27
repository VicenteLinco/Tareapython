@echo off
title Detener Inventario Laboratorio
cd /d "%~dp0"
cls

echo =================================================================
echo  DETENIENDO SERVICIOS DE INVENTARIO - LABORATORIO CLINICO
echo =================================================================
echo.

echo [1/2] Deteniendo servidor backend...
taskkill /im inventario-lab-backend.exe /f >nul 2>&1
if %errorlevel% EQU 0 (
    echo  [OK] Proceso del servidor finalizado.
) else (
    echo  [--] El servidor ya estaba detenido o no se inicio.
)
echo.

echo [2/2] Deteniendo base de datos (Docker Compose)...
docker compose down
if %errorlevel% EQU 0 (
    echo  [OK] Contenedor de base de datos detenido.
) else (
    echo  [WARN] Hubo un problema al detener el contenedor.
)
echo.

echo =================================================================
echo  Todos los servicios han sido detenidos.
echo =================================================================
echo.
ping -n 6 127.0.0.1 >nul
