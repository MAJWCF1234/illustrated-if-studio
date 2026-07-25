# Illustrated IF Studio — quiet launcher
# Started hidden by "Illustrated IF Studio.vbs" so the user never sees a black
# console. Handles first-run setup with friendly pop-ups instead of terminal text.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $here
Set-Location $Root

$wsh = New-Object -ComObject WScript.Shell

# WScript.Shell.Popup button/icon flags
$BTN_OK        = 0x0
$BTN_OKCANCEL  = 0x1
$ICON_STOP     = 0x10
$ICON_INFO     = 0x40
$RET_OK        = 1

function Show-Info([string]$msg)  { [void]$wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_OK -bor $ICON_INFO) }
function Show-Error([string]$msg) { [void]$wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_OK -bor $ICON_STOP) }
function Ask-OkCancel([string]$msg) { return ($wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_OKCANCEL -bor $ICON_INFO) -eq $RET_OK) }

function Refresh-EnvPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Have-Node { return [bool](Get-Command node -ErrorAction SilentlyContinue) }

$emergencySetup = Join-Path $here "emergency\SETUP-ADMIN.bat"

# --- 1. Make sure Node.js is available -------------------------------------
Refresh-EnvPath
if (-not (Have-Node)) {
  $go = Ask-OkCancel(@"
Welcome to Illustrated IF Studio!

Before the studio can open, Windows needs to finish a quick one-time setup.
In a moment Windows will ask for permission — please click YES.

This needs an internet connection and only happens once.

Click OK to continue, or Cancel to do it later.
"@)
  if (-not $go) { exit 1 }

  if (-not (Test-Path $emergencySetup)) {
    Show-Error("Setup file is missing:`n$emergencySetup`n`nPlease re-download / re-unzip the studio folder.")
    exit 1
  }

  # SETUP-ADMIN.bat self-elevates (UAC) and installs Node via winget. Wait for it.
  try {
    Start-Process -FilePath $emergencySetup -Wait
  } catch {
    Show-Error("Setup could not start.`n`nOpen the 'tools\emergency' folder and double-click SETUP-ADMIN.bat, then try again.")
    exit 1
  }

  Refresh-EnvPath
  if (-not (Have-Node)) {
    Show-Error(@"
The studio still can't find what it needs to run.

Open the 'tools\emergency' folder, double-click SETUP-ADMIN.bat, and let it
finish (click YES on the Windows prompt). Then double-click
'Illustrated IF Studio' again.
"@)
    exit 1
  }
}

# --- 2. Make sure Electron (the app window) is installed --------------------
$electronCli = Join-Path $Root "node_modules\electron\cli.js"
if (-not (Test-Path $electronCli)) {
  Show-Info(@"
Illustrated IF Studio is getting ready for the first time.

This takes a minute and needs the internet. Click OK, then please wait —
the studio window will open on its own when it's ready.
"@)
  try {
    & npm.cmd install --no-fund --no-audit electron@^37.10.3 | Out-Null
  } catch {
    Show-Error("First-time setup failed (are you online?).`n`nCheck your internet connection and double-click 'Illustrated IF Studio' again.")
    exit 1
  }
  if (-not (Test-Path $electronCli)) {
    Show-Error("First-time setup didn't finish.`n`nCheck your internet connection and double-click 'Illustrated IF Studio' again.")
    exit 1
  }
}

# --- 3. Launch the studio window (Electron) --------------------------------
try {
  & node $electronCli $Root
} catch {
  Show-Error("The studio ran into a problem while starting.`n`nTry once more. If it keeps happening, open 'tools\emergency\RUN-EDITOR.bat' to see the details.")
  exit 1
}
exit $LASTEXITCODE
