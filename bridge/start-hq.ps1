<#
.SYNOPSIS
  Starts the HQ session: an interactive Claude Code session in the HQ working folder
  with the slack-hq channel loaded, in this (persistent) console window.

.DESCRIPTION
  - slack-hq is registered for the HQ folder (local MCP scope; see README). This
    script sets SLACK_HQ_ROLE=hq so only THIS session's copy opens the Slack socket;
    copies in other sessions in that folder stay dormant (Slack would split events between
    two connections).
  - Custom channels are not on Anthropic's allowlist, so they load with
    --dangerously-load-development-channels server:slack-hq. Claude Code shows a
    one-time-per-launch warning: choose "I am using this for local development".
  - If claude exits (crash, /exit), it is relaunched after a short pause unless -Once.
  - Writes this window's PID to logs\hq-window.pid so restart-hq.ps1 can close it.
  - If startup-prompt.txt exists next to this script, its text is sent as the
    session's first prompt (e.g. "read company/README.md and start the support loop").

.EXAMPLE
  powershell.exe -NoExit -ExecutionPolicy Bypass -File .\start-hq.ps1
  (the HQ folder comes from hq.local.json, written by install.ps1, unless -WorkDir is given)
#>
param(
  [switch]$Once,
  # Answer the development-channels warning automatically (for unattended starts).
  # See confirm-dev-channels.ps1: sends Enter only once the warning is on screen.
  [switch]$AutoConfirm,
  [int]$ConfirmTimeoutSeconds = 90,
  [ValidateSet('manual', 'acceptEdits', 'plan', 'auto')]
  [string]$PermissionMode = 'manual',
  [string]$WorkDir = ''
)

$ErrorActionPreference = 'Stop'

# Log writes must never stop the launcher: if the folder is synced (OneDrive, Google Drive,
# Dropbox) the sync client can briefly lock a file. Retry, then give up quietly.
function Write-HqFile([string]$Path, [string]$Text, [switch]$Replace) {
  for ($i = 0; $i -lt 10; $i++) {
    try {
      if ($Replace) { Set-Content -LiteralPath $Path -Value $Text -ErrorAction Stop }
      else { Add-Content -LiteralPath $Path -Value $Text -ErrorAction Stop }
      return
    } catch { Start-Sleep -Milliseconds 300 }
  }
  Write-Host "(could not write $Path - continuing)"
}
$HqDir = $PSScriptRoot
$LogDir = Join-Path $HqDir 'logs'
$PromptFile = Join-Path $HqDir 'startup-prompt.txt'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Write-HqFile (Join-Path $LogDir 'hq-window.pid') "$PID" -Replace
$Host.UI.RawUI.WindowTitle = 'Claude HQ (slack-hq)'

if (-not $WorkDir) {
  $localCfg = Join-Path $HqDir 'hq.local.json'
  if (Test-Path $localCfg) { $WorkDir = (Get-Content -Raw $localCfg | ConvertFrom-Json).workDir }
}
if (-not $WorkDir -or -not (Test-Path -LiteralPath $WorkDir)) { throw "HQ folder not set or missing ($WorkDir). Run install.ps1 or pass -WorkDir." }

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'claude is not on PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on PATH' }
if (-not (Test-Path (Join-Path $HqDir 'node_modules'))) {
  Write-Host 'Installing slack-hq dependencies...'
  Push-Location $HqDir; npm install --no-fund --no-audit; Pop-Location
}
if (-not (Test-Path (Join-Path $HqDir '.env'))) {
  Write-Warning "No .env in $HqDir - the session will start but Slack stays disconnected. See README.md."
}

Set-Location -LiteralPath $WorkDir
$env:SLACK_HQ_ROLE = 'hq'   # inherited by claude -> slack-hq; makes this copy the live one

while ($true) {
  # Pin the mode: the user-wide defaultMode is "plan" (HQ couldn't act), and auto mode would
  # skip the permission dialogs that the "ask" rules rely on (nothing to relay to #approvals).
  # The prompt must come BEFORE the flags: --dangerously-load-development-channels is variadic
  # and would swallow a trailing prompt as another channel entry.
  $claudeArgs = @()
  if (Test-Path $PromptFile) {
    $prompt = (Get-Content -Raw -Encoding UTF8 -LiteralPath $PromptFile).Trim()
    # Windows PowerShell 5.1 doesn't escape embedded double quotes for native commands.
    if ($prompt) { $claudeArgs += ($prompt -replace '"', "'") }
  }
  # hq-settings.json turns Remote Control off for HQ only, so each restart doesn't leave a dead
  # session in your Claude app. Recovery is the watchdog + "!restart hq".
  $claudeArgs += @('--settings', (Join-Path $HqDir 'hq-settings.json'))
  $claudeArgs += @('--chrome', '--permission-mode', $PermissionMode, '--dangerously-load-development-channels', 'server:slack-hq')

  Write-Host "$(Get-Date -Format s)  starting: claude $($claudeArgs[-4..-1] -join ' ')"
  Write-HqFile (Join-Path $LogDir 'hq-launcher.log') "$(Get-Date -Format s) start (pid $PID)"
  if ($AutoConfirm) {
    # A hidden helper watches this console for the warning screen and writes Enter straight
    # into its input buffer (no focus needed, works while locked). Option 1 is pre-selected.
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', "`"$(Join-Path $HqDir 'confirm-dev-channels.ps1')`"",
      '-TargetPid', $PID,
      '-TimeoutSeconds', $ConfirmTimeoutSeconds,
      '-LogFile', "`"$(Join-Path $LogDir 'hq-launcher.log')`""
    ) | Out-Null
  }
  & claude @claudeArgs
  $code = $LASTEXITCODE
  Write-HqFile (Join-Path $LogDir 'hq-launcher.log') "$(Get-Date -Format s) claude exited ($code)"

  if ($Once) { break }
  Write-Host "claude exited ($code). Restarting in 15 s - press Ctrl+C to stop."
  Start-Sleep -Seconds 15
}
