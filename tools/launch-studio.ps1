# Illustrated IF Studio - quiet launcher
# Started hidden by "Illustrated IF Studio.vbs" / backup so the user never sees a
# black console. Handles first-run setup with friendly pop-ups instead of terminal text.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $here
Set-Location $Root

$wsh = New-Object -ComObject WScript.Shell

# WScript.Shell.Popup button/icon flags
$BTN_OK        = 0x0
$BTN_OKCANCEL  = 0x1
$BTN_YESNO     = 0x4
$ICON_STOP     = 0x10
$ICON_INFO     = 0x40
$ICON_QUESTION = 0x20
$RET_OK        = 1
$RET_YES       = 6

function Show-Info([string]$msg)  { [void]$wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_OK -bor $ICON_INFO) }
function Show-Error([string]$msg) { [void]$wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_OK -bor $ICON_STOP) }
function Ask-OkCancel([string]$msg) { return ($wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_OKCANCEL -bor $ICON_INFO) -eq $RET_OK) }
function Ask-YesNo([string]$msg) { return ($wsh.Popup($msg, 0, "Illustrated IF Studio", $BTN_YESNO -bor $ICON_QUESTION) -eq $RET_YES) }

function Refresh-EnvPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Have-Node { return [bool](Get-Command node -ErrorAction SilentlyContinue) }

function Test-RealPython {
  foreach ($cmd in @("py", "python", "python3")) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    if ($c.Source -match "WindowsApps|System32\\Python") { continue }
    try {
      $out = & $c.Source -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return $true }
    } catch {}
  }
  return $false
}

function Test-CppTools {
  if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { return $false }
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { return $false }
  $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  return [bool]$inst
}

