# Start the demo stack outside the calling process tree (Windows).
#
#   pnpm demo:detached            same as `pnpm demo`
#   pnpm demo:detached -- --local same as `pnpm demo --local`
#   pnpm demo:stop                stop it again
#
# Why this exists: a process started from a shell inherits that shell's job
# object, and on Windows a job closing kills everything in it. A stack
# started from an editor's terminal or an assistant's shell therefore dies
# when that application restarts, with no line in any log to say why. The
# Claude desktop app updated itself mid-demo and took web, api, q-api and
# workers with it that way, twice.
#
# WMI's Win32_Process.Create starts a process as a child of the WMI host,
# outside any caller's job object, so the stack survives whatever started
# it. Two things do not carry across on their own and are carried here:
#
#  - PATH. The new process gets the registry's, not this shell's.
#  - Files the app cannot see. A packaged (MSIX) application such as the
#    Claude desktop app has its own view of AppData: anything a tool
#    installed from inside it (corepack's pnpm shim, corepack's cache) was
#    really written under the package's LocalCache folder and does not
#    exist at the address this shell sees it at. Those PATH entries are
#    mapped to where the files really are, and corepack is pointed at the
#    cache it actually filled. The shim itself cannot be reused: it
#    reaches corepack by a path relative to its virtual address, which is
#    wrong at its real one. So `pnpm` is a one-line shim of our own that
#    calls corepack's pnpm entry point by its absolute path.
#
# Output goes to demo.log at the repository root (gitignored). Nothing
# here prints a secret.
param([Parameter(ValueFromRemainingArguments = $true)][string[]] $DemoArgs)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "demo.log"
$extra = if ($DemoArgs) { " " + ($DemoArgs -join " ") } else { "" }

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

# pnpm by way of corepack's own entry point, first on the PATH.
$node = (Get-Command node).Source
$corepackPnpm = Join-Path (Split-Path $node) "node_modules\corepack\dist\pnpm.js"
$shims = Join-Path $env:TEMP "capital-q-shims"
if (Test-Path $corepackPnpm) {
  New-Item -ItemType Directory -Force -Path $shims | Out-Null
  "@`"$node`" `"$corepackPnpm`" %*" | Set-Content -Path (Join-Path $shims "pnpm.cmd") -Encoding ASCII
  $mapped = @($shims) + $mapped
}
$path = ($mapped + $entries) -join ";"

# A command file rather than one long quoted command line: cmd.exe's
# quoting rules and a PATH with spaces in it do not mix. Plain redirects
# write the bytes the tools emit, where PowerShell 5.1 would re-encode them
# as UTF-16 and wrap every stderr line in an error record.
$launcher = Join-Path $env:TEMP "capital-q-demo.cmd"
$lines = @("@echo off", "set `"PATH=$path`"")
if ($corepackHome) { $lines += "set `"COREPACK_HOME=$corepackHome`"" }
$lines += "set COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
$lines += "cd /d `"$root`""
$lines += "pnpm demo$extra > `"$log`" 2>&1"
$lines | Set-Content -Path $launcher -Encoding ASCII

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine      = "cmd.exe /c `"$launcher`""
  CurrentDirectory = $root
}
if ($result.ReturnValue -ne 0) {
  throw "could not start the demo stack (Win32_Process.Create returned $($result.ReturnValue))"
}
Write-Host "[demo] started detached (pid $($result.ProcessId)); output in demo.log"
Write-Host "[demo] follow it with: Get-Content demo.log -Wait -Tail 20"
