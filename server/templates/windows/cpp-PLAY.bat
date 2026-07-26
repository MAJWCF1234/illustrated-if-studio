@echo off
:: C++ package - ensure tools, cmake build, then run Release binary
:: Prefer double-clicking "Play the Game" (quiet). This bat is the technical path.
setlocal
cd /d "%~dp0"

set "SETUP="
if exist "%~dp0_emergency\SETUP-ADMIN.bat" set "SETUP=%~dp0_emergency\SETUP-ADMIN.bat"
if not defined SETUP if exist "%~dp0SETUP-ADMIN.bat" set "SETUP=%~dp0SETUP-ADMIN.bat"

where cmake >nul 2>&1
if %errorlevel% neq 0 (
  echo CMake not found. Running elevated setup...
  if not defined SETUP (
    echo SETUP helper missing. Re-unzip the game folder.
    pause
    exit /b 1
  )
  call "%SETUP%"
  where cmake >nul 2>&1
  if %errorlevel% neq 0 (
    echo Still no CMake. Open _emergency, run SETUP-ADMIN.bat, then try again.
    pause
    exit /b 1
  )
)

echo Configuring and building the graphical game...
echo (First run downloads and compiles raylib - this can take a few minutes.)
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
echo Build failed. If MSVC is missing, open _emergency and run SETUP-ADMIN.bat.
pause
exit /b 1
