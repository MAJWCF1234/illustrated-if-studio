# SETUP-ADMIN.ps1 — HTML package prerequisites (Node.js)
# Elevates to Administrator, installs Node LTS via winget, then can launch the game.

param([switch]$Launch)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "_common.ps1")

if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList @($(if ($Launch) { "-Launch" }))) {
  exit 0
}

Write-Host "=== Illustrated IF — HTML package setup (Admin) ===" -ForegroundColor Cyan
Write-Host "Folder: $here"

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

$marker = Join-Path $here ".prereqs-ok"
Set-Content -Path $marker -Value "node=$(node -v)`n$(Get-Date -Format o)" -Encoding utf8

Write-Host ""
Write-Host "Prerequisites ready." -ForegroundColor Green
Write-Host "Play: double-click PLAY.bat  or  run start-server.bat"
Write-Host "      Then open the URL shown in the terminal."

if ($Launch) {
  Start-Process -FilePath (Join-Path $here "PLAY.bat")
}

Write-Done "HTML setup complete."
