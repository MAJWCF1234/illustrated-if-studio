# Illustrated IF Studio — install Node LTS (admin) for developing/running the studio
# Lives in tools\emergency\ — studio root is two folders up.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$studioRoot = Split-Path -Parent (Split-Path -Parent $here)
. (Join-Path $studioRoot "server\templates\windows\_common.ps1")

if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path) { exit 0 }

Write-Host "=== Illustrated IF Studio setup (Admin) ===" -ForegroundColor Cyan

Refresh-Path
$nodeOk = $false
try {
  $v = & node -v 2>$null
  if ($v) { Write-Host "Node present: $v"; $nodeOk = $true }
} catch {}

if (-not $nodeOk) {
  Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  Refresh-Path
  Write-Host "Installed Node: $(node -v)"
}

Write-Host ""
Write-Host "All set. You can close this window and go back to the studio folder." -ForegroundColor Green
Write-Host "Double-click 'Illustrated IF Studio' to open the studio." -ForegroundColor Green
Write-Host "(Advanced/dev: 'npm start' for the browser editor, or tools\emergency\RUN-EDITOR.bat for the desktop app.)"
Write-Done "Studio prerequisites ready."
