# What the demo stack is actually doing (Windows).
#
#   pnpm demo:status        answer now
#   pnpm demo:status -- 240 poll for up to 240s, until READY or FAILED
#
# Why this exists: on 2026-09-20 the stack was launched, died seconds
# later, and left `demo.log` holding two bytes -- "^C". Meanwhile an
# unrelated project was listening on 3000 and 3001, so every casual check
# ("is something on the port?") said yes. Twenty-two minutes were spent
# waiting for a service that was never coming back. A developer must be
# able to ask one question and get one of five answers:
#
#   STOPPED   nothing of this repository is running
#   STARTING  our processes are up, the services have not answered yet
#   READY     web, api, q-api and the worker are all serving
#   DEGRADED  some of it is serving and some of it is not
#   FAILED    it ran and stopped, and the log says why
#
# Two rules keep the answer honest. A process counts as ours only if its
# command line names THIS repository, exactly as demo-stop.ps1 finds what
# to stop. A port counts as ours only if the service behind it says which
# service it is (`/health/ready` returns its own name) or if one of our
# processes owns the socket -- so somebody else's dev server on 3000 is
# reported as somebody else's, never as Capital Q.
#
# Nothing here prints a command line or a secret.
# Whatever survives pnpm: `-- 240`, `240`, or `-WaitSeconds 240` when this
# is run directly. pnpm forwards its own `--`, and PowerShell reads that as
# end-of-parameters, so a declared -WaitSeconds never receives its value.
# The number is simply found among the arguments instead.
param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)

$WaitSeconds = 0
foreach ($token in @($Arguments)) {
  if ($token -match '^\d+$') {
    $WaitSeconds = [int] $token
    break
  }
}

$ErrorActionPreference = "SilentlyContinue"
$root = (Split-Path -Parent $PSScriptRoot).TrimEnd("\")
$pattern = [regex]::Escape($root)
$log = Join-Path $root "demo.log"
# Written by demo-stop.ps1, removed by demo-detached.ps1: the difference
# between a stack that was stopped and one that died.
$stopMarker = Join-Path $root ".demo-stopped"

# The ports the services default to: packages/config API_DEFAULT_PORT and
# Q_API_DEFAULT_PORT, and the web app's own 3000.
$WEB_PORT = 3000
$API_PORT = 3001
$Q_API_PORT = 3002

function Get-OurProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -match '^(node|ngrok|pnpm|cmd)\.exe$') -and
    ($_.CommandLine -match $pattern -or
     ($_.Name -eq 'ngrok.exe' -and $_.CommandLine -match " http $Q_API_PORT"))
  }
}

# One health probe, bounded. Invoke-RestMethod's -TimeoutSec does not cover
# a server that accepts the connection and then goes quiet, and q-api does
# exactly that while its embedding runtime warms: a status check built on it
# blocked for three minutes. Both timeouts are set explicitly here, because a
# status tool that can hang is not a status tool.
function Read-Health([int] $Port) {
  $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/health/ready")
  $request.Method = "GET"
  $request.Timeout = 2000
  $request.ReadWriteTimeout = 2000
  $response = $null
  $reader = $null
  try {
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    return ($reader.ReadToEnd() | ConvertFrom-Json)
  } catch {
    return $null
  } finally {
    if ($reader) { $reader.Dispose() }
    if ($response) { $response.Dispose() }
  }
}

# Who is behind a port: ours, somebody else's, or nobody -- the distinction
# the empty-log incident turned on. A service names itself, so an answer
# from the wrong service is reported as the wrong service.
function Test-Service([int] $Port, [string] $Expected, [int[]] $Pids) {
  $answer = Read-Health -Port $Port
  if ($null -ne $answer) {
    if ($answer.service -eq $Expected) {
      return @{ State = "READY"; Detail = "$($answer.service), $($answer.environment), contracts $($answer.contracts)" }
    }
    return @{ State = "FOREIGN"; Detail = "answered, but calls itself '$($answer.service)', not $Expected" }
  }
  # Silence and an occupied port are different problems. If somebody else
  # holds it, our service cannot bind it, and that -- not "starting slowly"
  # -- is why it will never answer. Say so, with the name of the holder.
  $holder = Get-PortHolder -Port $Port
  if ($holder) {
    if ($Pids -contains [int] (Get-PortOwnerPid -Port $Port)) {
      return @{ State = "SILENT"; Detail = "listening but not answering yet" }
    }
    return @{ State = "FOREIGN"; Detail = "port held by another project ($holder); $Expected cannot bind it" }
  }
  return @{ State = "SILENT"; Detail = "no answer" }
}

# The name of whoever is listening, or $null. Only a process name, never a
# command line: a command line can carry a token or a database password.
function Get-PortOwnerPid([int] $Port) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) { return 0 }
  return [int] $listener.OwningProcess
}

function Get-PortHolder([int] $Port) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) { return $null }
  $name = (Get-Process -Id ([int] $listener.OwningProcess) -ErrorAction SilentlyContinue).ProcessName
  if ($name) { return $name } else { return "pid $($listener.OwningProcess)" }
}

# The web app has no health endpoint of its own, so ownership of the socket
# is the only evidence available for it.
function Test-OurPort([int] $Port, [int[]] $Pids) {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listeners) { return @{ State = "SILENT"; Detail = "nothing listening" } }
  foreach ($listener in $listeners) {
    if ($Pids -contains [int] $listener.OwningProcess) {
      return @{ State = "READY"; Detail = "served by this repository" }
    }
  }
  return @{ State = "FOREIGN"; Detail = "held by another project ($(Get-PortHolder -Port $Port))" }
}

