<#
.SYNOPSIS
  Nightly restart of the HQ session (Task Scheduler, 04:00).
  Closes the HQ window started by start-hq.ps1 (and its claude + slack-hq children),
  then opens a fresh one. All HQ state lives in files, so nothing is lost.
#>
$ErrorActionPreference = 'Continue'

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
$PidFile = Join-Path $LogDir 'hq-window.pid'
$Log = Join-Path $LogDir 'hq-launcher.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Test-Path $PidFile) {
  $old = [int](Get-Content $PidFile -Raw)
  $proc = Get-Process -Id $old -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -match '^(powershell|pwsh)$') {
    Write-HqFile $Log "$(Get-Date -Format s) restart: stopping HQ window pid $old"
    # /T kills the whole tree: the window's PowerShell, claude, and node (slack-hq).
    taskkill.exe /PID $old /T /F | Out-Null
    Start-Sleep -Seconds 5
  }
}

# Belt and braces: release a stale Slack socket lock if its owner is gone.
$Lock = Join-Path $LogDir 'slack-hq.lock'
if (Test-Path $Lock) {
  $lp = [int](Get-Content $Lock -Raw)
  if (-not (Get-Process -Id $lp -ErrorAction SilentlyContinue)) { Remove-Item $Lock -Force }
}

Write-HqFile $Log "$(Get-Date -Format s) restart: starting new HQ window"
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $HqDir 'start-hq.ps1')`"", '-AutoConfirm'
)
