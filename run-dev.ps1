# Run Vite without npm (vite.config starts server/api.cjs in dev)
# Usage: .\run-dev.ps1
# If scripts blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

$NodeExe = $null
if ($env:AI_GUARDIAN_NODE_PATH -and (Test-Path -LiteralPath $env:AI_GUARDIAN_NODE_PATH)) {
  $NodeExe = $env:AI_GUARDIAN_NODE_PATH
}

if (-not $NodeExe) {
  $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
  $tryPaths = @(
    'D:\Program Files\cursor\resources\app\resources\helpers\node.exe',
    (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  )
  if ($pf86) {
    $tryPaths = $tryPaths + (Join-Path $pf86 'nodejs\node.exe')
  }
  foreach ($p in $tryPaths) {
    if ($p -and (Test-Path -LiteralPath $p)) {
      $NodeExe = $p
      break
    }
  }
}

if (-not $NodeExe) {
  try {
    $NodeExe = (Get-Command node -ErrorAction Stop).Source
  } catch {
    $NodeExe = $null
  }
}

if (-not $NodeExe) {
  Write-Host 'Node.exe not found. Install Node.js or set AI_GUARDIAN_NODE_PATH to node.exe full path.' -ForegroundColor Red
  exit 1
}

$Vite = Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $Vite)) {
  Write-Host 'Missing node_modules. Run npm install once on a machine with npm, then copy the folder.' -ForegroundColor Red
  exit 1
}

Write-Host "Using: $NodeExe" -ForegroundColor DarkGray
Write-Host 'API: http://127.0.0.1:8787 (proxied as /api)' -ForegroundColor DarkGray
Write-Host 'Prefer the URL printed below (Vite uses 3000; if busy it will try 3001, 3002, ...)' -ForegroundColor Cyan
& $NodeExe $Vite --port 3000 --host 0.0.0.0
