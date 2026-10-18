# Stop the tester's preview services, and only those.
#
# The mirror of scripts/demo-stop.ps1, with the same lesson applied in the
# other direction: match the preview worktree followed by a separator or
# the end of the path, never a bare prefix. `...\q` is a prefix of
# `...\q-preview`, so a careless pattern in either script takes the other
# stack down — which is the exact failure this whole preview exists to
# prevent.
#
# The preview database is deliberately left running. It is the tester's
# data, it costs nothing to leave up, and stopping the services is what
# somebody actually asks for.
param([Parameter(Mandatory = $true)][string] $Worktree)

$ErrorActionPreference = "SilentlyContinue"
$root = $Worktree.TrimEnd("\")
$pattern = [regex]::Escape($root) + '(?=[\\/"''\s]|$)'

$mine = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -match '^(node|pnpm|cmd)\.exe$') -and ($_.CommandLine -match $pattern)
}
if (-not $mine) {
  Write-Host "[preview] nothing of the preview is running."
  exit 0
}
foreach ($process in $mine) {
  Stop-Process -Id $process.ProcessId -Force
}
Write-Host "[preview] stopped $($mine.Count) process(es)."
