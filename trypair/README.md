# TryPair — trypair.app

Launch a coin. Get paid to pair it.

* **Root**: a coin launched here, paired with SOL. In the launch transaction its pump.fun creator fee is split with
  pump.fun's fee sharing: the payout wallet first (50–100%, the launcher picks: this is the pair builders' pot) and the
  launcher for the rest. The admin is revoked, so the split can never change.
* **Pair**: any pump.fun coin whose quote asset is a root (pump.fun accepts any pump coin as a quote). Every buy of a pair
  buys the root first and locks it in the pair's curve, then in its PumpSwap pool. A pair keeps its own creator fee
  (0.01–3%, paid in the root) and its creator is also paid part of the root's fees.
* **The split** (every 10 min per root): `root locked × seconds locked × lock multiplier (1x → 3x, tau 3 days)`, sampled
  every minute. Pairs are discovered on chain (`getProgramAccounts` on pump.fun, quote mint at byte 83 of the curve), so
  pairs launched anywhere count. Pairs locking under 0.1 SOL of root do not count. Paid in SOL to the pair's creator.

```
trypair/
  engine/        pairs.py (the pair desk), launch.py (root + pair launches), server.py (site + API), desk.py, books.py, op/
  web/ site_src/ api/ tools/ run.ps1 go_live.ps1     as in usehold (port 8975, key %USERPROFILE%\trypair_key.txt)
```

Going live: the same steps as usehold/README.md with `trypair` in every name. `py trypair/engine/pairs.py scan <root mint>`
lists every pair of a root and what it locks, without touching anything.
