# Illustrated IF — build a standalone Windows exe with PyInstaller
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "=== Build Illustrated IF exe ===" -ForegroundColor Cyan

# Prefer the game's private environment (created by PLAY.bat / SETUP-ADMIN.bat)
# so the frozen exe uses the same pygame install.
$py = $null
$venvPy = Join-Path $here ".venv\Scripts\python.exe"
if (Test-Path $venvPy) { $py = $venvPy }
if (-not $py) {
  foreach ($c in @("py", "python", "python3")) {
    try {
      $v = & $c --version 2>&1 | Out-String
      if ($LASTEXITCODE -eq 0 -and $v -match "Python 3") { $py = $c; break }
    } catch {}
  }
}
if (-not $py) {
  Write-Host "Python 3 not found. Run SETUP-ADMIN.bat or PLAY.bat first." -ForegroundColor Red
  exit 1
}

Write-Host "Using: $py ($(& $py --version))"
& $py -m pip install --upgrade --disable-pip-version-check pip pyinstaller | Out-Host
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $py -m pip install --disable-pip-version-check -r (Join-Path $here "requirements.txt") | Out-Host
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dist = Join-Path $here "dist-exe"
$work = Join-Path $here "build-exe"
New-Item -ItemType Directory -Force -Path $dist, $work | Out-Null

$name = "IllustratedIF"
if (Test-Path (Join-Path $here "project\project.json")) {
  try {
    $pj = Get-Content (Join-Path $here "project\project.json") -Raw | ConvertFrom-Json
    if ($pj.id) { $name = ($pj.id -replace '[^\w\-]+','-') }
  } catch {}
}

Write-Host "Building $name.exe (onefile, windowed)…"
& $py -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name $name `
  --distpath $dist `
  --workpath $work `
  --specpath $work `
  --add-data "project;project" `
  --add-data "if_engine;if_engine" `
  --add-data "if_gui;if_gui" `
  app.py

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done: $dist\$name.exe" -ForegroundColor Green
Write-Host "Double-click the exe to play (project data and pygame are bundled)."
Write-Host "Tip: keep PLAY.bat for editable source runs."
