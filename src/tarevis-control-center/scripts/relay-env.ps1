Set-StrictMode -Version Latest

function Read-RelayEnvironmentFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Relay environment file not found: $Path"
  }
  $values = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 1) { throw "Invalid environment entry in ${Path}: $trimmed" }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if ($name -notmatch "^(CONTROL_CENTER_|TRAE_|QWEN_|HARNESS_)[A-Z0-9_]+$") {
      throw "Unsupported environment variable in ${Path}: $name"
    }
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$name] = $value
  }
  return $values
}

function Set-RelayProcessEnvironment {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values)

  $previous = @{}
  foreach ($name in $Values.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, [string]$Values[$name], "Process")
  }
  return $previous
}

function Restore-RelayProcessEnvironment {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Previous)

  foreach ($name in $Previous.Keys) {
    [Environment]::SetEnvironmentVariable($name, $Previous[$name], "Process")
  }
}
