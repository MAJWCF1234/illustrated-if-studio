@echo off
:: Illustrated IF - play the game (technical path; prefer "Play the Game").
:: First run: installs Python (one-time Admin prompt) + game libraries into a
:: private .venv folder, then launches. Later runs launch instantly.
setlocal
cd /d "%~dp0"

set "SETUP="
if exist "%~dp0_emergency\SETUP-ADMIN.bat" set "SETUP=%~dp0_emergency\SETUP-ADMIN.bat"
if not defined SETUP if exist "%~dp0SETUP-ADMIN.bat" set "SETUP=%~dp0SETUP-ADMIN.bat"

set "VENV=%~dp0.venv"
set "VENVPY=%VENV%\Scripts\python.exe"

if exist "%VENVPY%" goto deps

:: ---- find a system Python 3 to create the private environment ----
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo Python is not installed yet.
  echo Starting one-time setup - please approve the Administrator prompt...
  if not defined SETUP (
    echo SETUP helper missing. Re-unzip the game folder.
    pause
    exit /b 1
  )
  call "%SETUP%"
  where py >nul 2>&1 && set "PY=py -3"
  if not defined PY where python >nul 2>&1 && set "PY=python"
)
if not defined PY goto no_python

echo Preparing the game environment ^(one time^)...
%PY% -m venv "%VENV%"
if not exist "%VENVPY%" goto venv_failed

:deps
if exist "%VENV%\.deps-ok" goto launch
echo Installing game libraries ^(one time, needs internet^)...
"%VENVPY%" -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
if errorlevel 1 goto pip_failed
> "%VENV%\.deps-ok" echo ok

:launch
"%VENVPY%" "%~dp0app.py"
if errorlevel 1 pause
exit /b 0

:no_python
echo.
echo Python is still not available. If the setup window just finished,
echo close this window and double-click Play the Game again.
pause
exit /b 1

:venv_failed
echo.
echo Could not prepare the game environment.
echo Open _emergency and double-click SETUP-ADMIN.bat once, then try again.
pause
exit /b 1

:pip_failed
echo.
echo Could not download the game libraries.
echo Check your internet connection, then double-click Play the Game again.
pause
exit /b 1
