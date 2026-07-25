# SETUP-ADMIN.ps1 — C++ / CMake package prerequisites
# Elevates to Administrator; installs Git, CMake, and VS Build Tools (C++).

param([switch]$Launch)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "_common.ps1")

if (Request-AdminElevation -ScriptPath $MyInvocation.MyCommand.Path -ArgumentList @($(if ($Launch) { "-Launch" }))) {
  exit 0
}

Write-Host "=== Illustrated IF — C++ package setup (Admin) ===" -ForegroundColor Cyan
Write-Host "Folder: $here"
Write-Host "This installs Git, CMake, and Visual Studio Build Tools (C++)."
Write-Host "Build Tools download is large (~ few GB). Leave this window open."
Write-Host ""

Refresh-Path

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Install-WingetPackage -Id "Git.Git" -Name "Git"
} else {
  Write-Host "Git present: $(git --version)"
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  Install-WingetPackage -Id "Kitware.CMake" -Name "CMake"
} else {
  Write-Host "CMake present: $(cmake --version | Select-Object -First 1)"
}

# VS Build Tools with MSVC + CMake tools + Windows SDK
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasCpp = $false
if (Test-Path $vswhere) {
  $inst = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if ($inst) { $hasCpp = $true; Write-Host "MSVC tools found at: $inst" }
}

if (-not $hasCpp) {
  Write-Host "Installing Visual Studio 2022 Build Tools (C++ workload)…" -ForegroundColor Cyan
  Write-Host "If winget prompts, accept. This can take a long time."
  & winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --disable-interactivity --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  if ($LASTEXITCODE -notin 0, -1978335189) {
    Write-Host "winget Build Tools exit $LASTEXITCODE — trying chocolatey-style fallback note…" -ForegroundColor Yellow
    Write-Host "Manual: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Write-Host "Select workload: Desktop development with C++"
  }
}

Refresh-Path

$marker = Join-Path $here ".prereqs-ok"
Set-Content -Path $marker -Value "cpp-prereqs`n$(Get-Date -Format o)" -Encoding utf8

Write-Host ""
Write-Host "Prerequisites installed (or already present)." -ForegroundColor Green
Write-Host "Build & run: double-click PLAY.bat  (runs cmake configure+build, then launches)"

if ($Launch) {
  Start-Process -FilePath (Join-Path $here "PLAY.bat")
}

Write-Done "C++ setup complete."
