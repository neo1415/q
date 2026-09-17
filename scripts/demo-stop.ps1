# Stop a demo stack started by scripts/demo-detached.ps1 (Windows).
#
# The launcher's own process is not enough to stop: `pnpm demo` spawns
# turbo, which spawns four node processes, and killing a parent on Windows
# leaves its children running. Everything is found by what it is running
# instead: a node, pnpm, turbo or ngrok process whose command line names
# this repository. The database containers are left alone, as `pnpm demo`
# leaves them. Nothing here prints a command line, which may carry a token.
$ErrorActionPreference = "SilentlyContinue"
$root = (Split-Path -Parent $PSScriptRoot).TrimEnd("\")
$pattern = [regex]::Escape($root)

$mine = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -match '^(node|ngrok|pnpm|cmd)\.exe$') -and
  ($_.CommandLine -match $pattern -or ($_.Name -eq 'ngrok.exe' -and $_.CommandLine -match ' http 3002'))
}
if (-not $mine) {
  Write-Host "[demo] nothing of this repository is running."
  exit 0
}
foreach ($process in $mine) {
  Stop-Process -Id $process.ProcessId -Force
}
Write-Host "[demo] stopped $($mine.Count) process(es)."
