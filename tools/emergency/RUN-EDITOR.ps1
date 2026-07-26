# Illustrated IF Studio - launch editor as an Electron desktop app
[CmdletBinding()]
param(
  [switch]$Headless,
  [switch]$ReuseServer,
  [int]$Port = 8787,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
# Lives in tools\emergency\ - studio root is two folders up.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent (Split-Path -Parent $here)
Set-Location $Root

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }

# Prefer local node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found on PATH. Install Node 18+ then re-run." -ForegroundColor Red
  exit 1
}

Write-Step "Studio root: $Root"
Write-Step "Node: $($node.Source) ($(& node -v))"

$env:PORT = "$Port"
if ($Headless) { $env:IF_ELECTRON_HEADLESS = "1" } else { Remove-Item Env:IF_ELECTRON_HEADLESS -ErrorAction SilentlyContinue }
if ($ReuseServer) { $env:IF_REUSE_SERVER = "1" } else { Remove-Item Env:IF_REUSE_SERVER -ErrorAction SilentlyContinue }

$electronPkg = Join-Path $Root "node_modules\electron\package.json"
if (-not (Test-Path $electronPkg) -and -not $SkipInstall) {
  Write-Step "Installing electron (one-time)..."
  npm install --no-fund --no-audit electron@^37.10.3
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$electronCli = Join-Path $Root "node_modules\electron\cli.js"
if (-not (Test-Path $electronCli)) {
  Write-Host "electron package missing. Run: npm install electron" -ForegroundColor Red
  exit 1
}

Write-Step "Launching Electron editor on port $Port..."
Write-Host "  Editor URL will be http://127.0.0.1:$Port/editor-web/"
Write-Host "  Close the window to stop (server child exits with the app)."
Write-Host ""

# electron.cmd / cli.js - pass studio root as app path
& node $electronCli $Root @args
exit $LASTEXITCODE
