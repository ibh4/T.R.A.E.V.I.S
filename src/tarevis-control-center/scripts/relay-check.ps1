param(
  [string]$EnvironmentFile,
  [switch]$UseCurrentEnvironment,
  [switch]$AllowLoopback
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "relay-env.ps1")
$previous = $null
if (-not $UseCurrentEnvironment) {
  if (-not $EnvironmentFile) {
    $EnvironmentFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\backend")).Path ".env.production.local"
  }
  $previous = Set-RelayProcessEnvironment -Values (Read-RelayEnvironmentFile -Path $EnvironmentFile)
}

try {
  if ($env:CONTROL_CENTER_RELAY_ENABLED -ne "true") { throw "CONTROL_CENTER_RELAY_ENABLED must be true." }
  $relayUri = $null
  $parsedRelay = [Uri]::TryCreate($env:CONTROL_CENTER_RELAY_URL, [UriKind]::Absolute, [ref]$relayUri)
  $loopbackHost = $parsedRelay -and (@("127.0.0.1", "localhost", "::1", "[::1]") -contains $relayUri.Host)
  $validScheme = $parsedRelay -and ($relayUri.Scheme -eq "wss" -or ($AllowLoopback -and $relayUri.Scheme -eq "ws" -and $loopbackHost))
  if (-not $validScheme -or $relayUri.UserInfo -or $relayUri.AbsolutePath -ne "/agent/connect" -or $relayUri.Query -or $relayUri.Fragment) {
    throw "CONTROL_CENTER_RELAY_URL must be wss://.../agent/connect; loopback ws:// is allowed only with -AllowLoopback."
  }
  if ($relayUri.Host -match "(^|\.)example\.com$|\.example$|^your[-.]") { throw "CONTROL_CENTER_RELAY_URL still uses a documentation placeholder domain." }

  $deviceId = if ($env:CONTROL_CENTER_DEVICE_ID) { $env:CONTROL_CENTER_DEVICE_ID.Trim() } else { "" }
  if ($deviceId.Length -gt 128 -or $deviceId -notmatch "^[A-Za-z0-9][A-Za-z0-9._:-]*$") {
    throw "CONTROL_CENTER_DEVICE_ID is missing or invalid."
  }
  $token = if ($env:CONTROL_CENTER_DEVICE_TOKEN) { $env:CONTROL_CENTER_DEVICE_TOKEN.Trim() } else { "" }
  if ($token.Length -lt 32 -or $token.Length -gt 512 -or $token -notmatch "^[!-~]+$" -or $token -match "replace-with|change-me|example") {
    throw "CONTROL_CENTER_DEVICE_TOKEN is missing, invalid, or still a placeholder."
  }

  $heartbeat = if ($env:CONTROL_CENTER_RELAY_HEARTBEAT_MS) { [int]$env:CONTROL_CENTER_RELAY_HEARTBEAT_MS } else { 15000 }
  $offline = if ($env:CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS) { [int]$env:CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS } else { 45000 }
  $reconnectInitial = if ($env:CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS) { [int]$env:CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS } else { 500 }
  $reconnectMax = if ($env:CONTROL_CENTER_RELAY_RECONNECT_MAX_MS) { [int]$env:CONTROL_CENTER_RELAY_RECONNECT_MAX_MS } else { 8000 }
  if ($heartbeat -lt 1000 -or $heartbeat -gt 60000) { throw "CONTROL_CENTER_RELAY_HEARTBEAT_MS is out of range." }
  if ($offline -lt ($heartbeat * 2) -or $offline -gt 300000) { throw "CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS must be at least twice the heartbeat interval." }
  if ($reconnectInitial -lt 100 -or $reconnectInitial -gt 10000 -or $reconnectMax -lt $reconnectInitial -or $reconnectMax -gt 60000) {
    throw "Relay reconnect intervals are invalid."
  }

  Write-Host "Relay configuration valid."
  Write-Host "Device: $deviceId"
  Write-Host "Endpoint: $($relayUri.AbsoluteUri)"
  Write-Host "Heartbeat/offline: ${heartbeat}ms/${offline}ms | reconnect: ${reconnectInitial}ms-${reconnectMax}ms"
  Write-Host "Device token: [configured and redacted]"
} finally {
  if ($null -ne $previous) { Restore-RelayProcessEnvironment -Previous $previous }
}
