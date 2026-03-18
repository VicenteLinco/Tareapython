# INVENTARIO LABORATORIO CLINICO -- Lanzador de Servicios

$rootDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $rootDir "frontend"

function Write-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "  +-------------------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |                                                 |" -ForegroundColor Cyan
    Write-Host "  |   INVENTARIO  -  LABORATORIO CLINICO  v1.0     |" -ForegroundColor Cyan
    Write-Host "  |                                                 |" -ForegroundColor Cyan
    Write-Host "  +-------------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step { param([string]$n, [string]$msg)
    Write-Host "  [$n/4] $msg" -ForegroundColor Yellow
}
function Write-OK   { param([string]$msg) Write-Host "   OK   $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "  WARN  $msg" -ForegroundColor DarkYellow }
function Write-Fail { param([string]$msg) Write-Host "  FAIL  $msg" -ForegroundColor Red }
function Write-Sep  { Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray }

function Pause-Exit { param([int]$code = 0)
    Write-Host ""
    Write-Host "  Presiona ENTER para cerrar..." -ForegroundColor DarkGray
    $null = Read-Host
    exit $code
}

function Test-Docker {
    try {
        $null = docker info 2>&1
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

Write-Banner

# 1. Verificar Docker
Write-Step 1 "Verificando Docker Desktop..."
if (-not (Test-Docker)) {
    Write-Warn "Docker no esta corriendo. Intentando iniciar Docker Desktop..."
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
    } else {
        Write-Fail "No se encontro Docker Desktop. Instala Docker y vuelve a intentar."
        Pause-Exit 1
    }
    Write-Host "     Esperando Docker (max 90s)..." -ForegroundColor DarkGray
    $t = 0
    while (-not (Test-Docker) -and $t -lt 90) {
        Start-Sleep 3
        $t += 3
        Write-Host "     [$t s]" -ForegroundColor DarkGray
    }
    if (-not (Test-Docker)) {
        Write-Fail "Docker no respondio a tiempo. Abrelo manualmente y reintenta."
        Pause-Exit 1
    }
}
Write-OK "Docker esta corriendo"

# 2. Docker Compose (DB + Backend)
Write-Host ""
Write-Step 2 "Levantando base de datos y backend (Docker Compose)..."
Write-Host "     (Primera vez: compilara Rust, puede tardar varios minutos)" -ForegroundColor DarkGray
Write-Host ""
Set-Location $rootDir
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Fail "Error en docker compose up. Revisa los mensajes anteriores."
    Pause-Exit 1
}
Write-OK "Contenedores iniciados"

# 3. Esperar backend
Write-Host ""
Write-Step 3 "Esperando que el backend este listo en :8080..."
$backendOk = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep 3
    try {
        $r = Invoke-WebRequest "http://localhost:8080/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $backendOk = $true; break }
    } catch {}
    Write-Host "     Intento $i/20..." -ForegroundColor DarkGray
}
if ($backendOk) {
    Write-OK "Backend listo en http://localhost:8080"
} else {
    Write-Warn "Backend tardando (puede seguir iniciando en segundo plano)"
}

# 4. Frontend
Write-Host ""
Write-Step 4 "Iniciando frontend (npm run dev)..."
$npmArgs = "/k cd /d `"$frontendDir`" & npm run dev"
Start-Process "cmd.exe" -ArgumentList $npmArgs
Start-Sleep 3
Write-OK "Frontend iniciando en http://localhost:5173"

# Abrir navegador
Start-Sleep 2
Start-Process "http://localhost:5173"

# Resumen
Write-Host ""
Write-Sep
Write-Host "  SERVICIOS ACTIVOS:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Base de datos  -->  localhost:5432"        -ForegroundColor White
Write-Host "   Backend API    -->  http://localhost:8080" -ForegroundColor White
Write-Host "   Frontend       -->  http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "   Para detener: ejecuta 'DETENER LABORATORIO.bat'" -ForegroundColor DarkGray
Write-Sep

Pause-Exit 0
