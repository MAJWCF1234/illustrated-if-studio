@echo off
:: HTML package — ensure Node then start local server and open browser
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js not found. Running elevated setup...
  call "%~dp0SETUP-ADMIN.bat"
  where node >nul 2>&1
  if %errorlevel% neq 0 (
    echo Still no Node on PATH. Close this window, open a NEW terminal, and run PLAY.bat again.
    pause
    exit /b 1
  )
)

echo Starting HTML player...
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8080/"
node "%~dp0start-server.mjs"
pause
