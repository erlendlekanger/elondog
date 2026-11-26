# Sets up and starts usehold.fun, trypair.app and usepve.xyz on THIS Windows PC, in one go:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File start_all.ps1
#
#   1. installs what is missing: Python, Node.js (for the Vercel CLI) and cloudflared (the public tunnel)
#   2. installs the Python packages the payout desks use (solders, base58)
#   3. creates one payout wallet per site, in your user folder, and prints the addresses to fund
#      (%USERPROFILE%\usehold_key.txt, trypair_key.txt, usepve_key.txt: never share them, never commit them)
#   4. asks once for your Phantom address, the only wallet allowed to launch PVE itself (genesis)
#   5. logs in to Vercel if this PC is not logged in yet
#   6. starts all three desks LIVE, each with its own tunnel, and points each site at it
#
# Add -NoStart to do steps 1 to 5 only. Run it again after a reboot: the wallets are kept, never overwritten.
param([switch]$NoStart)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$sites = @("usehold", "trypair", "usepve")
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Need($cmd, $id, $what) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { return }
  Write-Host "installing $what ..."
  winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Null
  Refresh-Path
}

Write-Host "`n== 1. tools" -ForegroundColor Cyan
Need "py" "Python.Python.3.12" "Python"
Need "npx" "OpenJS.NodeJS.LTS" "Node.js"
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf -and -not (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared*\cloudflared.exe" -ErrorAction SilentlyContinue)) {
  Write-Host "installing cloudflared ..."
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements --silent | Out-Null
  Refresh-Path
}

Write-Host "`n== 2. Python packages" -ForegroundColor Cyan
py -m pip install --quiet --upgrade pip solders base58
if ($LASTEXITCODE -ne 0) { throw "pip could not install solders/base58" }

Write-Host "`n== 3. payout wallets" -ForegroundColor Cyan
$env:PYTHONUTF8 = "1"
$addr = @{}
foreach ($s in $sites) {
  $out = py "$s\tools\wallet.py"
  if ($LASTEXITCODE -ne 0) { throw "$s wallet failed" }
  $addr[$s] = ([regex]::Match(($out -join " "), "[1-9A-HJ-NP-Za-km-z]{32,44}")).Value
}

Write-Host "`n== 4. PVE owner (the wallet that launches PVE itself)" -ForegroundColor Cyan
$owner = py -c "import json;print(json.load(open('usepve/engine/config.json'))['owner'])"
if (-not $owner) {
  $owner = (Read-Host "Paste YOUR Phantom address (Enter to skip, you can set it later in usepve\engine\config.json)").Trim()
  if ($owner) {
    py -c "import json,sys;p='usepve/engine/config.json';c=json.load(open(p));c['owner']=sys.argv[1];open(p,'w').write(json.dumps(c,indent=2)+'\n')" $owner
    Write-Host "PVE owner set to $owner"
  }
} else { Write-Host "PVE owner: $owner" }

Write-Host "`n== 5. Vercel" -ForegroundColor Cyan
npx --yes vercel whoami 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "log in to Vercel in the browser window that opens ..."; npx --yes vercel login }

Write-Host "`n== Fund these payout wallets (about 0.05 SOL each, for Solana network fees)" -ForegroundColor Yellow
foreach ($s in $sites) { Write-Host ("  {0,-8} {1}" -f $s, $addr[$s]) }
Write-Host "  The keys are in $env:USERPROFILE\<site>_key.txt. Back them up somewhere safe. Never share them."

if ($NoStart) { Write-Host "`nSetup done. Start everything with: powershell -NoProfile -ExecutionPolicy Bypass -File start_all.ps1"; exit 0 }

Write-Host "`n== 6. starting the three desks (live), each with its tunnel, and deploying the sites" -ForegroundColor Cyan
foreach ($s in $sites) {
  Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", (Join-Path $root "$s\go_live.ps1")
  Start-Sleep -Seconds 3
}
Write-Host "`nThree windows opened, one per site. Each says 'now talks to the engine on this machine' when it is live:"
Write-Host "  https://usehold.fun   https://trypair.app   https://usepve.xyz"
Write-Host "Keep this PC on. Pause payouts without stopping a site: create %USERPROFILE%\<site>.stop"
