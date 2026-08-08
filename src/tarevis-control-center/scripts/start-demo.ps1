param(
  [ValidateSet("mock", "live", "hybrid")]
  [string]$Mode = "mock"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendRoot = Join-Path $projectRoot "backend"
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$logRoot = Join-Path ([System.IO.Path]::GetTempPath()) "tarevis-control-center"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Assert-PortAvailable([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($listener) {
    throw "Port $Port is already in use. Stop the existing listener before starting the demo."
  }
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds) {
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return [math]::Round($timer.Elapsed.TotalMilliseconds)
      }
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
  throw "Timed out waiting for $Url"
}

function Stop-ProcessTree([System.Diagnostics.Process]$Process) {
  if ($Process -and -not $Process.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>$null | Out-Null
    $Process.WaitForExit(5000) | Out-Null
  }
}

Assert-PortAvailable 8780
Assert-PortAvailable 5180

$backendOut = Join-Path $logRoot "backend.stdout.log"
$backendErr = Join-Path $logRoot "backend.stderr.log"
$frontendOut = Join-Path $logRoot "frontend.stdout.log"
$frontendErr = Join-Path $logRoot "frontend.stderr.log"
$backendProcess = $null
$frontendProcess = $null

try {
  $env:CONTROL_CENTER_MODE = $Mode
  $env:CONTROL_CENTER_HOST = "127.0.0.1"
  $env:CONTROL_CENTER_PORT = "8780"
  $env:VITE_CONTROL_CENTER_ADAPTER = "live"
  $env:VITE_CONTROL_CENTER_API_BASE = "/"
  $env:VITE_CONTROL_CENTER_AUTH_MODE = "mock"
  $env:VITE_CONTROL_CENTER_DEVICE_ID = "my-computer"
  $env:CONTROL_CENTER_PROXY_TARGET = "http://127.0.0.1:8780"

  $backendProcess = Start-Process -FilePath $npmCommand -ArgumentList @("run", "dev") `
    -WorkingDirectory $backendRoot -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr -WindowStyle Hidden -PassThru
  $backendMs = Wait-Http "http://127.0.0.1:8780/api/health" 30

  $frontendProcess = Start-Process -FilePath $npmCommand -ArgumentList @("run", "dev") `
    -WorkingDirectory $projectRoot -RedirectStandardOutput $frontendOut `
    -RedirectStandardError $frontendErr -WindowStyle Hidden -PassThru
  $frontendMs = Wait-Http "http://127.0.0.1:5180" 30

  Write-Host "Control Center ready: http://127.0.0.1:5180"
  Write-Host "Backend health:      http://127.0.0.1:8780/api/health"
  Write-Host "Mode: $Mode | backend ${backendMs}ms | UI ${frontendMs}ms"
  Write-Host "Logs: $logRoot"
  Write-Host "Press Ctrl+C to stop both processes and verify port release."

  while (-not $backendProcess.HasExited -and -not $frontendProcess.HasExited) {
    Start-Sleep -Seconds 1
  }
  throw "A demo process exited unexpectedly. Check $logRoot"
} finally {
  Stop-ProcessTree $frontendProcess
  Stop-ProcessTree $backendProcess
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort 8780, 5180 -ErrorAction SilentlyContinue
    if (-not $listeners) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($listeners) {
    Write-Warning "A listener remains on port 8780 or 5180. Inspect with Get-NetTCPConnection."
  } else {
    Write-Host "Stopped. Ports 8780 and 5180 are released."
  }
}
