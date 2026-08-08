param(
  [string]$ProjectName = $env:CONTROL_CENTER_PAGES_PROJECT,
  [string]$ApiBase = $env:VITE_CONTROL_CENTER_API_BASE,
  [string]$DeviceId = $env:VITE_CONTROL_CENTER_DEVICE_ID,
  [string]$Branch = "main",
  [switch]$ConfirmDeployment
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($ProjectName -notmatch "^[a-z0-9][a-z0-9-]{1,57}[a-z0-9]$") { throw "ProjectName must be a valid Cloudflare Pages project name." }
if ($Branch -notmatch "^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$" -or $Branch.Contains("..")) { throw "Branch is invalid." }
& (Join-Path $PSScriptRoot "build-production.ps1") -ApiBase $ApiBase -DeviceId $DeviceId
if (-not $ConfirmDeployment) {
  Write-Host "Pages preflight passed. No deployment was performed."
  Write-Host "Re-run with -ConfirmDeployment after checking project '$ProjectName' and branch '$Branch'."
  exit 0
}

$wrangler = (Resolve-Path (Join-Path $projectRoot "..\..\cloudflare\node_modules\.bin\wrangler.cmd")).Path
& $wrangler pages deploy (Join-Path $projectRoot "dist") --project-name $ProjectName --branch $Branch
if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages deployment failed." }
