@echo off
title Iniciar Inventario Laboratorio
cd /d "%~dp0"
cls

echo =================================================================
echo  INICIANDO SERVICIOS DE INVENTARIO - LABORATORIO CLINICO
echo =================================================================
echo.

echo [1/4] Verificando archivo de configuracion .env...
if not exist .env (
    if exist .env.example (
        echo  [INFO] Creando archivo de configuracion .env desde .env.example...
        copy .env.example .env >nul
        echo  [OK] Archivo .env creado.
    ) else (
        echo  [ERROR] No se encontro ni .env ni .env.example.
        echo  Por favor crea un archivo .env en esta carpeta.
        pause
        exit /b 1
    )
) else (
    echo  [OK] Archivo de configuracion .env detectado.
)
echo.

echo [2/4] Verificando Docker Desktop...
docker info >nul 2>&1
if %errorlevel% EQU 0 goto docker_ok

echo.
echo  [WARN] Docker no esta corriendo. Intentando iniciar Docker Desktop...
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
) else (
    echo  [ERROR] No se encontro Docker Desktop en la ruta por defecto.
    echo  Inicia Docker Desktop manualmente y vuelve a ejecutar este script.
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
pause
exit /b 1

:docker_ok
echo  [OK] Docker esta activo.
echo.

echo [3/4] Levantando base de datos PostgreSQL...
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

echo  Esperando que la base de datos acepte conexiones...
set /a count=0

:wait_db
ping -n 3 127.0.0.1 >nul
set /a count+=2
docker compose exec db pg_isready -U lab_user -d inventario_lab >nul 2>&1
if %errorlevel% EQU 0 goto db_ready
if %count% geq 30 goto db_timeout
goto wait_db

:db_timeout
echo  [WARN] La base de datos esta tardando en responder. Intentando continuar.
goto db_ready

:db_ready
echo  [OK] Base de datos lista.
echo.

echo [4/4] Iniciando el servidor de la aplicacion...
if exist server_log.txt del server_log.txt >nul 2>&1
start "Backend Inventario Lab" /min cmd /c "inventario-lab-backend.exe > server_log.txt 2>&1"

echo  Esperando a que el servidor se inicie (5s)...
ping -n 6 127.0.0.1 >nul

tasklist /fi "imagename eq inventario-lab-backend.exe" 2>nul | find /i "inventario-lab-backend" >nul
if %errorlevel% NEQ 0 (
    echo.
    echo  [ERROR] El servidor inventario-lab-backend.exe se cerro inesperadamente.
    echo.
    if exist server_log.txt (
        echo  --- REGISTRO DE ERROR ---
        powershell -Command "Get-Content server_log.txt -Tail 15" 2>nul || type server_log.txt
        echo  -------------------------
    ) else (
        echo  No se pudo encontrar o leer el archivo server_log.txt.
    )
    echo.
    echo  Por favor, verifica el error anterior e intenta de nuevo.
    pause
    exit /b 1
)

echo.
echo =================================================================
echo  SERVICIOS LISTOS:
echo   - Base de Datos  : localhost:5432
echo   - Aplicacion Web : http://localhost:8080
echo.
echo  Para detener los servicios, ejecuta "DETENER SERVICIO.bat"
echo =================================================================
echo.

start http://localhost:8080
ping -n 6 127.0.0.1 >nul
