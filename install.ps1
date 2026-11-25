<#
.SYNOPSIS
  Sets up an always-on Claude Code HQ on this Windows PC: the Slack bridge, the department
  agents, the company files, the HQ folder's permissions, the slack-hq MCP registration and
  three Task Scheduler jobs (start at logon, 04:00 restart, 15-min watchdog).

.DESCRIPTION
  Safe to re-run. It never overwrites your live state:
    - company\ files and the project settings are copied only where they don't exist yet
      (a differing settings file is saved beside yours as settings.from-template.json).
    - Existing agents are backed up to ~\.claude\agents\.backup-<date>\ before being replaced.
    - An existing slack-hq registration and existing 'Claude HQ - *' tasks are left alone.
  -Force overwrites company files and settings, and re-registers slack-hq and the tasks.

  It never reads or fills in .env. It creates it from env.example for you to fill in.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -WorkDir "$HOME\HQ" -DryRun
  powershell -ExecutionPolicy Bypass -File install.ps1 -WorkDir "$HOME\HQ"
#>
param(
  # The HQ working folder: the HQ session runs here and company\ lives here.
  [string]$WorkDir = '',
  [switch]$SkipTasks,
  [switch]$SkipTests,
  [switch]$Force,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
$Bridge = Join-Path $Repo 'bridge'
$AgentsDir = Join-Path $HOME '.claude\agents'
$LocalCfg = Join-Path $Bridge 'hq.local.json'
$todo = New-Object System.Collections.Generic.List[string]

function Step([string]$what, [scriptblock]$do) {
  if ($DryRun) { Write-Host "[dry-run] $what" -ForegroundColor Cyan; return }
  Write-Host "-> $what"
  & $do
}
function Same([string]$a, [string]$b) {
  (Test-Path -LiteralPath $b) -and ((Get-FileHash -LiteralPath $a).Hash -eq (Get-FileHash -LiteralPath $b).Hash)
}

# --- 0. Prerequisites and HQ folder ---
foreach ($cmd in 'claude', 'node', 'npm') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is not on PATH. Install it and re-run." }
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node 22 or newer is needed (found $(node --version))." }

if (-not $WorkDir -and (Test-Path $LocalCfg)) { $WorkDir = (Get-Content -Raw $LocalCfg | ConvertFrom-Json).workDir }
if (-not $WorkDir) {
  $default = Join-Path $HOME 'HQ'
  $answer = Read-Host "HQ folder (the session runs here, company\ lives here) [$default]"
  $WorkDir = if ($answer) { $answer } else { $default }
}
$WorkDir = [IO.Path]::GetFullPath($WorkDir)
if ($WorkDir.StartsWith($Repo, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Pick an HQ folder outside this repo: HQ writes company\ there every day.'
}
Write-Host "HQ folder: $WorkDir"
Step "create $WorkDir and save it to bridge\hq.local.json" {
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  (@{ workDir = $WorkDir } | ConvertTo-Json) | Set-Content -LiteralPath $LocalCfg -Encoding UTF8
}

# --- 1. Bridge dependencies + tests ---
Step "npm install in $Bridge" { Push-Location $Bridge; try { npm install --no-fund --no-audit } finally { Pop-Location } }
if (-not $SkipTests) {
  Step 'npm test' { Push-Location $Bridge; try { npm test; if ($LASTEXITCODE) { throw 'bridge tests failed' } } finally { Pop-Location } }
}

# --- 2. .env (never read or filled in here) ---
$envFile = Join-Path $Bridge '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  Step "create $envFile from env.example" { Copy-Item (Join-Path $Bridge 'env.example') $envFile }
  $todo.Add("Fill in $envFile (bridge\README.md sections 1-2). Never paste the tokens into a chat.")
}

# --- 3. Agents ---
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($a in Get-ChildItem (Join-Path $Repo 'agents') -Filter 'hq-*.md') {
  $dest = Join-Path $AgentsDir $a.Name
  if (Same $a.FullName $dest) { continue }
  Step "agent $($a.Name)" {
    New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null
    if (Test-Path -LiteralPath $dest) {
      $bak = Join-Path $AgentsDir ".backup-$stamp"
      New-Item -ItemType Directory -Force -Path $bak | Out-Null
      Copy-Item -LiteralPath $dest -Destination $bak
    }
    Copy-Item -LiteralPath $a.FullName -Destination $dest -Force
  }
}

# --- 4. Company files (only fill gaps unless -Force) ---
$srcCo = Join-Path $Repo 'company'
$dstCo = Join-Path $WorkDir 'company'
$copied = 0
foreach ($f in Get-ChildItem -LiteralPath $srcCo -Recurse -File) {
  $dest = Join-Path $dstCo $f.FullName.Substring($srcCo.Length).TrimStart('\')
  if ((Test-Path -LiteralPath $dest) -and -not $Force) { continue }
  if (Same $f.FullName $dest) { continue }
  $copied++
  if ($DryRun) { continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
}
Write-Host "$(if ($DryRun) { '[dry-run] would copy' } else { '-> copied' }) $copied company file(s) to $dstCo"
if ($copied) { $todo.Add("Fill in $dstCo\strategy.md, autonomy.md and each departments\*\brief.md (look for FILL IN).") }

# --- 5. HQ folder permissions ---
$srcSet = Join-Path $Repo 'config\project-settings.json'
$dstSet = Join-Path $WorkDir '.claude\settings.json'
if (-not (Test-Path -LiteralPath $dstSet) -or $Force) {
  if (-not (Same $srcSet $dstSet)) {
    Step "permissions -> $dstSet" { New-Item -ItemType Directory -Force -Path (Split-Path $dstSet) | Out-Null; Copy-Item $srcSet $dstSet -Force }
  }
} elseif (-not (Same $srcSet $dstSet)) {
  $side = Join-Path (Split-Path $dstSet) 'settings.from-template.json'
  Step "your settings differ: saving the template's as $side" { Copy-Item $srcSet $side -Force }
  $todo.Add("Compare $dstSet with settings.from-template.json beside it.")
}

# --- 6. slack-hq MCP registration (local scope, for the HQ folder) ---
$server = Join-Path $Bridge 'src\server.js'
if ($DryRun -and -not (Test-Path -LiteralPath $WorkDir)) {
  Write-Host "[dry-run] register slack-hq -> $server (in $WorkDir)" -ForegroundColor Cyan
} else {
  Push-Location -LiteralPath $WorkDir
  try {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # PS 5.1 turns native stderr into errors
    $null = & claude mcp get slack-hq 2>&1
    $registered = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $eap
    if ($registered -and $Force) {
      Step 'remove old slack-hq registration' { & claude mcp remove slack-hq -s local | Out-Null }
      $registered = $false
    }
    if (-not $registered) {
      Step "register slack-hq -> $server" { & claude mcp add --scope local slack-hq -- node $server }
    } else { Write-Host 'slack-hq already registered (use -Force to re-register)' }
  } finally { Pop-Location }
}

# --- 7. Task Scheduler (runs only while you're logged on; no admin needed) ---
if (-not $SkipTasks) {
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $long = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $short = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
  $t1 = New-ScheduledTaskTrigger -AtLogOn -User $user; $t1.Delay = 'PT30S'
  $tasks = @(
    @{ Name = 'Claude HQ - start at logon'; Settings = $long; Trigger = $t1
       Arg = "-NoExit -ExecutionPolicy Bypass -File `"$Bridge\start-hq.ps1`" -AutoConfirm"
       Desc = 'Starts the Claude HQ session with the slack-hq channel' },
    @{ Name = 'Claude HQ - nightly restart'; Settings = $long; Trigger = (New-ScheduledTaskTrigger -Daily -At 04:00)
       Arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Bridge\restart-hq.ps1`""
       Desc = 'Closes and reopens the Claude HQ window (fresh context; state is in files)' },
    @{ Name = 'Claude HQ - watchdog'; Settings = $short
       Trigger = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 15))
       Arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Bridge\watchdog-hq.ps1`""
       Desc = 'Restarts a silent Claude HQ session (max 2 per 6 h); reads !restart hq in #ceo' }
  )
  foreach ($t in $tasks) {
    if ((Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) -and -not $Force) {
      Write-Host "task '$($t.Name)' exists (use -Force to re-register)"; continue
    }
    Step "register task '$($t.Name)'" {
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $t.Arg -WorkingDirectory $Bridge
      Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $t.Trigger -Settings $t.Settings `
        -Description $t.Desc -Force | Out-Null
    }
  }
}

# --- Done ---
Write-Host ''
Write-Host 'Install finished.' -ForegroundColor Green
$todo.Add('In the Claude desktop app: turn on keep-awake. In claude.ai, connect the connectors your departments use (Slack, Gmail, Calendar, Atlassian, ...).')
$todo.Add("Start HQ: Start-ScheduledTask 'Claude HQ - start at logon'. Then check #agent-log for 'HQ online' and run the live test in bridge\README.md.")
Write-Host 'Still to do by hand:'
$todo | ForEach-Object { Write-Host "  - $_" }
