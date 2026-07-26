# SETUP-ADMIN.ps1 - Python package prerequisites
# Lives in _emergency\; package root (app.py, .venv) is the parent folder.

param([switch]$Launch)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgRoot = Split-Path -Parent $here
if (-not (Test-Path (Join-Path $pkgRoot "app.py"))) {
  if (Test-Path (Join-Path $here "app.py")) { $pkgRoot = $here }
}
. (Join-Path $here "_common.ps1")

if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList @($(if ($Launch) { "-Launch" }))) {
  exit 0
}

Write-Host "=== Illustrated IF - Python package setup (Admin) ===" -ForegroundColor Cyan
Write-Host "Package: $pkgRoot"

function Find-Python {
  foreach ($cmd in @("py", "python", "python3")) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    if ($c.Source -match "WindowsApps|System32\\Python") { continue }
    try {
      $out = & $c.Source -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return @{ Exe = $c.Source; Version = $out.Trim(); Launcher = $cmd } }
    } catch {}
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    try {
      $out = & py -3 -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return @{ Exe = $py.Source; Version = $out.Trim(); Launcher = "py" } }
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

# Pre-install game libraries (pygame) into a local .venv so first PLAY is instant.
$venv = Join-Path $pkgRoot ".venv"
$venvPy = Join-Path $venv "Scripts\python.exe"
$req = Join-Path $pkgRoot "requirements.txt"
try {
  if (-not (Test-Path $venvPy)) {
    Write-Host "Creating game environment (.venv)..." -ForegroundColor Cyan
    if ($found.Launcher -eq "py") { & py -3 -m venv $venv } else { & $found.Exe -m venv $venv }
  }
  if ((Test-Path $venvPy) -and (Test-Path $req)) {
    Write-Host "Installing game libraries (pygame)..." -ForegroundColor Cyan
    & $venvPy -m pip install --disable-pip-version-check -r $req | Out-Host
    if ($LASTEXITCODE -eq 0) {
      Set-Content -Path (Join-Path $venv ".deps-ok") -Value "ok" -Encoding utf8
      Write-Host "Game libraries ready." -ForegroundColor Green
    } else {
      Write-Host "Could not download game libraries now (offline?). PLAY.bat will retry automatically." -ForegroundColor DarkYellow
    }
  }
} catch {
  Write-Host "Game library pre-install skipped: $_" -ForegroundColor DarkYellow
  Write-Host "PLAY.bat will install them automatically on first launch." -ForegroundColor DarkYellow
}

$marker = Join-Path $pkgRoot ".prereqs-ok"
Set-Content -Path $marker -Value "python=$($found.Version)`n$(Get-Date -Format o)" -Encoding utf8

Write-Host ""
Write-Host "Prerequisites ready." -ForegroundColor Green
Write-Host "Play: double-click ""Play the Game""  (or PLAY.bat)"

if ($Launch) {
  $vbs = Join-Path $pkgRoot "Play the Game.vbs"
  if (Test-Path $vbs) { Start-Process -FilePath $vbs }
  else { Start-Process -FilePath (Join-Path $pkgRoot "PLAY.bat") }
}

Write-Done "Python setup complete."
