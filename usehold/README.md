# Hold — usehold.fun

A pump.fun launchpad where every creator fee of a coin is paid to its holders (in SOL or in the stock it is paired with),
weighted by how long they hold: `coins held × seconds held × hold multiplier (1x → 10x over a month)`.
Same engine as tryhold.fun, its own payout wallet, its own books, and a new site.

```
usehold/
  engine/      the payout desk + site/API server (Python, solders)      py engine/server.py
  web/         the published site (Vercel serves it; built pages + assets)
  site_src/    page sources; py site_src/build.py writes web/*.html
  api/gate.py  Vercel function: forwards /api, /img, /meta to the desk through its tunnel
  tools/       wallet.py (payout wallet), deploy.py (points the site at the tunnel), seed_ui.py (test data)
  run.ps1      keeps the desk running (port 8973)      go_live.ps1  desk + tunnel + deploy in one go
```

## Going live (Windows, the same PC as tryhold)

1. `pip install solders base58` (already there if tryhold runs) and `winget install Cloudflare.cloudflared`.
2. `py usehold/tools/wallet.py` creates the payout wallet in `%USERPROFILE%\usehold_key.txt` (never shared, never committed)
   and writes its address to `engine/config.json`. Send it ~0.05 SOL for network fees.
3. A paid RPC is read from `%USERPROFILE%\usehold_rpc.txt`, or from the `holdlonger_rpc.txt` tryhold already uses.
4. Test without sending anything: `powershell -NoProfile -ExecutionPolicy Bypass -File usehold\run.ps1` (DRY), open http://localhost:8973.
5. Live: `powershell -NoProfile -File usehold\go_live.ps1`. It starts the desk with its tunnel and deploys the site against it.
   Run it again after a reboot. Pause payouts without stopping the site: create `%USERPROFILE%\usehold.stop`.
6. Domain: usehold.fun is added to the Vercel project "usehold"; point its DNS at Vercel (A 76.76.21.21 or the records Vercel shows).
