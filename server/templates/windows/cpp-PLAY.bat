@echo off
:: C++ package - ensure tools, cmake build, then run Release binary
:: Prefer double-clicking "Play the Game" (quiet). This bat is the technical path.
setlocal
cd /d "%~dp0"

:: Pick up tools installed since this window opened (SETUP / winget).
call :refresh_path

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
  call :refresh_path
  where cmake >nul 2>&1
  if %errorlevel% neq 0 (
    echo Still no CMake. Open _emergency, run SETUP-ADMIN.bat, then try again.
    pause
    exit /b 1
  )
)

:: CMake alone is not enough - need a C++ compiler (MSVC Build Tools, or g++/clang++).
call :have_cxx
if not defined HAVE_CXX (
  echo No C++ compiler found yet. Running elevated setup...
  echo ^(This installs Visual Studio Build Tools - large download, can take a while.^)
  if not defined SETUP (
    echo SETUP helper missing. Re-unzip the game folder.
    pause
    exit /b 1
  )
  call "%SETUP%"
  call :refresh_path
  call :have_cxx
  if not defined HAVE_CXX (
    echo.
    echo Still no C++ compiler.
    echo Open _emergency, double-click SETUP-ADMIN.bat, wait until it finishes
    echo ^(it can take 20-40 minutes the first time^), then try Play again.
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
echo.
echo Build failed.
echo.
echo Most often this means the C++ build tools are not finished installing.
echo Open _emergency, double-click SETUP-ADMIN.bat, wait until it finishes
echo (it can take a long time), then double-click Play the Game again.
echo.
echo If setup already finished, screenshot this window and send it to
echo whoever gave you the game.
pause
exit /b 1

:have_cxx
set "HAVE_CXX="
where cl >nul 2>&1 && set "HAVE_CXX=1"
if not defined HAVE_CXX where g++ >nul 2>&1 && set "HAVE_CXX=1"
if not defined HAVE_CXX where clang++ >nul 2>&1 && set "HAVE_CXX=1"
if not defined HAVE_CXX (
  set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
  if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do set "HAVE_CXX=1"
  )
)
exit /b 0

:refresh_path
:: Reload Machine+User PATH so a just-finished SETUP is visible in this cmd.
:: Ensure System32 (and powershell) are findable even if PATH was stale/minimal.
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0
