<#
.SYNOPSIS
  HQ watchdog (Task Scheduler, every 15 min). Restarts a silent HQ, at most twice in 6 hours.

.DESCRIPTION
  Works outside Claude and the slack-hq MCP: it reads #agent-log with the bot token from .env
  and looks for HQ's own "HQ alive" / "HQ online" lines. That tests the whole chain
  (Claude session, slack-hq bridge, Slack) end to end.

  Healthy  = such a line within the threshold: 100 min by day (07:00-23:00; heartbeats wait while
             HQ is busy with a long run), 75 min at night. Between 04:20 and 05:00 an "HQ online"
             line since 04:00 is required (the nightly restart must have come up).
  Silent   = run restart-hq.ps1 and post a red line to #agent-log by API: "restarted (n/2)".
  Limits   = at most 2 restarts in any 6 hours; nothing is checked for 20 min after a restart
             (or before 04:20, while the nightly restart settles).
  After 2  = no more restarts, and the HQ window is never closed. One alert mentioning the owner is
             posted, then it stays quiet until a healthy check clears the counter. HQ runs without
             Remote Control, so the owner's way back is "!restart hq" or remote desktop.
  Command  = "!restart hq" from the owner in #ceo restarts HQ at the next check, ignoring the limit
             (read here, not by the bridge, so it works when HQ or slack-hq is dead).
  Slack API unreachable or erroring = do nothing but log (a restart can't fix the network).

  State: logs\hq-watchdog.json. Log: logs\hq-watchdog.log.
  IDs come from .env: SLACK_ALLOWED_USER (the owner), HQ_LOG_CHANNEL_ID (#agent-log),
  HQ_CEO_CHANNEL_ID (#ceo). Parameters override them.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File watchdog-hq.ps1 -DryRun
  (checks and logs what it would do; restarts nothing, posts nothing)
#>
param(
  [switch]$DryRun,
  [string]$Channel = '',      # #agent-log ID (default: HQ_LOG_CHANNEL_ID in .env)
  [string]$CeoChannel = '',   # #ceo ID, where the owner types "!restart hq" (default: HQ_CEO_CHANNEL_ID)
  [string]$OwnerId = '',      # the owner's Slack user ID (default: SLACK_ALLOWED_USER)
  [int]$DayMinutes = 100,
  [int]$NightMinutes = 75,
  [int]$MaxRestarts = 2,
  [int]$WindowHours = 6,
  [int]$GraceMinutes = 20
)

$ErrorActionPreference = 'Stop'
$HqDir = $PSScriptRoot
$LogDir = Join-Path $HqDir 'logs'
$LogFile = Join-Path $LogDir 'hq-watchdog.log'
$StateFile = Join-Path $LogDir 'hq-watchdog.json'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# A sync client (OneDrive, Google Drive) can briefly lock files: retry, then give up quietly.
function Write-HqFile([string]$Path, [string]$Text, [switch]$Replace) {
  for ($i = 0; $i -lt 10; $i++) {
    try {
      if ($Replace) { Set-Content -LiteralPath $Path -Value $Text -Encoding UTF8 -ErrorAction Stop }
      else { Add-Content -LiteralPath $Path -Value $Text -Encoding UTF8 -ErrorAction Stop }
      return
    } catch { Start-Sleep -Milliseconds 300 }
  }
}
function Log([string]$msg) {
  $line = "$(Get-Date -Format s) $(if ($DryRun) { '[dry-run] ' })$msg"
  Write-Host $line
  Write-HqFile $LogFile $line
}

# --- token from .env (never printed) ---
$envFile = Join-Path $HqDir '.env'
if (-not (Test-Path $envFile)) { Log 'no .env: cannot check'; exit 1 }
$token = $null
foreach ($l in Get-Content -LiteralPath $envFile) {
  if ($l -match '^\s*SLACK_BOT_TOKEN\s*=\s*"?([^"\s]+)"?') { $token = $Matches[1] }
  if (-not $OwnerId -and $l -match '^\s*SLACK_ALLOWED_USER\s*=\s*"?([^"\s]+)"?') { $OwnerId = $Matches[1] }
  if (-not $Channel -and $l -match '^\s*HQ_LOG_CHANNEL_ID\s*=\s*"?([^"\s]+)"?') { $Channel = $Matches[1] }
  if (-not $CeoChannel -and $l -match '^\s*HQ_CEO_CHANNEL_ID\s*=\s*"?([^"\s]+)"?') { $CeoChannel = $Matches[1] }
}
if (-not $token) { Log 'SLACK_BOT_TOKEN missing in .env: cannot check'; exit 1 }
if (-not $OwnerId -or -not $Channel -or -not $CeoChannel) {
  Log 'SLACK_ALLOWED_USER, HQ_LOG_CHANNEL_ID or HQ_CEO_CHANNEL_ID missing in .env: cannot check'; exit 1
}
$headers = @{ Authorization = "Bearer $token" }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Post([string]$text) {
  if ($DryRun) { Log "would post: $text"; return }
  try {
    $body = @{ channel = $Channel; text = $text } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Method Post -Uri 'https://slack.com/api/chat.postMessage' -Headers $headers `
      -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
    if (-not $r.ok) { Log "post failed: $($r.error)" }
  } catch { Log "post failed: $($_.Exception.Message)" }
}

# --- state ---
$state = [pscustomobject]@{ restarts = @(); alerted = $false; lastCmdTs = $null }
if (Test-Path $StateFile) {
  try {
    $s = Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
    $state.restarts = @($s.restarts | Where-Object { $_ })
    $state.alerted = [bool]$s.alerted
    if ($s.lastCmdTs) { $state.lastCmdTs = [string]$s.lastCmdTs }
  } catch { Log 'state file unreadable: starting fresh' }
}
function Save-State {
  if ($DryRun) { return }
  Write-HqFile $StateFile ($state | ConvertTo-Json -Compress) -Replace
}

$now = Get-Date
$state.restarts = @($state.restarts | Where-Object { [datetime]$_ -gt $now.AddHours(-$WindowHours) })

# --- "!restart hq" from the owner in #ceo ---
# Read here, outside Claude and the bridge, so it works even when HQ or slack-hq is dead.
# Ignores the 2-restart limit. Only the owner's user ID, only #ceo, only messages newer than the last check.
function Ts([string]$t) { [double]::Parse($t, [Globalization.CultureInfo]::InvariantCulture) }
$nowTs = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$cmdSince = if ($state.lastCmdTs) { [string]$state.lastCmdTs } else { [string]($nowTs - 20 * 60) }
try {
  $c = Invoke-RestMethod -Uri "https://slack.com/api/conversations.history?channel=$CeoChannel&oldest=$cmdSince&limit=50" `
    -Headers $headers -TimeoutSec 30
  if ($c.ok) {
    $cmd = @($c.messages | Where-Object { $_.user -eq $OwnerId -and -not $_.subtype -and $_.text -match '^\s*!restart\s+hq\b' } |
      Sort-Object { Ts $_.ts }) | Select-Object -Last 1
    $newest = @($c.messages | ForEach-Object { $_.ts } | Sort-Object { Ts $_ }) | Select-Object -Last 1
    if (-not $DryRun) { $state.lastCmdTs = if ($newest) { $newest } else { $cmdSince } }
    if ($cmd) {
      Log "!restart hq from owner (ts $($cmd.ts)): restarting"
      if (-not $DryRun) {
        $state.restarts = @(); $state.alerted = $false
        $state.restarts = @($now.ToString('s'))   # starts the 20-min grace period; counts as restart 1 of 2
        Save-State
        try {
          $b = @{ channel = $CeoChannel; thread_ts = $cmd.ts; text = ":arrows_counterclockwise: Restarting HQ now. It should post *HQ online* in #agent-log within a few minutes." } | ConvertTo-Json -Compress
          Invoke-RestMethod -Method Post -Uri 'https://slack.com/api/chat.postMessage' -Headers $headers `
            -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($b)) -TimeoutSec 30 | Out-Null
        } catch { Log "reply failed: $($_.Exception.Message)" }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $HqDir 'restart-hq.ps1')
      }
      Post ":arrows_counterclockwise: $(Get-Date -Format HH:mm) HQ watchdog: restarted on the owner's !restart hq."
      exit 0
    }
  } else { Log "could not read #ceo ($($c.error))" }
} catch { Log "could not read #ceo ($($_.Exception.Message))" }

# --- grace periods ---
$last = $state.restarts | ForEach-Object { [datetime]$_ } | Sort-Object | Select-Object -Last 1
if ($last -and $last -gt $now.AddMinutes(-$GraceMinutes)) { Log "grace: restarted at $($last.ToString('HH:mm'))"; Save-State; exit 0 }
$nightly = $now.Date.AddHours(4)
if ($now -ge $nightly -and $now -lt $nightly.AddMinutes(20)) { Log 'grace: nightly restart settling'; Save-State; exit 0 }

# --- read #agent-log ---
$oldest = [DateTimeOffset]::UtcNow.AddHours(-$WindowHours).ToUnixTimeSeconds()
try {
  $r = Invoke-RestMethod -Uri "https://slack.com/api/conversations.history?channel=$Channel&oldest=$oldest&limit=200" `
    -Headers $headers -TimeoutSec 30
} catch { Log "Slack unreachable ($($_.Exception.Message)): no action"; exit 0 }
if (-not $r.ok) { Log "Slack API error ($($r.error)): no action"; exit 0 }

$beats = @($r.messages | Where-Object { $_.bot_id -and $_.text -match '^HQ (alive|online)\b' } | ForEach-Object {
  $ms = [long]([double]::Parse($_.ts, [Globalization.CultureInfo]::InvariantCulture) * 1000)
  [pscustomobject]@{ at = [DateTimeOffset]::FromUnixTimeMilliseconds($ms).LocalDateTime; online = ($_.text -match '^HQ online') }
} | Sort-Object at)
$lastBeat = $beats | Select-Object -Last 1

# --- healthy? ---
$isDay = $now.Hour -ge 7 -and $now.Hour -lt 23
$limit = if ($isDay) { $DayMinutes } else { $NightMinutes }
if ($now -ge $nightly.AddMinutes(20) -and $now -lt $nightly.AddHours(1)) {
  $healthy = [bool]($beats | Where-Object { $_.online -and $_.at -ge $nightly })
  $why = 'no "HQ online" since 04:00'
} else {
  $healthy = [bool]($lastBeat -and $lastBeat.at -gt $now.AddMinutes(-$limit))
  $why = "no heartbeat for $limit min"
}
$since = if ($lastBeat) { $lastBeat.at.ToString('HH:mm') } else { "over $WindowHours h" }

if ($healthy) {
  if ($state.restarts.Count -gt 0 -or $state.alerted) { Post ":large_green_circle: $(Get-Date -Format HH:mm) HQ watchdog: HQ is back (last heartbeat $since)." }
  $state.restarts = @(); $state.alerted = $false
  Log "healthy (last heartbeat $since)"
  Save-State; exit 0
}

# --- silent ---
if ($state.restarts.Count -lt $MaxRestarts) {
  $n = $state.restarts.Count + 1
  Log "silent ($why; last $since): restart $n/$MaxRestarts"
  if (-not $DryRun) {
    $state.restarts = @($state.restarts) + $now.ToString('s')
    Save-State
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $HqDir 'restart-hq.ps1')
  }
  Post ":red_circle: $(Get-Date -Format HH:mm) HQ watchdog: HQ silent since $since ($why). Restarted ($n/$MaxRestarts)."
} elseif (-not $state.alerted) {
  Log "silent ($why; last $since): restart limit reached, leaving the session open"
  Post ":red_circle: <@$OwnerId> HQ still silent after $MaxRestarts restarts (last heartbeat $since). I've stopped restarting. Reply ``!restart hq`` in #ceo to try again (I check every 15 min), or open the HQ window by remote desktop."
  $state.alerted = $true
  Save-State
} else {
  Log "silent (last $since): already alerted, waiting for the owner"
}
