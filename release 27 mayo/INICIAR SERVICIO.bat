@echo off
title Iniciar Inventario Laboratorio
cd /d "%~dp0"
cls

echo =================================================================
echo  INICIANDO SERVICIOS DE INVENTARIO - LABORATORIO CLINICO
echo =================================================================
echo.

:: 1. Verificar Docker
echo [1/3] Verificando Docker Desktop...
docker info >nul 2>&1
if %errorlevel% EQU 0 goto docker_ok

echo.
echo  [WARN] Docker no esta corriendo. Intentando iniciar Docker Desktop...
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
) else (
    echo  [ERROR] No se encontro Docker Desktop en la ruta por defecto.
    echo  Por favor, inicia Docker Desktop manualmente y vuelve a ejecutar este script.
    pause
    exit /b 1
)

echo  Esperando a que Docker se inicie (maximo 60s)...
set /a count=0

:wait_docker
ping -n 4 127.0.0.1 >nul
set /a count+=3
docker info >nul 2>&1
if %errorlevel% EQU 0 goto docker_ok
if %count% geq 60 goto docker_fail
echo  Esperando... %count% segundos...
goto wait_docker

:docker_fail
echo  [ERROR] Docker tardo demasiado en responder.
echo  Por favor, inicia Docker Desktop manualmente y vuelve a ejecutar este script.
pause
exit /b 1

:docker_ok
echo  [OK] Docker esta activo.
echo.

:: 2. Levantar la base de datos (PostgreSQL)
echo [2/3] Levantando base de datos PostgreSQL...
docker compose up -d db
if %errorlevel% NEQ 0 (
    echo.
    echo  [ERROR] Error al iniciar el contenedor de base de datos.
    echo  Asegurate de que el puerto 5432 no este ocupado por otro servicio.
    pause
    exit /b 1
)
echo  [OK] Contenedor de base de datos iniciado.
echo.

:: 3. Esperar a que la base de datos este lista para recibir conexiones
echo  Esperando que la base de datos este lista para aceptar conexiones...
set /a count=0

:wait_db
ping -n 3 127.0.0.1 >nul
set /a count+=2
docker compose exec db pg_isready -U lab_user -d inventario_lab >nul 2>&1
if %errorlevel% EQU 0 goto db_ready
if %count% geq 30 goto db_timeout
goto wait_db

:db_timeout
echo  [WARN] La base de datos esta tardando en responder. Intentando continuar de todos modos...
goto db_ready

:db_ready
echo  [OK] Base de datos lista.
echo.

:: 4. Iniciar el Backend (y servir frontend)
echo [3/3] Iniciando el servidor de la aplicacion...
echo  (El servidor correra en segundo plano en una consola minimizada)
start "Backend Inventario Lab" /min cmd /c "inventario-lab-backend.exe"

:: Esperar unos segundos a que levante el servidor
ping -n 4 127.0.0.1 >nul

:: 5. Abrir navegador
echo.
echo =================================================================
echo  SERVICIOS LISTOS:
echo   - Base de Datos  : localhost:5432
echo   - Aplicacion Web : http://localhost:8080
echo.
echo  Para detener los servicios, ejecuta 'DETENER SERVICIO.bat'
echo =================================================================
echo.

start http://localhost:8080
ping -n 6 127.0.0.1 >nul
