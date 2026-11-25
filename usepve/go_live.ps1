# Makes usepve.xyz real: restarts the PVE engine WITH its public tunnel, waits for the tunnel's address
# and deploys the site against it, Run it yourself, and again after a reboot:
#
#   powershell -NoProfile -File usepve\go_live.ps1
#
# It opens a Cloudflare tunnel from this machine to the internet (that is how the public site reaches the engine),
# so it is yours to start. The engine keeps the mode it is given: live unless USEPVE_DRY is "1".
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 1. stop the engine that is running on this machine now (the loop first, so it does not restart it)
$conn = Get-NetTCPConnection -LocalPort 8977 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $chain = @()
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  while ($p -and $p.Name -match '^(python|py|powershell)') {
    if ($p.Name -match '^powershell' -and $p.CommandLine -notmatch 'usepve\\run\.ps1') { break }
    $chain += $p
    if ($p.Name -match '^powershell') { break }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
  }
  [array]::Reverse($chain)
  foreach ($c in $chain) { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  Write-Host "stopped the engine that was running"
}

# 2. start it again with the tunnel
if (-not $env:USEPVE_DRY) { $env:USEPVE_DRY = "0" }
$env:USEPVE_TUNNEL = "1"
$mark = if (Test-Path engine_run.log) { (Get-Item engine_run.log).Length } else { 0 }
Start-Process powershell -ArgumentList '-NoProfile', '-File', (Join-Path $root 'run.ps1') -WindowStyle Hidden
Write-Host "engine starting (USEPVE_DRY=$($env:USEPVE_DRY)), waiting for the tunnel ..."

# 3. wait for this start's tunnel address in the log (the log is UTF-16)
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path engine_run.log) {
    # the running engine keeps the log open for writing, so read it with sharing on (ReadAllBytes is refused)
    $bytes = $null
    try {
      $fs = [System.IO.File]::Open((Join-Path $root 'engine_run.log'), 'Open', 'Read', 'ReadWrite')
      try { $bytes = New-Object byte[] $fs.Length; [void]$fs.Read($bytes, 0, $bytes.Length) } finally { $fs.Close() }
    } catch { continue }
    if ($bytes.Length -gt $mark) {
      $text = [System.Text.Encoding]::Unicode.GetString($bytes, $mark - ($mark % 2), $bytes.Length - $mark + ($mark % 2))
      $m = [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($m.Count) { $url = $m[$m.Count - 1].Value }
    }
  }
}
if (-not $url) { Write-Host "no tunnel address after 2 minutes; look at usepve\engine_run.log"; exit 1 }
Write-Host "tunnel: $url"
Start-Sleep -Seconds 6

# 4. deploy the real site against it
$env:PYTHONUTF8 = "1"
py tools/deploy.py
if ($LASTEXITCODE -ne 0) { Write-Host "the deploy failed"; exit 1 }
Write-Host "usepve.xyz now talks to the engine on this machine. Keep this PC on."
