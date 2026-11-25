# PVE — usepve.xyz

The co-op coin. "The market is the boss. Every pair is a player." One root, PVE: every coin paired against PVE buys PVE
and locks it, and PVE's creator fees are paid to the people who built those pairs, by
`PVE locked × seconds locked × lock multiplier (1x → 3x)`. The same engine as trypair in single-root mode
(`"single_root": true` in engine/config.json), port 8977, key `%USERPROFILE%\usepve_key.txt`.

## Genesis (launching PVE itself)

1. `py usepve/tools/wallet.py` (payout wallet), then put YOUR Phantom address in `engine/config.json` as `"owner"`.
2. Start the desk (`usepve\go_live.ps1`), open usepve.xyz/launch with that Phantom wallet connected: a "Genesis" tab
   appears only for the owner and only while PVE is not launched. It launches PVE paired with SOL with 50–100% of its
   creator fees locked to the players (default 100%). After it lands the site switches to pair launches for everyone.
   Alternatively launch PVE elsewhere with fee sharing to the payout wallet first and set `"root"` in config.json.
3. Everything else as in usehold/README.md with `usepve` in every name.
