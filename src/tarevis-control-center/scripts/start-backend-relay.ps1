param(
  [string]$EnvironmentFile,
  [switch]$Development
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendRoot = Join-Path $projectRoot "backend"
if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $backendRoot ".env.production.local" }
. (Join-Path $PSScriptRoot "relay-env.ps1")
$previous = Set-RelayProcessEnvironment -Values (Read-RelayEnvironmentFile -Path $EnvironmentFile)

try {
  $checkArguments = @("-UseCurrentEnvironment")
  if ($Development) { $checkArguments += "-AllowLoopback" }
  & (Join-Path $PSScriptRoot "relay-check.ps1") @checkArguments
  $port = if ($env:CONTROL_CENTER_PORT) { [int]$env:CONTROL_CENTER_PORT } else { 8780 }
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Stop the existing backend before starting Relay."
  }
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  if ($Development) {
    Write-Host "Starting backend and Relay Agent in development mode. Press Ctrl+C to stop."
    & $npm run dev --prefix $backendRoot
  } else {
    Write-Host "Building backend before production Relay startup."
    & $npm run build --prefix $backendRoot
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed." }
    Write-Host "Starting backend and Relay Agent. Press Ctrl+C to stop."
    & $npm run start --prefix $backendRoot
  }
  if ($LASTEXITCODE -ne 0) { throw "Backend process exited with code $LASTEXITCODE." }
} finally {
  Restore-RelayProcessEnvironment -Previous $previous
}
