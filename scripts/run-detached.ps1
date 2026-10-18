# Run ONE command outside the calling process tree (Windows).
#
#   pnpm run:detached -- "pnpm --filter @capital-q/api dev" api.log PORT=3011
#
# The same mechanism as demo-detached.ps1 and for the same reason: a
# process started from an editor's or an assistant's shell inherits that
# shell's job object, and the job closing kills it with no line in any log
# to say why. This is the one-command version, for when the whole demo
# stack is not what is wanted — running a single service on a spare port
# because another project of yours already holds the usual one, for
# instance, which is a great deal politer than stopping theirs.
#
# See demo-detached.ps1 for why it is WMI plus CREATE_NEW_PROCESS_GROUP
# and not DETACHED_PROCESS, and for the packaged-AppData PATH mapping.
# Nothing here prints a secret.
param(
  [Parameter(Mandatory = $true)][string] $Command,
  [string] $LogFile = "detached.log",
  [Parameter(ValueFromRemainingArguments = $true)][string[]] $EnvPairs
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$log = if ([System.IO.Path]::IsPathRooted($LogFile)) {
  $LogFile
} else {
  Join-Path $root $LogFile
}

# The package's real AppData, when this shell runs inside a packaged app.
$virtual = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "Claude_*" } |
  ForEach-Object { Join-Path $_.FullName "LocalCache" } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1

$entries = ($env:PATH -split ";") | Where-Object { $_ -ne "" }
$mapped = @()
$corepackHome = $null
if ($virtual) {
  $ignore = [System.StringComparison]::OrdinalIgnoreCase
  foreach ($entry in $entries) {
    $real = $null
    if ($entry.StartsWith($env:LOCALAPPDATA, $ignore)) {
      $real = Join-Path $virtual ("Local" + $entry.Substring($env:LOCALAPPDATA.Length))
    } elseif ($entry.StartsWith($env:APPDATA, $ignore)) {
      $real = Join-Path $virtual ("Roaming" + $entry.Substring($env:APPDATA.Length))
    }
    if ($real -and (Test-Path $real)) { $mapped += $real }
  }
  $cache = Join-Path $virtual "Local\node\corepack"
  if (Test-Path $cache) { $corepackHome = $cache }
}

$node = (Get-Command node).Source
$corepackPnpm = Join-Path (Split-Path $node) "node_modules\corepack\dist\pnpm.js"
$shims = Join-Path $env:TEMP "capital-q-shims"
if (Test-Path $corepackPnpm) {
  New-Item -ItemType Directory -Force -Path $shims | Out-Null
  "@`"$node`" `"$corepackPnpm`" %*" | Set-Content -Path (Join-Path $shims "pnpm.cmd") -Encoding ASCII
  $mapped = @($shims) + $mapped
}
$path = ($mapped + $entries) -join ";"

$launcher = Join-Path $env:TEMP ("capital-q-detached-" + [guid]::NewGuid().ToString("N") + ".cmd")
$lines = @("@echo off", "set `"PATH=$path`"")
if ($corepackHome) { $lines += "set `"COREPACK_HOME=$corepackHome`"" }
$lines += "set COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
foreach ($pair in @($EnvPairs | Where-Object { $_ -ne "--" -and $_ -match "=" })) {
  $name, $value = $pair -split "=", 2
  $lines += "set `"$name=$value`""
}
$lines += "cd /d `"$root`""
$lines += "$Command > `"$log`" 2>&1"
$lines | Set-Content -Path $launcher -Encoding ASCII

$startup = ([WMICLASS] "Win32_ProcessStartup").CreateInstance()
$startup.CreateFlags = 0x200  # CREATE_NEW_PROCESS_GROUP
$result = ([WMICLASS] "Win32_Process").Create("cmd.exe /c `"$launcher`"", $root, $startup)
if ($result.ReturnValue -ne 0) {
  throw "could not start detached: WMI returned $($result.ReturnValue)"
}
Write-Output "detached pid $($result.ProcessId), logging to $log"
