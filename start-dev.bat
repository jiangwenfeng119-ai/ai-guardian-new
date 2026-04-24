@echo off
cd /d "%~dp0"
set "CURSOR_NODE=d:\Program Files\cursor\resources\app\resources\helpers\node.exe"
if exist "%CURSOR_NODE%" (
  "%CURSOR_NODE%" node_modules\vite\bin\vite.js --port 3000 --host 0.0.0.0
) else (
  node node_modules\vite\bin\vite.js --port 3000 --host 0.0.0.0
)
pause
