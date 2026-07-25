@echo off
:: Elevate + run PowerShell SETUP-ADMIN.ps1 (UAC prompt)
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP-ADMIN.ps1" %*
set ERR=%ERRORLEVEL%
if %ERR% neq 0 (
  echo Setup failed with exit code %ERR%
  pause
)
exit /b %ERR%
