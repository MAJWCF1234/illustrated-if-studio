# SETUP-ADMIN.ps1 - HTML package prerequisites (Node.js)
# Lives in _emergency\; package root is the parent folder.

param([switch]$Launch)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgRoot = Split-Path -Parent $here
if (-not (Test-Path (Join-Path $pkgRoot "start-server.mjs"))) {
  # Older layout: scripts at package root
  if (Test-Path (Join-Path $here "start-server.mjs")) { $pkgRoot = $here }
}
. (Join-Path $here "_common.ps1")

if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList @($(if ($Launch) { "-Launch" }))) {
  exit 0
}

Write-Host "=== Illustrated IF - HTML package setup (Admin) ===" -ForegroundColor Cyan
Write-Host "Package: $pkgRoot"

$nodeOk = $false
try {
  Refresh-Path
  $v = & node -v 2>$null
  if ($v) {
    Write-Host "Node already present: $v"
    $nodeOk = $true
  }
} catch {}

if (-not $nodeOk) {
  Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  Refresh-Path
  $v = & node -v
  Write-Host "Installed Node: $v"
}

$marker = Join-Path $pkgRoot ".prereqs-ok"
Set-Content -Path $marker -Value "node=$(node -v)`n$(Get-Date -Format o)" -Encoding utf8

Write-Host ""
Write-Host "Prerequisites ready." -ForegroundColor Green
Write-Host "Play: double-click ""Play the Game""  (or PLAY.bat)"

if ($Launch) {
  $vbs = Join-Path $pkgRoot "Play the Game.vbs"
  if (Test-Path $vbs) { Start-Process -FilePath $vbs }
  else { Start-Process -FilePath (Join-Path $pkgRoot "PLAY.bat") }
}

Write-Done "HTML setup complete."
