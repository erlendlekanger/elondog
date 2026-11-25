"""The books: one JSON file with every coin, every holder's credit and every payout, plus an append-only
ledger (ledger.jsonl) with one line per on-chain event. Both live in TRYPAIR_STATE_DIR (default engine/state).
Besides the money it keeps how long each wallet has held each coin.

All amounts are lamports (SOL) unless the field says raw (token base units). Per coin the books always balance:

    collected  =  sent to holders  +  network fees  +  waiting

    collected        every lamport that reached the payout wallet from the coin's fee vaults (claim transactions)
    sent             lamports spent on the holders: swapped into their asset, rent of their new token accounts
                     (which sits in their own account), or sent to them as SOL
    fees             Solana transaction fees of the coin's claims, swaps and payout transactions
    waiting          credit owed to holders that is not sent yet + collected fees not yet split
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_DIR = Path(os.environ.get("TRYPAIR_STATE_DIR", "").strip() or (ROOT / "state"))
STATE_FILE = STATE_DIR / "state.json"
LEDGER_FILE = STATE_DIR / "ledger.jsonl"
IMAGES = STATE_DIR / "images"
LOCK = threading.RLock()
EVENTS_KEPT = 600
ROUNDS_KEPT = 300


def _blank() -> dict:
    # coins = the ROOTS (coins whose fees route here); pairs[root][pair] = every coin paired against that root;
    # pair_earned[root][pair] = lamports credited to that pair's creator for it; pending_pairs = pair launches not seen yet
    return {"coins": {}, "credit": {}, "paid": {}, "owed_assets": {}, "pending": {}, "held": {}, "events": [], "rounds": [],
            "pairs": {}, "pair_earned": {}, "pending_pairs": {}, "root": "",
            "totals": {"collected": 0, "sent": 0, "fees": 0, "setup": 0, "payouts": 0, "transfers": 0}}


_state: dict | None = None


def state() -> dict:
    global _state
    with LOCK:
        if _state is None:
            try:
                _state = json.loads(STATE_FILE.read_text(encoding="utf-8-sig"))
            except FileNotFoundError:
                _state = _blank()
            for k, v in _blank().items():
                _state.setdefault(k, v)
        return _state


def save() -> None:
    with LOCK:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state(), separators=(",", ":")), encoding="utf-8")   # plain UTF-8, no BOM
        os.replace(tmp, STATE_FILE)


def event(kind: str, **kw) -> dict:
    """One on-chain fact for the public ledger. Written to the state (last EVENTS_KEPT) and to ledger.jsonl (all)."""
    e = {"t": int(time.time()), "kind": kind, **kw}
    with LOCK:
        st = state()
        st["events"].append(e)
        st["events"] = st["events"][-EVENTS_KEPT:]
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with LEDGER_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(e, separators=(",", ":")) + "\n")
    return e


def coin(mint: str) -> dict | None:
    return state()["coins"].get(mint)


def new_coin(mint: str, **kw) -> dict:
    with LOCK:
        c = state()["coins"].setdefault(mint, {
            "mint": mint, "name": "", "symbol": "", "launcher": "", "created_at": int(time.time()), "assets": [],
            "next": 0, "pot": 0, "fee_debt": 0, "collected": 0, "sent": 0, "fees": 0, "rounds": 0, "transfers": 0,
            "last_collect_at": None, "last_payout_at": None, "status": "live", "note": "", "parent": None,
            "mcap_lamports": 0, "mcap_at": None})
        for k, v in kw.items():
            if v not in (None, "") or k not in c:
                c[k] = v
        return c


def waiting(mint: str) -> int:
    """Lamports this coin still owes its holders (credit + unsplit pot - fees not yet charged + swapped but undelivered)."""
    st = state()
    c = st["coins"].get(mint) or {}
    credit = sum(int(v) for v in (st["credit"].get(mint) or {}).values())
    owed = sum(int(o.get("sol") or 0) for o in (st["owed_assets"].get(mint) or []))
    raw = sum(int(v) for v in ((st.get("credit_raw") or {}).get(mint) or {}).values()) + int(c.get("pot_raw") or 0)
    return credit + owed + int(c.get("pot") or 0) - int(c.get("fee_debt") or 0) + int(raw * float(c.get("px_raw") or 0))


def totals() -> dict:
    st = state()
    t = dict(st["totals"])
    t["waiting"] = sum(waiting(m) for m in st["coins"])
    t["coins"] = len(st["coins"])
    holders = set()
    for per in st["paid"].values():
        holders.update(per)
    t["builders_paid"] = len(holders)
    return t
