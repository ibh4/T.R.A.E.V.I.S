[CmdletBinding()]
param(
    [string]$VisionSource = "",
    [switch]$AutoStartVision,
    [int]$Port = 8787,
    [double]$AudioSeconds = 5,
    [int]$AudioDeviceIndex = -1,
    [ValidateSet("mock", "funasr")]
    [string]$AudioTranscriber = "mock",
    [string]$AudioMockText = "测试语音",
    [switch]$RebuildUi
)

$ErrorActionPreference = "Stop"
$moduleRoot = Split-Path -Parent $PSScriptRoot
$uiRoot = Join-Path $moduleRoot "ui"
$uiIndex = Join-Path $uiRoot "dist\index.html"
$venvPython = Join-Path $moduleRoot ".venv\Scripts\python.exe"
$python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { "python" }

if ($AudioDeviceIndex -lt -1) {
    throw "-AudioDeviceIndex must be -1 (saved/default device) or a non-negative device index."
}

Push-Location $moduleRoot
try {
    if ($RebuildUi -or -not (Test-Path -LiteralPath $uiIndex)) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            throw "npm is required to build the UI. Install Node.js, then rerun this script."
        }
        Push-Location $uiRoot
        try {
            if (-not (Test-Path -LiteralPath (Join-Path $uiRoot "node_modules"))) {
                npm install
                if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
            }
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "UI build failed." }
        }
        finally {
            Pop-Location
        }
    }

    $env:PYTHONPATH = Join-Path $moduleRoot "src"
    $serverArgs = @(
        "-m", "tarevis_home_node",
        "ui-server",
        "--host", "127.0.0.1",
        "--port", $Port.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--ui-dir", (Join-Path $uiRoot "dist"),
        "--snapshots-dir", (Join-Path $moduleRoot "data\snapshots"),
        "--audio-seconds", $AudioSeconds.ToString([Globalization.CultureInfo]::InvariantCulture),
        "--audio-transcriber", $AudioTranscriber
    )
    if ($AudioTranscriber -eq "mock") {
        $serverArgs += @("--audio-mock-text", $AudioMockText)
    }
    if ($AudioDeviceIndex -ge 0) {
        $serverArgs += @("--audio-device-index", $AudioDeviceIndex.ToString([Globalization.CultureInfo]::InvariantCulture))
    }
    if (-not [string]::IsNullOrWhiteSpace($VisionSource)) {
        $serverArgs += @("--vision-source", $VisionSource)
    }
    if ($AutoStartVision) {
        $serverArgs += "--auto-start-vision"
    }

    Write-Host "TAREVIS Home Node UI (Windows showcase): http://127.0.0.1:$Port/?motion=showcase"
    Write-Host "TAREVIS Home Node UI (Raspberry Pi cadence): http://127.0.0.1:$Port/?profile=pi"
    Write-Host "Press Ctrl+C to stop the local service."
    & $python @serverArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
