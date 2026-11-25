# Keeps the UseHold payout desk running: the site and API on 127.0.0.1:8973, a payout round every 10 minutes and the
# public tunnel the Vercel site talks to. Restarts it if it ever exits, logs to engine_run.log.
#
# Test mode (nothing is sent):   powershell -NoProfile -ExecutionPolicy Bypass -File usehold\run.ps1
# Live (pays real holders):      $env:USEHOLD_DRY = "0"; powershell -NoProfile -ExecutionPolicy Bypass -File usehold\run.ps1
# This machine only (no tunnel):   $env:USEHOLD_TUNNEL = "0" before the command; the site is then http://localhost:8973
# Pause the rounds without stopping the site: create the file %USERPROFILE%\usehold.stop
$env:PYTHONUTF8 = "1"
$env:USEHOLD_DESK = "1"
if (-not $env:USEHOLD_TUNNEL) { $env:USEHOLD_TUNNEL = "1" }   # "0" = this machine only, no public tunnel
if (-not $env:USEHOLD_DRY) { $env:USEHOLD_DRY = "1" }
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
while ($true) {
  Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] starting engine/server.py (USEHOLD_DRY=" + $env:USEHOLD_DRY + ")")
  py -u engine/server.py 2>&1 | Tee-Object -FilePath engine_run.log -Append
  Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] exited, restarting in 5 s")
  Start-Sleep -Seconds 5
}
