# Illustrated IF Studio — install Node LTS (admin) for developing/running the studio
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "server\templates\windows\_common.ps1")

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
Write-Host "Start studio (browser):  npm start" -ForegroundColor Green
Write-Host "  then open:             http://127.0.0.1:8787/editor-web/"
Write-Host "Start studio (desktop):  .\RUN-EDITOR.bat" -ForegroundColor Green
Write-Host "  (Electron window; installs Electron on first launch if needed)"
Write-Done "Studio prerequisites ready."
