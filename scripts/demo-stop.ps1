# Stop a demo stack started by scripts/demo-detached.ps1 (Windows).
#
# The launcher's own process is not enough to stop: `pnpm demo` spawns
# turbo, which spawns four node processes, and killing a parent on Windows
# leaves its children running. Everything is found by what it is running
# instead: a node, pnpm, turbo or ngrok process whose command line names
# this repository. The database containers are left alone, as `pnpm demo`
# leaves them. Nothing here prints a command line, which may carry a token.
#
# A marker file is left behind. A stopped stack and a crashed one both end
# in dead processes and a log full of the errors that killing them produced;
# without a note saying which happened, `pnpm demo:status` reports a
# deliberate stop as a failure. The note cannot go in demo.log: the dying
# turbo still holds that file open and writes its own exit lines after this
# script has finished, and the next launch truncates it. A separate file is
# written once, by whoever acted, and read by whoever asks.
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
Set-Content -Path (Join-Path $root ".demo-stopped") -Encoding ASCII `
  -Value "stopped by pnpm demo:stop at $(Get-Date -Format s)"
Write-Host "[demo] stopped $($mine.Count) process(es)."
