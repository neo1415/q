# Start the tester's preview services outside the caller's process tree.
#
# The same WMI technique scripts/demo-detached.ps1 uses, and for the same
# reason: a process started from a shell inherits that shell's job object,
# and on Windows a job closing kills everything in it. A preview started
# from an assistant's shell that died with that assistant would be exactly
# the problem this stack exists to solve.
#
# What differs from the demo launcher. This runs BUILT output — `next
# start` and `node dist/main.js` — never `node --watch`. A preview that
# watched anything would restart when a package was rebuilt for
# development, which is the fragility CQ-DEV-WATCH-SCOPE-001 already
# records. It also reads one generated env file and nothing else, so no
# value can drift in from the development worktree.
#
# Output goes to the preview's own log beside its worktree. Nothing here
# prints a secret.
param(
  [Parameter(Mandatory = $true)][string] $Worktree,
  [Parameter(Mandatory = $true)][string] $EnvFile,
  [Parameter(Mandatory = $true)][string] $LogFile,
  [Parameter(Mandatory = $true)][string] $WebPort,
  [Parameter(Mandatory = $true)][string] $ApiPort,
  [Parameter(Mandatory = $true)][string] $QApiPort
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Worktree)) { throw "no preview worktree at $Worktree" }
if (-not (Test-Path $EnvFile)) { throw "no preview environment at $EnvFile" }

# The package's real AppData, when this shell runs inside a packaged app.
# Same mapping as the demo launcher: a pnpm shim installed from inside an
# MSIX application does not exist at the address this shell sees.
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

# Every line of the generated environment, as `set` lines. Values are
# written into a command file that lives in TEMP and is overwritten each
# time; nothing is echoed.
$sets = @()
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') {
    $sets += ('set "' + $Matches[1] + '=' + $Matches[2] + '"')
  }
}

# One log per service, not one shared file. Windows gives the first
# redirect an exclusive handle, so four services appending to one path
# meant the first to start ran and the other three died before writing a
# word -- a stack that looked half-broken with an empty explanation.
$logDir = Split-Path -Parent $LogFile
$logFor = { param($name) Join-Path $logDir ("preview-" + $name + ".log") }

# Absolute script paths, so each command line names the preview worktree.
# That is what `preview:stop` matches on: a bare `node dist/main.js` with
# the directory set by `cd` carries nothing to distinguish it from a
# development service, and stopping the preview would have missed it.
# One detached process per service, not one script that spawns four.
#
# `start /b` from a single command file looked right and lost a race: the
# parent script exits as soon as it has issued the four, and whichever
# service had not finished binding died with it. The API survived because
# it bound first, so the stack came up one-quarter working with three
# empty logs and nothing to explain them. Each service now gets its own
# console and its own lifetime.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
  CreateFlags = [uint32] 0x200
}

$services = @(
  @{ Name = "api"; Port = $ApiPort; Script = "apps\api\dist\main.js"; Cwd = $Worktree },
  @{ Name = "q-api"; Port = $QApiPort; Script = "apps\q-api\dist\main.js"; Cwd = $Worktree },
  @{ Name = "workers"; Port = $null; Script = "apps\workers\dist\main.js"; Cwd = $Worktree },
  @{ Name = "web"; Port = $null; Script = $null; Cwd = (Join-Path $Worktree "apps\web") }
)

$started = @()
foreach ($service in $services) {
  $log = & $logFor $service.Name
  $launcher = Join-Path $env:TEMP ("capital-q-preview-" + $service.Name + ".cmd")
  $lines = @("@echo off", "set `"PATH=$path`"")
  if ($corepackHome) { $lines += "set `"COREPACK_HOME=$corepackHome`"" }
  $lines += "set COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
  $lines += $sets
  if ($service.Port) { $lines += ("set PORT=" + $service.Port) }
  $lines += "cd /d `"$($service.Cwd)`""
  if ($service.Name -eq "web") {
    $next = Join-Path $Worktree "apps\web\node_modules\next\dist\bin\next"
    $lines += "node `"$next`" start -p $WebPort > `"$log`" 2>&1"
  } else {
    $lines += "node `"$(Join-Path $Worktree $service.Script)`" > `"$log`" 2>&1"
  }
  $lines | Set-Content -Path $launcher -Encoding ASCII

  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine               = "cmd.exe /c `"$launcher`""
    CurrentDirectory          = $service.Cwd
    ProcessStartupInformation = $startup
  }
  if ($result.ReturnValue -ne 0) {
    throw "could not start preview $($service.Name) (Win32_Process.Create returned $($result.ReturnValue))"
  }
  $started += $service.Name
}

Write-Host "[preview] started $($started -join ', '); logs in $logDir"
