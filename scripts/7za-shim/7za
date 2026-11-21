@echo off
rem Wrapper for electron-builder's download-artifact: runs the real 7za
rem but EXCLUDES the two macOS dylib symlink entries that cannot be
rem restored without Windows symlink privileges (Developer Mode off),
rem then writes them as plain text files containing their link targets.
rem Windows packaging never reads these dylibs.
setlocal
set "REAL=%~dp07za-real.exe"

set "MODE="
set "OUT="
set "ARCHIVE="

:parse
if "%~1"=="" goto run
if /i "%~1"=="x" set "MODE=x"
if /i "%~1"=="e" set "MODE=e"
echo %~1 | findstr /b /c:"-o" >nul && set "OUT=%~1"
if not "%~1"=="x" if not "%~1"=="e" echo %~1 | findstr /b /c:"-" >nul || set "ARCHIVE=%~1"
shift
goto parse

:run
if "%MODE%"=="" (
  "%REAL%" %*
  exit /b %errorlevel%
)
"%REAL%" %* -xr!libcrypto.dylib -xr!libssl.dylib
if errorlevel 1 exit /b %errorlevel%

if "%OUT%"=="" goto done
set "OUT=%OUT:~2%"
if exist "%OUT%\darwin\10.12\lib" (
  > "%OUT%\darwin\10.12\lib\libcrypto.dylib" (echo libcrypto.1.0.0.dylib)
  > "%OUT%\darwin\10.12\lib\libssl.dylib" (echo libssl.1.0.0.dylib)
)
:done
exit /b 0
