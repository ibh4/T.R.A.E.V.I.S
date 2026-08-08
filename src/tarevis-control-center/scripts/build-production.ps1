param(
  [string]$ApiBase = $env:VITE_CONTROL_CENTER_API_BASE,
  [string]$DeviceId = $env:VITE_CONTROL_CENTER_DEVICE_ID
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiUri = $null
if (-not [Uri]::TryCreate($ApiBase, [UriKind]::Absolute, [ref]$apiUri) -or $apiUri.Scheme -ne "https" -or $apiUri.UserInfo -or $apiUri.Query -or $apiUri.Fragment) {
  throw "ApiBase must be an HTTPS Worker URL without credentials, query, or fragment."
}
if ($apiUri.Host -match "(^|\.)example\.com$|\.example$|^your[-.]") { throw "ApiBase still uses a documentation placeholder domain." }
if ($DeviceId -notmatch "^[A-Za-z0-9][A-Za-z0-9._:-]*$" -or $DeviceId.Length -gt 128) { throw "DeviceId is invalid." }

$names = @("VITE_CONTROL_CENTER_ADAPTER", "VITE_CONTROL_CENTER_API_BASE", "VITE_CONTROL_CENTER_DEVICE_ID", "VITE_CONTROL_CENTER_AUTH_MODE")
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
try {
  $env:VITE_CONTROL_CENTER_ADAPTER = "live"
  $env:VITE_CONTROL_CENTER_API_BASE = $apiUri.ToString()
  $env:VITE_CONTROL_CENTER_DEVICE_ID = $DeviceId
  $env:VITE_CONTROL_CENTER_AUTH_MODE = "access"
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  & $npm run build --prefix $projectRoot
  if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "dist\_redirects"))) { throw "Production build is missing dist/_redirects." }
  Write-Host "Production frontend built with Live Adapter and Cloudflare Access."
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process") }
}
