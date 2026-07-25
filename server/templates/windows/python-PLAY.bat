@echo off
:: Illustrated IF — play the game.
:: First run: installs Python (one-time Admin prompt) + game libraries into a
:: private .venv folder, then launches. Later runs launch instantly.
setlocal
cd /d "%~dp0"

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
  call "%~dp0SETUP-ADMIN.bat"
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
echo close this window and double-click PLAY.bat again.
pause
exit /b 1

:venv_failed
echo.
echo Could not prepare the game environment.
echo Double-click SETUP-ADMIN.bat once, then run PLAY.bat again.
pause
exit /b 1

:pip_failed
echo.
echo Could not download the game libraries.
echo Check your internet connection, then double-click PLAY.bat again.
pause
exit /b 1
