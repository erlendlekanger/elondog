"""Seeds a TEST state for looking at the pages with rows in them (never the real engine's state).

    py usehold/tools/seed_ui.py <state dir>
then run the server with USEHOLD_STATE_DIR=<state dir> on another port (launch.json "usehold-ui-test", 8974).
Refuses to write into engine/state.
"""
import json
import random
import sys
import time
from pathlib import Path

out = Path(sys.argv[1]).resolve()
if (Path(__file__).resolve().parents[1] / "engine" / "state").resolve() == out:
    sys.exit("refusing to seed the real engine state")
out.mkdir(parents=True, exist_ok=True)
random.seed(7)
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
addr = lambda: "".join(random.choice(B58) for _ in range(44))
now = int(time.time())
coins, held, events, paid = {}, {}, [], {}
for name, sym, mc, n in (("Test Coin One", "TEST1", 420e9, 38), ("Test Coin Two", "TEST2", 95e9, 14)):
    m = addr()[:40] + "test"
    supply = 1_000_000_000_000_000
    last, age, amt = {}, {}, {}
    for i in range(n):
        o = addr()
        a = int(supply * random.uniform(.0008, .03))
        last[o] = amt[o] = a
        age[o] = random.uniform(0, 25) * 86400
    coins[m] = {"mint": m, "name": name, "symbol": sym, "launcher": addr(), "created_at": now - 26 * 86400, "assets": [], "next": 0, "pot": 120_000_000,
                "fee_debt": 0, "collected": 3_400_000_000, "sent": 3_180_000_000, "fees": 100_000, "rounds": 40, "transfers": 900, "status": "live",
                "mcap_lamports": int(mc), "holders": n, "supply": supply, "avg_hold_s": int(sum(age.values()) / n), "avg_mult": 6.2,
                "description": "A test coin for looking at the page."}
    held[m] = {"w": {}, "t": now, "last": last, "since": now, "age": age, "amt": amt}
    paid[m] = {o: {"sol": random.randint(1, 90) * 1_000_000, "n": 3} for o in list(last)[:20]}
    for k in range(6):
        events.append({"kind": "collect", "coin": m, "lamports": random.randint(50, 400) * 1_000_000, "t": now - k * 700, "sig": addr() + addr()[:44]})
        events.append({"kind": "pay", "coin": m, "lamports": random.randint(50, 400) * 1_000_000, "holders": n, "t": now - k * 700 + 30, "sig": addr() + addr()[:44]})
events.sort(key=lambda e: e["t"])
st = {"coins": coins, "credit": {}, "paid": paid, "owed_assets": {}, "pending": {}, "held": held, "events": events, "rounds": [],
      "totals": {"collected": 6_800_000_000, "sent": 6_360_000_000, "fees": 200_000, "setup": 0, "payouts": 80, "transfers": 1800},
      "last_tick": now - 200}
(out / "state.json").write_text(json.dumps(st), encoding="utf-8")
print("seeded", out)
