# Illustrated IF - shared Windows elevate + winget helpers
# Dot-source from package setup scripts.

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Request-AdminElevation {
  param([string]$ScriptPath = $PSCommandPath, [string[]]$ArgumentList = @())
  if (Test-IsAdmin) { return $false }
  Write-Host "Requesting Administrator elevation..." -ForegroundColor Yellow
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$ScriptPath`"") + $ArgumentList
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $args | Out-Null
  return $true
}

function Ensure-Winget {
  if (Get-Command winget -ErrorAction SilentlyContinue) { return $true }
  Write-Host "winget not found. Install 'App Installer' from the Microsoft Store, then re-run." -ForegroundColor Red
  return $false
}

function Install-WingetPackage {
  param(
    [Parameter(Mandatory)][string]$Id,
    [string]$Name = $Id
  )
  if (-not (Ensure-Winget)) { throw "winget missing" }
  Write-Host "Installing $Name ($Id)..." -ForegroundColor Cyan
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -notin 0, -1978335189) {
    # -1978335189 = already installed (newer winget)
    throw "winget failed for $Id (exit $LASTEXITCODE)"
  }
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Write-Done {
  param([string]$Message)
  Write-Host ""
  Write-Host $Message -ForegroundColor Green
  Write-Host "Press Enter to close..."
  [void][Console]::ReadLine()
}
