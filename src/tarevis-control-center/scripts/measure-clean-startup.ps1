$ErrorActionPreference = "Stop"
$sourceProject = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourceRepository = (Resolve-Path (Join-Path $sourceProject "..\..")).Path
$tempParent = (Resolve-Path ([System.IO.Path]::GetTempPath())).Path.TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
)
$tempRepository = Join-Path $tempParent "tarevis-phase6-$([guid]::NewGuid().ToString('N'))"
$cleanProject = Join-Path $tempRepository "src\tarevis-control-center"
$cleanBackend = Join-Path $cleanProject "backend"
$backendProcess = $null
$frontendProcess = $null

function Stop-OwnedProcessTree([System.Diagnostics.Process]$Process) {
  if ($Process -and -not $Process.HasExited) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F 2>$null | Out-Null
    $Process.WaitForExit(5000) | Out-Null
  }
}

try {
  New-Item -ItemType Directory -Path $cleanBackend | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRepository "assets") -Destination $tempRepository -Recurse
  Copy-Item -LiteralPath (Join-Path $sourceRepository "art_prototype") -Destination $tempRepository -Recurse
  Copy-Item -LiteralPath @(
    (Join-Path $sourceProject "package.json"),
    (Join-Path $sourceProject "package-lock.json"),
    (Join-Path $sourceProject "tsconfig.json"),
    (Join-Path $sourceProject "vite.config.ts"),
    (Join-Path $sourceProject "index.html")
  ) -Destination $cleanProject
  Copy-Item -LiteralPath (Join-Path $sourceProject "src") -Destination $cleanProject -Recurse
  Copy-Item -LiteralPath (Join-Path $sourceProject "public") -Destination $cleanProject -Recurse
  Copy-Item -LiteralPath @(
    (Join-Path $sourceProject "backend\package.json"),
    (Join-Path $sourceProject "backend\package-lock.json"),
    (Join-Path $sourceProject "backend\tsconfig.json")
  ) -Destination $cleanBackend
  Copy-Item -LiteralPath (Join-Path $sourceProject "backend\src") -Destination $cleanBackend -Recurse
  Copy-Item -LiteralPath (Join-Path $sourceProject "backend\data") -Destination $cleanBackend -Recurse

  $backendInstall = Measure-Command { & npm.cmd ci --silent --prefix $cleanBackend | Out-Null }
  if ($LASTEXITCODE -ne 0) { throw "Clean backend npm ci failed" }
  $frontendInstall = Measure-Command { & npm.cmd ci --silent --prefix $cleanProject | Out-Null }
  if ($LASTEXITCODE -ne 0) { throw "Clean frontend npm ci failed" }
  $backendBuild = Measure-Command { & npm.cmd run build --silent --prefix $cleanBackend | Out-Null }
  if ($LASTEXITCODE -ne 0) { throw "Clean backend build failed" }
  $frontendBuild = Measure-Command { & npm.cmd run build --silent --prefix $cleanProject | Out-Null }
  if ($LASTEXITCODE -ne 0) { throw "Clean frontend build failed" }

  $env:CONTROL_CENTER_PORT = "8799"
  $env:CONTROL_CENTER_MODE = "mock"
  $env:CONTROL_CENTER_LOG_LEVEL = "error"
  $backendTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $backendProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @("dist/server.js") `
    -WorkingDirectory $cleanBackend -RedirectStandardOutput (Join-Path $tempRepository "backend.out.log") `
    -RedirectStandardError (Join-Path $tempRepository "backend.err.log") -WindowStyle Hidden -PassThru
  do {
    try { $health = Invoke-RestMethod "http://127.0.0.1:8799/api/health" -TimeoutSec 1 }
    catch { $health = $null; Start-Sleep -Milliseconds 25 }
  } while (-not $health -and $backendTimer.Elapsed.TotalSeconds -lt 10)
  if (-not $health) { throw "Clean backend did not become healthy" }
  $backendReadyMs = [math]::Round($backendTimer.Elapsed.TotalMilliseconds)

  $env:VITE_CONTROL_CENTER_ADAPTER = "live"
  $env:CONTROL_CENTER_PROXY_TARGET = "http://127.0.0.1:8799"
  $frontendTimer = [System.Diagnostics.Stopwatch]::StartNew()
  $frontendProcess = Start-Process -FilePath (Get-Command npm.cmd).Source -ArgumentList @("run", "dev", "--", "--port", "5199") `
    -WorkingDirectory $cleanProject -RedirectStandardOutput (Join-Path $tempRepository "frontend.out.log") `
    -RedirectStandardError (Join-Path $tempRepository "frontend.err.log") -WindowStyle Hidden -PassThru
  do {
    try { $page = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:5199" -TimeoutSec 1 }
    catch { $page = $null; Start-Sleep -Milliseconds 25 }
  } while (-not $page -and $frontendTimer.Elapsed.TotalSeconds -lt 10)
  if (-not $page) { throw "Clean frontend did not become ready" }

  [pscustomobject]@{
    backendInstallMs = [math]::Round($backendInstall.TotalMilliseconds)
    frontendInstallMs = [math]::Round($frontendInstall.TotalMilliseconds)
    backendBuildMs = [math]::Round($backendBuild.TotalMilliseconds)
    frontendBuildMs = [math]::Round($frontendBuild.TotalMilliseconds)
    backendReadyMs = $backendReadyMs
    frontendReadyMs = [math]::Round($frontendTimer.Elapsed.TotalMilliseconds)
    mode = $health.mode
    revision = $health.revision
  } | ConvertTo-Json -Compress
} finally {
  Stop-OwnedProcessTree $frontendProcess
  Stop-OwnedProcessTree $backendProcess
  $resolvedTemp = if (Test-Path -LiteralPath $tempRepository) {
    (Resolve-Path -LiteralPath $tempRepository).Path
  } else {
    $null
  }
  if ($resolvedTemp -and $resolvedTemp.StartsWith($tempParent + [System.IO.Path]::DirectorySeparatorChar) -and (Split-Path -Leaf $resolvedTemp).StartsWith("tarevis-phase6-")) {
    [System.IO.Directory]::Delete($resolvedTemp, $true)
  }
}
