@echo off
:: C++ package — ensure tools, cmake build, then run Release binary
setlocal
cd /d "%~dp0"

where cmake >nul 2>&1
if %errorlevel% neq 0 (
  echo CMake not found. Running elevated setup...
  call "%~dp0SETUP-ADMIN.bat"
  where cmake >nul 2>&1
  if %errorlevel% neq 0 (
    echo Still no CMake. Open a NEW "x64 Native Tools" or Admin terminal and retry.
    pause
    exit /b 1
  )
)

echo Configuring and building...
cmake -S "%~dp0." -B "%~dp0build" -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto fail
cmake --build "%~dp0build" --config Release
if errorlevel 1 goto fail

set EXE=
if exist "%~dp0build\Release\illustrated_if.exe" set EXE=%~dp0build\Release\illustrated_if.exe
if exist "%~dp0build\illustrated_if.exe" set EXE=%~dp0build\illustrated_if.exe
if not defined EXE (
  echo Built but could not find illustrated_if.exe under build\
  dir /s /b "%~dp0build\*illustrated_if*"
  pause
  exit /b 1
)

echo Running %EXE%
"%EXE%"
if errorlevel 1 pause
exit /b 0

:fail
echo Build failed. If MSVC is missing, run SETUP-ADMIN.bat as Administrator.
pause
exit /b 1
