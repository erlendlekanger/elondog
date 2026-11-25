# Keeps the PVE payout desk running: the site and API on 127.0.0.1:8977, a payout round every 10 minutes and the
# public tunnel the Vercel site talks to. Restarts it if it ever exits, logs to engine_run.log.
#
# Test mode (nothing is sent):   powershell -NoProfile -ExecutionPolicy Bypass -File usepve\run.ps1
# Live (pays real holders):      $env:USEPVE_DRY = "0"; powershell -NoProfile -ExecutionPolicy Bypass -File usepve\run.ps1
# This machine only (no tunnel):   $env:USEPVE_TUNNEL = "0" before the command; the site is then http://localhost:8977
# Pause the rounds without stopping the site: create the file %USERPROFILE%\usepve.stop
$env:PYTHONUTF8 = "1"
$env:USEPVE_DESK = "1"
if (-not $env:USEPVE_TUNNEL) { $env:USEPVE_TUNNEL = "1" }   # "0" = this machine only, no public tunnel
if (-not $env:USEPVE_DRY) { $env:USEPVE_DRY = "1" }
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
while ($true) {
  Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] starting engine/server.py (USEPVE_DRY=" + $env:USEPVE_DRY + ")")
  py -u engine/server.py 2>&1 | Tee-Object -FilePath engine_run.log -Append
  Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] exited, restarting in 5 s")
  Start-Sleep -Seconds 5
}
