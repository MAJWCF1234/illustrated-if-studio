# Illustrated IF Studio - optional export-toolchain setup (Python / C++).
# Called from the studio launcher after Node is ready, only if the user says Yes.
# Pre-checks what's already installed; only installs missing pieces via winget.
#
# Usage:
#   SETUP-EXPORT-TOOLS.ps1 [-Python] [-Cpp] [-Quiet] [-LogPath path]
#   (with no -Python/-Cpp flags, installs both that are missing)

param(
  [switch]$Python,
  [switch]$Cpp,
  [switch]$Quiet,
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"
$emergencyDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Split-Path -Parent $emergencyDir
$studioRoot = Split-Path -Parent $toolsDir
$common = Join-Path $studioRoot "server\templates\windows\_common.ps1"
if (-not (Test-Path $common)) { throw "Missing shared helper: $common" }
. $common

$doPython = $Python -or (-not $Python -and -not $Cpp)
$doCpp = $Cpp -or (-not $Python -and -not $Cpp)

if ($Quiet -and $LogPath) {
  try { Start-Transcript -Path $LogPath -Append | Out-Null } catch {}
}

function Write-Msg([string]$msg, [string]$color = "Cyan") {
  if (-not $Quiet) { Write-Host $msg -ForegroundColor $color }
}

$elevateArgs = @()
if ($Python) { $elevateArgs += "-Python" }
if ($Cpp) { $elevateArgs += "-Cpp" }
if ($Quiet) { $elevateArgs += "-Quiet" }
if ($LogPath) { $elevateArgs += @("-LogPath", $LogPath) }
if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList $elevateArgs) {
  exit 0
}

Write-Msg "=== Illustrated IF - sharing-tools setup ==="

function Find-RealPython {
  foreach ($cmd in @("py", "python", "python3")) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    if ($c.Source -match "WindowsApps|System32\\Python") { continue }
    try {
      $out = & $c.Source -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return $out.Trim() }
    } catch {}
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    try {
      $out = & py -3 -c "import sys; print(sys.version.split()[0])" 2>$null
      if ($out) { return $out.Trim() }
    } catch {}
  }
  return $null
}

Refresh-Path

if ($doPython) {
  $ver = Find-RealPython
  if ($ver) {
    Write-Msg "Python already present: $ver" "Green"
  } else {
    Write-Msg "Installing Python 3.12..."
    Install-WingetPackage -Id "Python.Python.3.12" -Name "Python 3.12"
    Refresh-Path
    $ver = Find-RealPython
    if (-not $ver) { throw "Python installed but not found on PATH yet. Restart the studio after a moment." }
    Write-Msg "Installed Python: $ver" "Green"
  }
}

if ($doCpp) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Msg "Installing Git..."
    Install-WingetPackage -Id "Git.Git" -Name "Git"
  } else {
    Write-Msg "Git present: $(git --version)" "Green"
  }

  if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Write-Msg "Installing CMake..."
    Install-WingetPackage -Id "Kitware.CMake" -Name "CMake"
  } else {
    Write-Msg "CMake present: $(cmake --version | Select-Object -First 1)" "Green"
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $hasCpp = $false
  if (Test-Path $vswhere) {
    $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($inst) { $hasCpp = $true; Write-Msg "MSVC tools found at: $inst" "Green" }
  }

  if (-not $hasCpp) {
    Write-Msg "Installing Visual Studio 2022 Build Tools (C++). This can take a long time..." "Yellow"
    & winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --disable-interactivity --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if ($LASTEXITCODE -notin 0, -1978335189) {
      throw "Build Tools install failed (exit $LASTEXITCODE). You can retry later, or each C++ game zip can install tools when opened."
    }
  }
}

Refresh-Path
$marker = Join-Path $toolsDir ".export-tools-ready"
Set-Content -Path $marker -Value "ready`n$(Get-Date -Format o)" -Encoding utf8

Write-Msg "Sharing tools are ready (or were already installed)." "Green"
if (-not $Quiet) { Write-Done "Done." }
if ($Quiet -and $LogPath) { try { Stop-Transcript | Out-Null } catch {} }
exit 0
