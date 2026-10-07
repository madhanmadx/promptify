# Entry point for the Windows scheduled task "PromptifyServer".
#
# The task cannot redirect a child process's output, so this wrapper does it:
# it launches scripts\supervise.ps1 with its own log files and waits. The task
# instance therefore lives exactly as long as the supervisor does, which is what
# lets Windows restart it if it is ever killed (MultipleInstances = IgnoreNew
# keeps a second copy from starting while this one runs).
#
# Logs: <project>\logs\supervisor.out.log / .err.log
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, so a UTF-8
# em dash in here is a syntax error waiting to happen.

$proj = Split-Path -Parent $PSScriptRoot
Set-Location $proj

$logDir = Join-Path $proj 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$supervisor = Join-Path $PSScriptRoot 'supervise.ps1'
$outLog = Join-Path $logDir 'supervisor.out.log'
$errLog = Join-Path $logDir 'supervisor.err.log'

# Deliberately NO "is a supervisor already running?" check here.
#
# A command-line scan cannot tell a supervisor apart from anything else that
# happens to mention supervise.ps1 (a diagnostic shell, this file itself), so
# it refuses to start at exactly the moment it is needed. Duplicate launches
# are already prevented by the task setting MultipleInstances = IgnoreNew, and
# a second supervisor would be harmless anyway: it checks the port before
# spawning and waits while something is already serving.
Write-Output ('[boot] starting supervisor for ' + $proj)
$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $supervisor + '"')) `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

# Stay alive for as long as the supervisor does: that is what makes Windows
# treat this task as "running" and restart it on the next repetition if it dies.
Wait-Process -Id $proc.Id -ErrorAction SilentlyContinue
Write-Output ('[boot] supervisor PID ' + $proc.Id + ' exited')
