@echo off
:: Python package — ensure Python then launch desktop app
setlocal
cd /d "%~dp0"

set PY=
where py >nul 2>&1 && set PY=py -3
if not defined PY (
  where python >nul 2>&1 && set PY=python
)
if not defined PY (
  echo Python not found. Running elevated setup...
  call "%~dp0SETUP-ADMIN.bat"
  where py >nul 2>&1 && set PY=py -3
  if not defined PY where python >nul 2>&1 && set PY=python
)
if not defined PY (
  echo Still no Python on PATH. Open a NEW terminal and run PLAY.bat again.
  pause
  exit /b 1
)

echo Launching Illustrated IF Python app...
%PY% "%~dp0app.py"
if errorlevel 1 pause
