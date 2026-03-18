# ============================================================
#  Crea accesos directos en el Escritorio con iconos
# ============================================================

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop  = [Environment]::GetFolderPath("Desktop")
$shell    = New-Object -ComObject WScript.Shell

# ── INICIAR ───────────────────────────────────────────────────
$shortcut = $shell.CreateShortcut("$desktop\Inventario Lab — INICIAR.lnk")
$shortcut.TargetPath       = "powershell.exe"
$shortcut.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\iniciar.ps1`""
$shortcut.WorkingDirectory = $rootDir
$shortcut.Description      = "Iniciar todos los servicios del Inventario de Laboratorio"
# Icono llamativo: escudo/laboratorio de imageres del sistema
$shortcut.IconLocation     = "%SystemRoot%\System32\SHELL32.dll,167"
$shortcut.WindowStyle      = 1
$shortcut.Save()

Write-Host "  ✔  Acceso directo INICIAR creado en el escritorio" -ForegroundColor Green

# ── DETENER ───────────────────────────────────────────────────
$shortcut2 = $shell.CreateShortcut("$desktop\Inventario Lab — DETENER.lnk")
$shortcut2.TargetPath       = "powershell.exe"
$shortcut2.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\detener.ps1`""
$shortcut2.WorkingDirectory = $rootDir
$shortcut2.Description      = "Detener todos los servicios del Inventario de Laboratorio"
$shortcut2.IconLocation     = "%SystemRoot%\System32\SHELL32.dll,131"
$shortcut2.WindowStyle      = 1
$shortcut2.Save()

Write-Host "  ✔  Acceso directo DETENER creado en el escritorio" -ForegroundColor Green
Write-Host ""
Write-Host "  Los accesos directos están en tu Escritorio." -ForegroundColor Cyan
Write-Host ""
Read-Host "  Presiona ENTER para cerrar"
