@echo off
:: Optional: install Python / C++ tools so exported games play without per-zip setup.
:: Prefer letting the studio launcher ask you - only run this if you chose to skip.
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -Wait"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP-EXPORT-TOOLS.ps1" %*
set ERR=%ERRORLEVEL%
if %ERR% neq 0 (
  echo Setup failed with exit code %ERR%
  pause
)
exit /b %ERR%
