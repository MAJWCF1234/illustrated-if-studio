# SETUP-ADMIN.ps1 — Python package prerequisites
# Elevates to Administrator, installs Python 3 (with tkinter) via winget.

param([switch]$Launch)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "_common.ps1")

if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList @($(if ($Launch) { "-Launch" }))) {
  exit 0
}

Write-Host "=== Illustrated IF — Python package setup (Admin) ===" -ForegroundColor Cyan
Write-Host "Folder: $here"

function Find-Python {
  foreach ($cmd in @("py", "python", "python3")) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    # Skip Windows Store stub
    if ($c.Source -match "WindowsApps|System32\\Python") { continue }
    try {
      $out = & $c.Source -c "import sys,tkinter; print(sys.version.split()[0])" 2>$null
      if ($out) { return @{ Exe = $c.Source; Version = $out.Trim(); Launcher = $cmd } }
    } catch {}
  }
  # py -3
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    try {
      $out = & py -3 -c "import sys,tkinter; print(sys.version.split()[0])" 2>$null
      if ($out) { return @{ Exe = "py -3"; Version = $out.Trim(); Launcher = "py" } }
    } catch {}
  }
  return $null
}

Refresh-Path
$found = Find-Python
if ($found) {
  Write-Host "Python already present: $($found.Version) ($($found.Exe))"
} else {
  Install-WingetPackage -Id "Python.Python.3.12" -Name "Python 3.12"
  Refresh-Path
  $found = Find-Python
  if (-not $found) { throw "Python installed but not found on PATH. Open a new Admin terminal and re-run." }
  Write-Host "Installed Python: $($found.Version)"
}

# Ensure pip works (stdlib UI needs no pip packages)
try {
  if ($found.Launcher -eq "py") { & py -3 -m pip --version | Out-Null }
  else { & $found.Exe -m pip --version | Out-Null }
} catch {
  Write-Host "pip check skipped (optional for this package)." -ForegroundColor DarkYellow
}

$marker = Join-Path $here ".prereqs-ok"
Set-Content -Path $marker -Value "python=$($found.Version)`n$(Get-Date -Format o)" -Encoding utf8

Write-Host ""
Write-Host "Prerequisites ready." -ForegroundColor Green
Write-Host "Play: double-click PLAY.bat  or  python app.py"

if ($Launch) {
  Start-Process -FilePath (Join-Path $here "PLAY.bat")
}

Write-Done "Python setup complete."
