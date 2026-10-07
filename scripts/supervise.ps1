# Keeps Promptify alive during the event.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\supervise.ps1
#
# Why PowerShell and not Node: the thing that kills the server is usually
# `taskkill /IM node.exe` or a stray Ctrl+C. A Node supervisor dies with it,
# this one survives and brings the server straight back.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads scripts as ANSI unless
# there is a BOM, so a UTF-8 em dash in here is a syntax error waiting to move in.

$proj = Split-Path -Parent $PSScriptRoot
Set-Location $proj

function Test-Port([int]$port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $port)
    $c.Close()
    return $true
  } catch { return $false }
}

$port = 3000
if ($env:PORT) { $port = [int]$env:PORT }

# PORT also lives in .env - read it so we watch the port that is actually used
$envFile = Join-Path $proj '.env'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT=' } | Select-Object -First 1
  if ($line -match '^\s*PORT=(\d+)') { $port = [int]$Matches[1] }
}

Write-Output ("[supervisor] watching port {0} in {1}" -f $port, $proj)

$runs = 0
while ($true) {
  if (Test-Port $port) {
    # someone else is already serving - do not fight them, just keep watching
    Start-Sleep -Seconds 5
    continue
  }

  $runs++
  $stamp = Get-Date -Format 'HH:mm:ss'
  Write-Output ("[supervisor] starting server (run #{0}) at {1}" -f $runs, $stamp)
  $t0 = Get-Date

  & node server/index.js
  $code = 0
  if ($LASTEXITCODE -ne $null) { $code = $LASTEXITCODE }
  $uptime = [math]::Round(((Get-Date) - $t0).TotalSeconds)

  Write-Output ("[supervisor] server exited (code {0}) after {1}s - restarting" -f $code, $uptime)

  # a crash-loop needs cooling off, not a tight spin
  if ($uptime -lt 10) { Start-Sleep -Seconds 10 } else { Start-Sleep -Seconds 2 }
}
