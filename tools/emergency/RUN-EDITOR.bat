@echo off
setlocal
cd /d "%~dp0"

REM Illustrated IF Studio - desktop editor (Electron)
REM Usage:
REM   RUN-EDITOR.bat
REM   RUN-EDITOR.bat -ReuseServer
REM   RUN-EDITOR.bat -Headless
REM   RUN-EDITOR.bat -Port 8790

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found on PATH. Install Node 18+ then re-run.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN-EDITOR.ps1" %*
set ERR=%ERRORLEVEL%
if %ERR% neq 0 (
  echo.
  echo Electron editor exited with code %ERR%.
  pause
)
exit /b %ERR%
