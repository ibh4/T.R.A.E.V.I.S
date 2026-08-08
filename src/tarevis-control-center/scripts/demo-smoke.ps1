param(
  [string]$BackendBaseUrl = "http://127.0.0.1:8780"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonPost([string]$Path, [object]$Body) {
  $parameters = @{
    Uri = "$BackendBaseUrl$Path"
    Method = "Post"
    ContentType = "application/json"
  }
  if ($null -ne $Body) {
    $parameters.Body = $Body | ConvertTo-Json -Depth 10 -Compress
  }
  Invoke-RestMethod @parameters
}

function Wait-Command([string]$CommandId, [string]$ExpectedStatus) {
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $state = Invoke-RestMethod "$BackendBaseUrl/api/state"
    $command = $state.snapshot.commands | Where-Object commandId -eq $CommandId
    if ($command.status -eq $ExpectedStatus) { return $state }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Command $CommandId did not reach $ExpectedStatus"
}

$health = Invoke-RestMethod "$BackendBaseUrl/api/health"
if (-not $health.ok) { throw "Backend health check failed" }
Write-Host "HEALTH ok mode=$($health.mode) revision=$($health.revision)"

$reset = Invoke-JsonPost "/api/demo/reset" $null
$event = $reset.snapshot.events[0]
$eventReport = [ordered]@{
  schemaVersion = $event.schemaVersion
  eventId = $event.eventId
  deviceId = $event.deviceId
  source = $event.source
  type = $event.type
  level = $event.level
  zone = $event.zone
  title = $event.title
  summary = $event.summary
  confidence = $event.confidence
  occurredAt = $event.occurredAt
  payload = $event.payload
}
$duplicateEvent = Invoke-JsonPost "/api/events" $eventReport
if ($duplicateEvent.created) { throw "Duplicate event was not idempotent" }
Write-Host "EVENT duplicate preserved eventId=$($duplicateEvent.event.eventId)"

$requestId = "req_demo_smoke"
$first = Invoke-JsonPost "/api/trae/commands" @{ requestId = $requestId; input = "生成家庭风险摘要" }
$duplicate = Invoke-JsonPost "/api/trae/commands" @{ requestId = $requestId; input = "不得重复执行" }
if ($first.command.commandId -ne $duplicate.command.commandId -or $duplicate.created) {
  throw "Duplicate command was not idempotent"
}
Wait-Command $first.command.commandId "succeeded" | Out-Null
Write-Host "COMMAND idempotent and succeeded commandId=$($first.command.commandId) requestId=$requestId"

$timeout = Invoke-JsonPost "/api/trae/commands" @{
  requestId = "req_demo_timeout"
  input = "验证超时 [mock:timeout]"
}
Wait-Command $timeout.command.commandId "expired" | Out-Null
Write-Host "TIMEOUT reached terminal expired commandId=$($timeout.command.commandId)"

Invoke-JsonPost "/api/robot/commands" @{
  requestId = "req_demo_reset_race"
  action = "patrol"
  params = @{}
  confirmed = $true
} | Out-Null
$finalReset = Invoke-JsonPost "/api/demo/reset" $null
Start-Sleep -Milliseconds 1500
$finalState = Invoke-RestMethod "$BackendBaseUrl/api/state"
if ($finalState.revision -ne $finalReset.revision -or $finalState.snapshot.commands.Count -ne 0) {
  throw "A stale Mock callback changed state after reset"
}
Write-Host "RESET stable revision=$($finalState.revision); smoke demo passed"
