# Illustrated IF Studio - install Node LTS (admin) for developing/running the studio
# Lives in tools\emergency\ - studio root is two folders up.
#
# Two ways in:
#   SETUP-ADMIN.bat          - someone double-clicked it; talk to them in the console
#   -Quiet -LogPath <file>   - driven by "Illustrated IF Studio.exe"; say nothing, log everything
[CmdletBinding()]
param(
  [switch]$Quiet,
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$studioRoot = Split-Path -Parent (Split-Path -Parent $here)
. (Join-Path $studioRoot "server\templates\windows\_common.ps1")

function Note([string]$message) {
  Write-Host $message
  if ($LogPath) { try { Add-Content -Path $LogPath -Value "  setup | $message" } catch {} }
}

if (-not (Test-IsAdmin)) {
  $forward = @()
  if ($Quiet) { $forward += "-Quiet" }
  if ($LogPath) { $forward += @("-LogPath", "`"$LogPath`"") }
  if ($Quiet) {
    # The launcher is waiting on us - elevate, wait, and hand back the real exit code.
    $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$($MyInvocation.MyCommand.Path)`"") + $forward
    $child = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $psArgs -WindowStyle Hidden -Wait -PassThru
    exit $child.ExitCode
  }
  if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList $forward) { exit 0 }
}

if ($LogPath) { try { Start-Transcript -Path $LogPath -Append | Out-Null } catch {} }

try {
  Note "=== Illustrated IF Studio setup (Admin) ==="
  Refresh-Path

  $nodeOk = $false
  try {
    $v = & node -v 2>$null
    if ($v) { Note "Node present: $v"; $nodeOk = $true }
  } catch {}

  if (-not $nodeOk) {
    Note "Installing Node.js LTS..."
    Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
    Refresh-Path
    Note "Installed Node: $(node -v)"
  }
} catch {
  Note "FAILED: $($_.Exception.Message)"
  if ($LogPath) { try { Stop-Transcript | Out-Null } catch {} }
  if (-not $Quiet) {
    Write-Host ""
    Write-Host "Setup could not finish. Check your internet connection and try again." -ForegroundColor Red
    Write-Done "Setup failed."
  }
  exit 1
}

if ($LogPath) { try { Stop-Transcript | Out-Null } catch {} }
if ($Quiet) { exit 0 }

Write-Host ""
Write-Host "All set. You can close this window and go back to the studio folder." -ForegroundColor Green
Write-Host "Double-click 'Illustrated IF Studio' to open the studio." -ForegroundColor Green
Write-Host "(Advanced/dev: 'npm start' for the browser editor, or tools\emergency\RUN-EDITOR.bat for the desktop app.)"
Write-Done "Studio prerequisites ready."
