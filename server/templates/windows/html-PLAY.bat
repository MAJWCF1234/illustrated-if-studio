@echo off
:: HTML package - ensure Node then start local server and open browser
:: Prefer double-clicking "Play the Game" (quiet). This bat is the technical path.
setlocal
cd /d "%~dp0"

set "SETUP="
if exist "%~dp0_emergency\SETUP-ADMIN.bat" set "SETUP=%~dp0_emergency\SETUP-ADMIN.bat"
if not defined SETUP if exist "%~dp0SETUP-ADMIN.bat" set "SETUP=%~dp0SETUP-ADMIN.bat"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js not found. Running elevated setup...
  if not defined SETUP (
    echo SETUP helper missing. Re-unzip the game folder.
    pause
    exit /b 1
  )
  call "%SETUP%"
  where node >nul 2>&1
  if %errorlevel% neq 0 (
    echo Still no Node on PATH. Close this window and double-click Play the Game again.
    pause
    exit /b 1
  )
)

echo Starting HTML player...
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8080/"
node "%~dp0start-server.mjs"
pause
