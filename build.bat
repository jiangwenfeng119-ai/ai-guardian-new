@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "CURSOR_NODE=d:\Program Files\cursor\resources\app\resources\helpers\node.exe"
if exist "%CURSOR_NODE%" (
  "%CURSOR_NODE%" node_modules\vite\bin\vite.js build
) else (
  node node_modules\vite\bin\vite.js build
)
pause
