# ============================================================
#  INVENTARIO LABORATORIO CLINICO -- Detener Servicios
# ============================================================

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Clear-Host
Write-Host ""
Write-Host "  +-------------------------------------------------+" -ForegroundColor Red
Write-Host "  |      INVENTARIO LAB -- Deteniendo servicios     |" -ForegroundColor Red
Write-Host "  +-------------------------------------------------+" -ForegroundColor Red
Write-Host ""

try {
    # Detener procesos node (frontend Vite)
    $nodes = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if ($nodes) {
        $nodes | Stop-Process -Force
        Write-Host "   OK   Frontend (Node/Vite) detenido" -ForegroundColor Green
    } else {
        Write-Host "   --   Frontend ya estaba detenido" -ForegroundColor DarkGray
    }

    # Docker Compose down
    Set-Location $rootDir
    $out = docker compose down 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   OK   Contenedores Docker detenidos" -ForegroundColor Green
    } else {
        Write-Host "  WARN  Error al detener contenedores:" -ForegroundColor DarkYellow
        Write-Host ($out | Out-String) -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "  Todos los servicios han sido detenidos." -ForegroundColor Cyan

} catch {
    Write-Host "  FAIL  Error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "  Presiona ENTER para cerrar..." -ForegroundColor DarkGray
$null = Read-Host