function Test-StudioAnswering {
  # Electron may hop to preferredPort+N when something else holds 8787.
  $preferred = 8787
  if ($env:PORT -match '^\d+$') { $preferred = [int]$env:PORT }
  $rootNorm = $Root.TrimEnd('\', '/').Replace('/', '\')
  for ($delta = 0; $delta -lt 10; $delta++) {
    $port = $preferred + $delta
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 1
      if ($r.StatusCode -ne 200) { continue }
      $body = $r.Content
      if ($body -match '"studioRoot"\s*:\s*"([^"]+)"') {
        $studio = $Matches[1] -replace '\\\\', '\' -replace '/', '\'
        $studio = $studio.TrimEnd('\', '/')
        if ([string]::Equals($studio, $rootNorm, [StringComparison]::OrdinalIgnoreCase)) { return $true }
        continue
      }
      if ($body.IndexOf($rootNorm.Replace('\', '\\'), [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
      if ($body.IndexOf($rootNorm, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    } catch {}
  }
  return $false
}

function Wait-StudioAnswering([int]$seconds = 60) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-StudioAnswering) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Offer-ExportTools {
  # Ask at most once (marker under tools/). Skip if everything is already present.
  # Caller must launch the studio window FIRST - never block first open on this prompt.
  $offered = Join-Path $here ".export-tools-offered"
  if (Test-Path $offered) { return }

  Refresh-EnvPath
  $needPy = -not (Test-RealPython)
  $needCpp = -not (Test-CppTools)
  if (-not $needPy -and -not $needCpp) {
    Set-Content -Path $offered -Value "already-present`n$(Get-Date -Format o)" -Encoding utf8
    return
  }

  $bits = @()
  if ($needPy) { $bits += "Python games" }
  if ($needCpp) { $bits += "C++ games" }
  $list = $bits -join " / "

  $go = Ask-YesNo(@"
Also install tools for sharing games?

The studio works either way. HTML game exports already playtest fine.

If you say Yes, this PC can also run $list without each zip having to install things later. Needs the internet and one Windows permission prompt (click YES).

C++ build tools are a LARGE download and can take a long while (sometimes 20-40 minutes). Python is usually a few minutes.

Yes = install what's missing now
No = skip (each game zip can still set itself up when opened)
"@)

  Set-Content -Path $offered -Value "asked=$(Get-Date -Format o);accepted=$go" -Encoding utf8
  if (-not $go) { return }

  $script = Join-Path $here "emergency\SETUP-EXPORT-TOOLS.ps1"
  if (-not (Test-Path $script)) {
    Show-Error("Sharing-tools setup file is missing:`n$script")
    return
  }

  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script)
  if ($needPy) { $argList += "-Python" }
  if ($needCpp) {
    $confirmCpp = Ask-YesNo(@"
Include C++ build tools?

This installs Visual Studio Build Tools. It can take a long time and uses several GB of disk.

Yes = install C++ tools too
No = only install Python (if needed)
"@)
    if ($confirmCpp) { $argList += "-Cpp" }
    elseif (-not $needPy) {
      Show-Info("Okay - skipped. You can install sharing tools later from tools\emergency\SETUP-EXPORT-TOOLS.bat.")
      return
    }
  }

  Show-Info("Windows will ask for permission next - click YES, then please wait. The studio stays open while setup finishes.")
  try {
    # runas: UAC. Hidden window; script uses winget.
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -PassThru -Wait -WindowStyle Hidden
    Refresh-EnvPath
    if ($p.ExitCode -ne 0) {
      Show-Error("Sharing-tools setup didn't finish (code $($p.ExitCode)).`n`nThe studio still works. You can retry from tools\emergency\SETUP-EXPORT-TOOLS.bat, or let each game zip install what it needs.")
    } else {
      Show-Info("Sharing tools are ready (or were already installed).")
    }
  } catch {
    # User clicked No on UAC, or elevation failed
    Show-Info("Setup was cancelled. The studio still works - HTML playtest works; Python/C++ zips can install tools when you open them.")
  }
}

$emergencySetup = Join-Path $here "emergency\SETUP-ADMIN.bat"
$electronExe = Join-Path $Root "node_modules\electron\dist\electron.exe"
$electronCli = Join-Path $Root "node_modules\electron\cli.js"

function Start-ElectronStudio {
  # Start detached so optional sharing-tools prompts never block the window from opening.
  # ArgumentList keeps $Root as one argv even when the path contains spaces.
  if (Test-Path $electronExe) {
    return Start-Process -FilePath $electronExe -ArgumentList @($Root) -PassThru -WorkingDirectory $Root
  }
  return Start-Process -FilePath "node" -ArgumentList @($electronCli, $Root) -PassThru -WorkingDirectory $Root
}

function Launch-ThenOfferExportTools {
  $proc = Start-ElectronStudio
  # Match Illustrated IF Studio.exe: wait until THIS folder's backend answers, then ask.
  [void](Wait-StudioAnswering 60)
  Offer-ExportTools
  if ($null -eq $proc) { exit 1 }
  if (-not $proc.HasExited) {
    Wait-Process -Id $proc.Id
  }
  exit $proc.ExitCode
}

# --- 0. Bundled Electron runs the whole studio on its own -------------------
# Electron ships its own Node, so when node_modules came in the zip there is
# nothing to install for the studio window. Offer optional sharing tools only
# AFTER the studio is answering - never before the first window.
if (Test-Path $electronExe) {
  Launch-ThenOfferExportTools
}

# --- 1. Make sure Node.js is available -------------------------------------
Refresh-EnvPath
if (-not (Have-Node)) {
  $go = Ask-OkCancel(@"
Welcome to Illustrated IF Studio!

Before the studio can open, Windows needs to finish a quick one-time setup.
In a moment Windows will ask for permission - please click YES.

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
if (-not (Test-Path $electronCli)) {
  Show-Info(@"
Illustrated IF Studio is getting ready for the first time.

This takes a minute and needs the internet. Click OK, then please wait -
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

# --- 3. Launch studio, then optional sharing-tools prompt (never before) ----
try {
  Launch-ThenOfferExportTools
} catch {
  Show-Error("The studio ran into a problem while starting.`n`nTry once more. If it keeps happening, open 'tools\emergency\RUN-EDITOR.bat' to see the details.")
  exit 1
}
