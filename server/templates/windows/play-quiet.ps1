# Illustrated IF - quiet play orchestrator for exported games.
# Started hidden by "Play the Game.vbs". Uses MsgBox pop-ups, never leaves
# the player staring at a cmd prompt.

$ErrorActionPreference = "Stop"
$pkgRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $pkgRoot

$wsh = New-Object -ComObject WScript.Shell
$BTN_OK       = 0x0
$BTN_OKCANCEL = 0x1
$ICON_STOP    = 0x10
$ICON_INFO    = 0x40
$RET_OK       = 1

function Show-Info([string]$msg)  { [void]$wsh.Popup($msg, 0, "Illustrated IF", $BTN_OK -bor $ICON_INFO) }
function Show-Error([string]$msg) { [void]$wsh.Popup($msg, 0, "Illustrated IF", $BTN_OK -bor $ICON_STOP) }
function Ask-OkCancel([string]$msg) { return ($wsh.Popup($msg, 0, "Illustrated IF", $BTN_OKCANCEL -bor $ICON_INFO) -eq $RET_OK) }

function Refresh-EnvPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Get-EmergencyDir {
  $d = Join-Path $pkgRoot "_emergency"
  if (Test-Path $d) { return $d }
  return $pkgRoot  # older packages kept SETUP at root
}

function Get-SetupBat {
  $em = Get-EmergencyDir
  $p = Join-Path $em "SETUP-ADMIN.bat"
  if (Test-Path $p) { return $p }
  $p = Join-Path $pkgRoot "SETUP-ADMIN.bat"
  if (Test-Path $p) { return $p }
  return $null
}

function Invoke-Setup([string]$friendlyWhat) {
  $bat = Get-SetupBat
  if (-not $bat) {
    Show-Error("Setup helper is missing from this game folder.`n`nRe-unzip the game, or open the _emergency folder and follow README.txt.")
    return $false
  }
  $go = Ask-OkCancel(@"
This game needs a one-time setup on this PC ($friendlyWhat).

Windows will ask for permission - please click YES.
You'll need the internet. This only happens once.

Click OK to continue, or Cancel to stop.
"@)
  if (-not $go) { return $false }
  try {
    Start-Process -FilePath $bat -WorkingDirectory (Split-Path -Parent $bat) -Wait
  } catch {
    Show-Error("Setup couldn't start.`n`nOpen the _emergency folder and double-click SETUP-ADMIN.bat, then try Play again.")
    return $false
  }
  Refresh-EnvPath
  return $true
}

function Detect-Target {
  if (Test-Path (Join-Path $pkgRoot "app.py")) { return "python" }
  if (Test-Path (Join-Path $pkgRoot "CMakeLists.txt")) { return "cpp" }
  if (Test-Path (Join-Path $pkgRoot "start-server.mjs")) { return "html" }
  return "unknown"
}

function Have-Node { return [bool](Get-Command node -ErrorAction SilentlyContinue) }

function Find-Python {
  foreach ($cmd in @("py", "python", "python3")) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    if ($c.Source -match "WindowsApps|System32\\Python") { continue }
    try {
      $out = & $c.Source -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return $true }
    } catch {}
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    try {
      $out = & py -3 -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return $true }
    } catch {}
  }
  return $false
}

function Have-Cmake { return [bool](Get-Command cmake -ErrorAction SilentlyContinue) }

function Have-Cxx {
  foreach ($cmd in @("cl", "g++", "clang++")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { return $true }
  }
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($inst) { return $true }
  }
  return $false
}

function Start-PlayBat([switch]$Wait) {
  $play = Join-Path $pkgRoot "PLAY.bat"
  if (-not (Test-Path $play)) {
    Show-Error("PLAY.bat is missing from this game folder. Re-unzip and try again.")
    return
  }
  # Minimized console - game window (or browser) is the face; bat is plumbing.
  if ($Wait) {
    Start-Process -FilePath $play -WorkingDirectory $pkgRoot -WindowStyle Minimized -Wait
  } else {
    Start-Process -FilePath $play -WorkingDirectory $pkgRoot -WindowStyle Minimized
  }
}

# ---- main --------------------------------------------------------------------
Refresh-EnvPath
$target = Detect-Target

switch ($target) {
  "html" {
    if (-not (Have-Node)) {
      if (-not (Invoke-Setup "a small web helper called Node.js")) { exit 1 }
      if (-not (Have-Node)) {
        Show-Error("Node.js still isn't available.`n`nOpen _emergency, run SETUP-ADMIN.bat, then double-click Play the Game again.")
        exit 1
      }
    }
    Show-Info("Opening the game in your browser...`n`nA small helper window may stay minimized in the taskbar - that keeps the game running. Close it when you're done playing.")
    Start-PlayBat
  }
  "python" {
    $venvPy = Join-Path $pkgRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path $venvPy) -and -not (Find-Python)) {
      if (-not (Invoke-Setup "Python, so the game can run")) { exit 1 }
      Refresh-EnvPath
      if (-not (Find-Python) -and -not (Test-Path $venvPy)) {
        Show-Error("Python still isn't available.`n`nOpen _emergency, run SETUP-ADMIN.bat, then double-click Play the Game again.")
        exit 1
      }
    }
    # PLAY.bat creates .venv + installs pygame on first run; keep console minimized.
    Start-PlayBat -Wait
  }
  "cpp" {
    $needSetup = -not (Have-Cmake) -or -not (Have-Cxx)
    if ($needSetup) {
      $go = Ask-OkCancel(@"
This C++ game needs build tools the first time (CMake and a C++ compiler).

That download can be LARGE and may take a long while (sometimes 20-40 minutes).
You'll need the internet, and Windows will ask for permission - click YES.

After tools are installed, the first build also compiles game libraries (a few more minutes). Later plays are much faster.

Click OK to install and play, or Cancel to stop.
"@)
      if (-not $go) { exit 1 }
      $bat = Get-SetupBat
      if (-not $bat) {
        Show-Error("Setup helper is missing. Re-unzip the game folder.")
        exit 1
      }
      try {
        Start-Process -FilePath $bat -WorkingDirectory (Split-Path -Parent $bat) -Wait
      } catch {
        Show-Error("Setup couldn't start. Open _emergency and run SETUP-ADMIN.bat.")
        exit 1
      }
      Refresh-EnvPath
      if (-not (Have-Cmake) -or -not (Have-Cxx)) {
        Show-Error("Build tools still aren't ready.`n`nOpen _emergency, run SETUP-ADMIN.bat, wait until it finishes (it can take a long time), then try Play again.")
        exit 1
      }
    } else {
      Show-Info("Building and launching the game...`n`nThe first run can take a few minutes while it compiles. Later runs are quicker.")
    }
    Start-PlayBat -Wait
  }
  default {
    Show-Error("This doesn't look like a complete Illustrated IF game folder.`n`nRe-export from the studio, or ask whoever sent you the zip.")
    exit 1
  }
}
