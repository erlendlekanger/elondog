"""Seeds a TEST state for looking at the pages with rows in them (never the real engine's state).

    py tools/seed_ui.py <state dir> [single]
then run the server with USEPVE_STATE_DIR=<state dir> on another port. Refuses to write into engine/state.
"single" seeds one root (for a single-root site such as PVE) and prints its mint; set it as "root" in a test config.
"""
import json
import random
import sys
import time
from pathlib import Path

out = Path(sys.argv[1]).resolve()
single = len(sys.argv) > 2 and sys.argv[2] == "single"
if (Path(__file__).resolve().parents[1] / "engine" / "state").resolve() == out:
    sys.exit("refusing to seed the real engine state")
out.mkdir(parents=True, exist_ok=True)
random.seed(11)
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
addr = lambda: "".join(random.choice(B58) for _ in range(44))
now = int(time.time())
coins, pairs, earned, held, events, paid, credit = {}, {}, {}, {}, [], {}, {}
specs = [("Test Dog", "TDOG", 1_840e9, 14), ("Test Frog", "TFROG", 420e9, 7), ("Test Cat", "TCAT", 96e9, 3)]
if single:
    specs = [("Test PVE", "TPVE", 2_400e9, 18)]
NAMES = ["Test Shiba", "Test Puppy", "Test Bone", "Test Leash", "Test Bark", "Test Wolf", "Test Fetch", "Test Paw",
         "Test Kennel", "Test Howl", "Test Collar", "Test Treat", "Test Sniff", "Test Tail", "Test Fur", "Test Pack",
         "Test Den", "Test Pup"]
for name, sym, mc, n in specs:
    m = addr()[:40] + "pump"
    supply = 1_000_000_000_000_000
    px = mc / supply
    book, w, last, age = {}, {}, {}, {}
    total = 0
    for i in range(n):
        p = addr()[:40] + "pump"
        locked = int(supply * random.uniform(.002, .06))
        total += locked
        a = random.uniform(0, 9) * 86400
        mult = 1 + 2 * (1 - pow(2.718281828, -a / (3 * 86400)))
        creator = addr()
        nm = NAMES[i % len(NAMES)]
        book[p] = {"mint": p, "name": nm, "symbol": nm.split()[-1].upper()[:6], "creator": creator, "locked": locked,
                   "locked_lamports": int(locked * px), "counted": i < n - 1, "complete": i == 0, "fee_bps": random.choice([50, 100, 200, 300]),
                   "age_s": int(a), "mult": round(mult, 3), "launched_here": i % 3 != 2, "created_at": now - int(a) - 3600,
                   "first_seen": now - int(a) - 3600, "mcap_lamports": int(random.uniform(8, 300) * 1e9)}
        if i < n - 1:
            last[p] = locked
            w[p] = locked * random.uniform(200, 600) * mult
            age[p] = a
        earned.setdefault(m, {})[p] = random.randint(5, 400) * 10_000_000
        paid.setdefault(m, {})[creator] = {"sol": earned[m][p], "n": random.randint(1, 9)}
    coins[m] = {"mint": m, "name": name, "symbol": sym, "launcher": addr(), "created_at": now - 12 * 86400, "assets": ["So11111111111111111111111111111111111111112"],
                "next": 0, "pot": 90_000_000, "fee_debt": 0, "collected": 8_400_000_000, "sent": 7_900_000_000, "fees": 100_000,
                "rounds": 40, "transfers": 300, "status": "live", "mcap_lamports": int(mc), "supply": supply, "px_raw": px,
                "pairs": n, "pairs_counted": n - 1, "locked_total": total, "locked_lamports": int(total * px),
                "locked_pct": round(total / supply * 100, 3), "pairs_bps": 8000 if not single else 10000,
                "description": "A test root for looking at the page.", "last_payout_at": now - 300}
    pairs[m] = book
    held[m] = {"w": w, "t": now, "last": last, "since": now - 400, "age": age, "amt": dict(last)}
    for k in range(6):
        events.append({"kind": "collect", "coin": m, "lamports": random.randint(50, 400) * 1_000_000, "t": now - k * 700, "sig": addr() + addr()[:44]})
        events.append({"kind": "pay", "coin": m, "lamports": random.randint(50, 400) * 1_000_000, "holders": random.randint(2, n), "t": now - k * 700 + 30, "sig": addr() + addr()[:44]})
    for p in list(book)[:3]:
        events.append({"kind": "pair", "coin": m, "pair": p, "launcher": book[p]["creator"], "t": now - random.randint(100, 9000), "sig": addr() + addr()[:44]})
events.sort(key=lambda e: e["t"])
st = {"coins": coins, "credit": credit, "paid": paid, "owed_assets": {}, "pending": {}, "held": held, "events": events, "rounds": [],
      "pairs": pairs, "pair_earned": earned, "pending_pairs": {}, "root": list(coins)[0] if single else "",
      "totals": {"collected": 9_800_000_000, "sent": 9_100_000_000, "fees": 200_000, "setup": 0, "payouts": 80, "transfers": 600},
      "last_tick": now - 200}
(out / "state.json").write_text(json.dumps(st), encoding="utf-8")
print("seeded", out, list(coins)[0] if single else "")
