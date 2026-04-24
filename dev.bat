@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0"
set "CURSOR_NODE=d:\Program Files\cursor\resources\app\resources\helpers\node.exe"

cd /d "%PROJECT_DIR%"
echo Starting Vite dev server...
echo Working directory: %CD%
echo Tip: If "npm" is not in PATH, this file still works - it runs node directly.
echo.
if exist "%CURSOR_NODE%" (
  "%CURSOR_NODE%" node_modules\vite\bin\vite.js --port 3000 --host 0.0.0.0
) else (
  node node_modules\vite\bin\vite.js --port 3000 --host 0.0.0.0
)

pause
