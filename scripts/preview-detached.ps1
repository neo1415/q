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

$launcher = Join-Path $env:TEMP "capital-q-preview.cmd"
$lines = @("@echo off", "set `"PATH=$path`"")
if ($corepackHome) { $lines += "set `"COREPACK_HOME=$corepackHome`"" }
$lines += "set COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
$lines += $sets
$lines += "cd /d `"$Worktree`""
# Four services, each on its own preview port, all writing to one log.
$lines += "start `"cq-preview-api`" /b cmd /c `"cd /d $Worktree\apps\api && set PORT=$ApiPort && node dist/main.js >> `"$LogFile`" 2>&1`""
$lines += "start `"cq-preview-qapi`" /b cmd /c `"cd /d $Worktree\apps\q-api && set PORT=$QApiPort && node dist/main.js >> `"$LogFile`" 2>&1`""
$lines += "start `"cq-preview-workers`" /b cmd /c `"cd /d $Worktree\apps\workers && node dist/main.js >> `"$LogFile`" 2>&1`""
$lines += "start `"cq-preview-web`" /b cmd /c `"cd /d $Worktree\apps\web && pnpm exec next start -p $WebPort >> `"$LogFile`" 2>&1`""
$lines | Set-Content -Path $launcher -Encoding ASCII

Remove-Item $LogFile -ErrorAction SilentlyContinue

# CREATE_NEW_PROCESS_GROUP (0x200), not DETACHED_PROCESS: the group flag is
# what stops a Ctrl+C in the launching shell reaching the preview, and the
# console it keeps is what carries the redirect.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
  CreateFlags = [uint32] 0x200
}
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine               = "cmd.exe /c `"$launcher`""
  CurrentDirectory          = $Worktree
  ProcessStartupInformation = $startup
}
if ($result.ReturnValue -ne 0) {
  throw "could not start the preview (Win32_Process.Create returned $($result.ReturnValue))"
}
Write-Host "[preview] started detached (pid $($result.ProcessId)); output in $LogFile"