function Get-Report {
  $ours = @(Get-OurProcesses)
  $pids = @($ours | ForEach-Object { [int] $_.ProcessId })
  $text = ""
  if (Test-Path $log) { $text = (Get-Content $log -Raw -ErrorAction SilentlyContinue) }
  if ($null -eq $text) { $text = "" }

  $web = Test-OurPort -Port $WEB_PORT -Pids $pids
  $api = Test-Service -Port $API_PORT -Expected "api" -Pids $pids
  $qapi = Test-Service -Port $Q_API_PORT -Expected "q-api" -Pids $pids

  # The worker has no public endpoint by design (doc 21 section 164), so it is
  # read from its own startup lines plus a live process of ours.
  $workerStarted = $text -match "worker runtime started"
  $refreshQueue = $text -match '"queue":"recommendation-refresh"'
  $worker = @{ State = "SILENT"; Detail = "no startup line yet" }
  if ($workerStarted -and $ours.Count -gt 0) {
    if ($refreshQueue) {
      $worker = @{ State = "READY"; Detail = "running; recommendation-refresh consumer started" }
    } else {
      $worker = @{ State = "DEGRADED"; Detail = "running, but no recommendation-refresh consumer" }
    }
  }

  $interrupted = $text -match "\^C"
  # Stopping the stack kills four processes, and killing them writes the same
  # kind of error a crash does. Only the marker distinguishes the two.
  $stoppedOnPurpose = Test-Path $stopMarker
  $serving = @($web, $api, $qapi, $worker | Where-Object { $_.State -eq "READY" }).Count

  if ($ours.Count -eq 0) {
    # The demo script refuses to start on a configuration it cannot serve, and
    # says why in a [demo] line. That reason is the answer to "why is it not
    # running", so it is repeated here rather than left for someone to find.
    $refusal = [regex]::Match($text, '(?m)^\[demo\]\s+(the .+)$').Groups[1].Value
    if ($stoppedOnPurpose) {
      $state = "STOPPED"
      $why = "stopped with pnpm demo:stop"
    } elseif ($interrupted) {
      $state = "FAILED"
      $why = "the stack was interrupted: demo.log ends at ^C, so it never finished starting"
    } elseif ($refusal) {
      $state = "FAILED"
      $why = "it refused to start: $refusal"
    } elseif ($text -match 'ELIFECYCLE|"level":50|Cannot find|ERR_MODULE_NOT_FOUND') {
      $state = "FAILED"
      $why = "it ran and stopped; demo.log holds an error"
    } else {
      $state = "STOPPED"
      $why = "nothing of this repository is running"
    }
  } elseif ($serving -eq 4) {
    $state = "READY"
    $why = "web, api, q-api and the worker are all serving"
  } else {
    $taken = @(
      @{ n = "web"; c = $web }, @{ n = "api"; c = $api },
      @{ n = "q-api"; c = $qapi }
    ) | Where-Object { $_.c.State -eq "FOREIGN" } | ForEach-Object { $_.n }
    $blocked = if ($taken.Count -gt 0) { "; another project holds the port for $($taken -join ', ')" } else { "" }
    if ($serving -eq 0) {
      $state = "STARTING"
      $why = "$($ours.Count) process(es) up, nothing serving yet$blocked"
    } else {
      $state = "DEGRADED"
      $why = "$serving of 4 serving$blocked"
    }
  }

  # What Q reports its own routing to be, from its own startup line. Read
  # here rather than from this shell's environment, because the question is
  # what the running service decided, not what a variable says it should be.
  $composed = [regex]::Match(
    $text,
    '"syntheticDemoRouting":(?<synthetic>true|false),"google":"(?<google>[^"]*)","groq":"(?<groq>[^"]*)"')
  $routing = $null
  if ($composed.Success) {
    $posture = if ($composed.Groups["synthetic"].Value -eq "true") { "ON (synthetic demo traffic may use Gemini)" }
               else { "OFF (every request routes as real customer data)" }
    $routing = "synthetic-demo routing $posture; google $($composed.Groups["google"].Value), groq $($composed.Groups["groq"].Value)"
  }

  return @{
    State = $state; Why = $why; Processes = $ours.Count; Routing = $routing
    Components = [ordered] @{ web = $web; api = $api; "q-api" = $qapi; worker = $worker }
  }
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  $report = Get-Report
  if ($report.State -eq "READY" -or $report.State -eq "FAILED" -or $WaitSeconds -le 0) { break }
  if ((Get-Date) -ge $deadline) { break }
  Start-Sleep -Seconds 5
} while ($true)

Write-Host "[demo] $($report.State) -- $($report.Why)"
Write-Host "[demo] $($report.Processes) process(es) of this repository"
foreach ($name in $report.Components.Keys) {
  $component = $report.Components[$name]
  Write-Host ("  {0,-7} {1,-8} {2}" -f $name, $component.State, $component.Detail)
}
# Only while it is running: the log outlives the stack, and a routing line
# under a STOPPED verdict would describe a service that is not there.
if ($report.Routing -and $report.Processes -gt 0) {
  Write-Host "[demo] q-api routing: $($report.Routing)"
}
if ($report.State -ne "READY" -and (Test-Path $log)) {
  $tail = Get-Content $log -Tail 3 -ErrorAction SilentlyContinue
  if ($tail) {
    Write-Host "[demo] last lines of demo.log:"
    foreach ($line in $tail) { Write-Host "  $($line.Substring(0, [Math]::Min(160, $line.Length)))" }
  }
}

switch ($report.State) {
  "READY" { exit 0 }
  "FAILED" { exit 1 }
  "DEGRADED" { exit 2 }
  "STARTING" { exit 3 }
  "STOPPED" { exit 4 }
  default { exit 5 }
}
