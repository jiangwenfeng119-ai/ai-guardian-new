# 仅启动后端 API（8787），一般不需要单独运行；仅调试用。
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

$NodeExe = $null
if ($env:AI_GUARDIAN_NODE_PATH -and (Test-Path $env:AI_GUARDIAN_NODE_PATH)) {
  $NodeExe = $env:AI_GUARDIAN_NODE_PATH
} elseif (Test-Path "D:\Program Files\cursor\resources\app\resources\helpers\node.exe") {
  $NodeExe = "D:\Program Files\cursor\resources\app\resources\helpers\node.exe"
} else {
  try { $NodeExe = (Get-Command node -ErrorAction Stop).Source } catch { }
}
if (-not $NodeExe) { Write-Error "未找到 node.exe"; exit 1 }

$Api = Join-Path $ProjectRoot "server\api.cjs"
Write-Host "API: http://127.0.0.1:8787" -ForegroundColor Cyan
& $NodeExe $Api
