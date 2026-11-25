"""The pair desk. A ROOT is a coin whose pump.fun creator fees route (all or partly) to the payout wallet. A PAIR is any
pump.fun coin whose quote asset is that root: it trades against the root, so every buy of the pair is first a buy of
the root, and every root token sitting in the pair's bonding curve or PumpSwap pool is root taken off the market.

Every interval_s the desk runs one round per root:

  1. Collect   distribute_creator_fees_v2 pushes the root's fee vault out to its shareholders; the lamports that reach the
               payout wallet are this round's pot (desk.collect).
  2. Split     the pot, minus the Solana fees the root's own transactions cost, is credited to the CREATORS of the root's
               pairs, by

                 root locked in the pair  x  seconds locked  x  lock multiplier

               root locked   the root tokens in the pair's bonding curve (its real quote reserve) or, once the pair has
                             graduated, in its PumpSwap pool. Only pairs locking at least min_lock_lamports worth count.
               multiplier    1x for a pair that just started locking, climbing to hold_max (3x) with tau hold_tau_days:
                             a pair that keeps its root locked earns more than one that comes and goes.
               Pairs are found on chain (getProgramAccounts on pump.fun, quote mint at byte 83 of the bonding curve), so a
               pair launched anywhere counts, not only the ones launched on this site.
  3. Send      SOL to every creator whose credit is due (desk.pay), many per transaction.

Between rounds the desk looks at every pair every sample_s seconds, so locking just before a round earns almost nothing.
"""
from __future__ import annotations

import base64
import struct
import time
import traceback

from solders.pubkey import Pubkey

import books
import desk
from op import chain as eng
from op import pumpkit

CFG = desk.CFG
SOL = desk.SOL
log = desk.log
QUOTE_OFFSET = 83                                                 # BondingCurve.quote_mint (8 + 5*8 + 1 + 32 + 2)


def root_mints() -> list[str]:
    st = books.state()
    if CFG.get("single_root"):
        r = (CFG.get("root") or st.get("root") or "").strip()
        return [r] if r else []
    return list(st["coins"])


# ----------------------------------------------------------------------------- roots on chain
def roots_on_chain(me: str) -> list[dict]:
    """Every coin whose Pump Fees sharing config lists the payout wallet FIRST (byte 80), with the part it gets."""
    res = eng.http_json(desk.holder_rpc(), {"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": [
        str(eng.PFEE_PROGRAM), {"encoding": "base64", "filters": [{"memcmp": {"offset": 80, "bytes": me}}]}]}, timeout=40)
    if res.get("error"):
        raise desk.DeskError(f"root lookup failed: {str(res['error'])[:160]}")
    out = []
    for acc in res.get("result") or []:
        raw = base64.b64decode(acc["account"]["data"][0])
        if len(raw) < 80 + 34:
            continue
        n = struct.unpack_from("<I", raw, 76)[0]
        bps = struct.unpack_from("<H", raw, 80 + 32)[0]
        if 1 <= n <= 10 and bps >= int(CFG.get("root_pairs_bps_min", 5000)):
            out.append({"mint": str(Pubkey.from_bytes(raw[11:43])), "locked": raw[75] == 1, "bps": bps})
    return out


def discover_roots(w: desk.Wallet) -> list[str]:
    """Books every root whose fees reach the payout wallet. Single-root mode: only the configured root."""
    st = books.state()
    try:
        chain = roots_on_chain(w.me)
    except Exception as exc:  # noqa: BLE001
        log(f"root discovery failed, using the books only: {exc}")
        chain = []
    allowed = set(root_mints()) if CFG.get("single_root") else None
    with books.LOCK:
        for row in chain:
            m = row["mint"]
            if allowed is not None and m not in allowed:
                continue
            if m not in st["coins"]:
                p = st["pending"].pop(m, None) or {}
                nm, sym, dsc = (p.get("name", ""), p.get("symbol", ""), p.get("description", "")) if p else desk.coin_names(m)
                books.new_coin(m, name=nm, symbol=sym, description=dsc, launcher=p.get("launcher", ""), assets=[SOL], pair=SOL,
                               created_at=p.get("t") or int(time.time()),
                               note="" if p else "found on chain: its fees route here, so its pairs are paid like every root launched here")
                log(f"{m[:6]} root {'launched here' if p else 'found on chain'}: {nm or '?'} ({sym or '?'})")
            c = st["coins"][m]
            c["locked"], c["pairs_bps"] = row["locked"], row["bps"]
        if not desk.DRY:
            books.save()
    return root_mints()


# ----------------------------------------------------------------------------- pairs on chain
_mint_of: dict[str, str] = {}                                     # bonding curve address -> the pair coin's mint
_names: dict[str, tuple[str, str]] = {}


def mint_of_curve(curve_addr: str, root: str) -> str | None:
    """A bonding curve does not store its mint: it is the token account the curve owns that is not the root."""
    if curve_addr in _mint_of:
        return _mint_of[curve_addr]
    for prog in (str(eng.TOKEN_2022), str(eng.TOKEN_LEGACY)):
        res = eng.rpc("getTokenAccountsByOwner", [curve_addr, {"programId": prog}, {"encoding": "jsonParsed"}]) or {}
        for a in res.get("value") or []:
            m = a["account"]["data"]["parsed"]["info"]["mint"]
            if m != root:
                if str(pumpkit.bonding_curve_pda(Pubkey.from_string(m))) == curve_addr:
                    _mint_of[curve_addr] = m
                    return m
    return None


def payee_of(pair: str, creator: str) -> str | None:
    """Who is paid for a pair: its creator; when the creator is a fee-sharing config, its largest on-curve shareholder."""
    try:
        pk = Pubkey.from_string(creator)
    except Exception:  # noqa: BLE001
        return None
    if pk.is_on_curve():
        return creator
    if str(pumpkit.sharing_config_pda(Pubkey.from_string(pair))) == creator:
        sc = pumpkit.read_sharing_config(pair) or {}
        rows = sorted(sc.get("shareholders") or [], key=lambda s: -s["bps"])
        for s in rows:
            if Pubkey.from_string(s["address"]).is_on_curve():
                return s["address"]
    return None


def pool_quote_balance(pair: str, root: str) -> int:
    """Root tokens in a graduated pair's canonical PumpSwap pool."""
    m, r = Pubkey.from_string(pair), Pubkey.from_string(root)
    auth = eng.find_pda([b"pool-authority", bytes(m)], pumpkit.PUMP)
    pool = eng.find_pda([b"pool", struct.pack("<H", 0), bytes(auth), bytes(m), bytes(r)], pumpkit.PAMM)
    acc = (eng.rpc("getAccountInfo", [str(pool), {"encoding": "base64", "commitment": "confirmed"}]) or {}).get("value")
    if not acc:
        return 0
    raw = base64.b64decode(acc["data"][0])
    o = 8 + 1 + 2 + 32 * 4
    quote_ta = str(Pubkey.from_bytes(raw[o + 32:o + 64]))
    v = (eng.rpc("getAccountInfo", [quote_ta, {"encoding": "jsonParsed", "commitment": "confirmed"}]) or {}).get("value")
    try:
        return int(v["data"]["parsed"]["info"]["tokenAmount"]["amount"])
    except Exception:  # noqa: BLE001
        return 0


def scan_pairs(root: str, exclude: set[str]) -> list[dict]:
    """Every pump.fun coin paired against `root`, with the root it locks right now."""
    res = eng.http_json(desk.holder_rpc(), {"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": [
        str(eng.PUMP_PROGRAM), {"encoding": "base64", "filters": [{"memcmp": {"offset": QUOTE_OFFSET, "bytes": root}}]}]}, timeout=60)
    if res.get("error"):
        raise desk.DeskError(f"pair lookup failed: {str(res['error'])[:160]}")
    out = []
    for acc in res.get("result") or []:
        raw = base64.b64decode(acc["account"]["data"][0])
        if len(raw) < QUOTE_OFFSET + 32 + 8:
            continue
        vt, vq, rt, rq, supply = struct.unpack_from("<5Q", raw, 8)
        complete = raw[48] == 1
        creator = str(Pubkey.from_bytes(raw[49:81]))
        fee_bps = struct.unpack_from("<Q", raw, QUOTE_OFFSET + 32)[0]
        try:
            mint = mint_of_curve(acc["pubkey"], root)
        except Exception as exc:  # noqa: BLE001
            log(f"pair curve {acc['pubkey'][:6]} unreadable: {str(exc)[:80]}")
            continue
        if not mint:
            continue
        payee = payee_of(mint, creator)
        if not payee or payee in exclude:
            continue
        locked = rq
        if complete:
            try:
                locked = pool_quote_balance(mint, root)
            except Exception as exc:  # noqa: BLE001
                log(f"pair {mint[:6]} pool unreadable: {str(exc)[:80]}")
                locked = 0
        out.append({"mint": mint, "curve": acc["pubkey"], "creator": payee, "locked": int(locked), "complete": complete,
                    "fee_bps": int(fee_bps), "vt": vt, "vq": vq, "supply": supply})
    return out


# ----------------------------------------------------------------------------- sampling
def sample_root(w: desk.Wallet, root: str) -> list[dict]:
    """One look at every pair of a root: refreshes the books and adds locked x dt x multiplier to each counted pair."""
    rows = scan_pairs(root, {w.me})
    now = time.time()
    try:
        px = desk.price_lamports(root)                            # lamports per raw unit of the root
    except Exception as exc:  # noqa: BLE001
        log(f"{root[:6]} price not readable: {str(exc)[:100]}")
        px = float((books.coin(root) or {}).get("px_raw") or 0)
    floor_raw = int(int(CFG["min_lock_lamports"]) / px) if px else 0
    counted = {r["mint"]: r["locked"] for r in rows if px and r["locked"] >= max(1, floor_raw)}
    h = desk._held(root)
    dt = max(0.0, min(now - h["t"], 2 * float(CFG["sample_s"]))) if h["t"] else 0.0
    desk._amounts[root] = {r["mint"]: r["locked"] for r in rows if r["locked"] > 0}
    desk.age_step(h, desk._amounts[root], dt)                     # less root locked cuts the age, none resets it
    if dt:
        for p, amount in h["last"].items():
            h["w"][p] = h["w"].get(p, 0.0) + amount * dt * desk.multiplier(h["age"].get(p, 0.0))
    h["last"] = counted
    h["t"] = now
    supply = 0
    try:
        supply = int(eng.rpc("getTokenSupply", [root])["value"]["amount"])
    except Exception:  # noqa: BLE001
        supply = int((books.coin(root) or {}).get("supply") or 0)
    with books.LOCK:
        st = books.state()
        book = st["pairs"].setdefault(root, {})
        for r in rows:
            p = book.setdefault(r["mint"], {"mint": r["mint"], "first_seen": int(now)})
            pend = st["pending_pairs"].pop(r["mint"], None)
            if pend:
                p.update({"name": pend["name"], "symbol": pend["symbol"], "description": pend.get("description") or "",
                          "launched_here": True, "created_at": pend.get("t")})
            if not p.get("name") and not p.get("named_at"):
                nm, sym, dsc = desk.coin_names(r["mint"])
                p.update({"name": nm, "symbol": sym, "description": dsc, "named_at": int(now)})
            # the pair's market cap: its price in root, at the root's price
            if not r["complete"] and r["vt"]:
                p["mcap_lamports"] = int(r["vq"] / r["vt"] * r["supply"] * px) if px else 0
            p.update({"creator": r["creator"], "locked": r["locked"], "locked_lamports": int(r["locked"] * px),
                      "counted": r["mint"] in counted, "complete": r["complete"], "fee_bps": r["fee_bps"],
                      "age_s": int(h["age"].get(r["mint"], 0.0)), "mult": round(desk.multiplier(h["age"].get(r["mint"], 0.0)), 3),
                      "seen_at": int(now)})
        for m, p in book.items():                                 # a pair that left the scan locks nothing now
            if m not in {r["mint"] for r in rows}:
                p.update({"locked": 0, "locked_lamports": 0, "counted": False})
        c = books.coin(root)
        if c is not None:
            total = sum(r["locked"] for r in rows)
            c.update({"px_raw": px, "supply": supply, "mcap_lamports": int(px * supply), "mcap_at": int(now),
                      "pairs": len(rows), "pairs_counted": len(counted), "locked_total": total,
                      "locked_lamports": int(total * px), "locked_pct": round(total / supply * 100, 4) if supply else 0,
                      "floor_raw": floor_raw})
    desk._save_held(root, h)
    return rows


def sample_all(w: desk.Wallet) -> None:
    for r in root_mints():
        try:
            sample_root(w, r)
        except Exception as exc:  # noqa: BLE001
            log(f"{r[:6]} pair sample skipped: {str(exc)[:160]}")


# ----------------------------------------------------------------------------- split + pay
def assign(root: str, dry_extra: int = 0) -> dict[str, int]:
    """Splits the root's pot over its pairs by weight, then credits each pair's share to that pair's creator."""
    c = books.coin(root)
    avail = int(c["pot"]) - int(c["fee_debt"]) + dry_extra
    rows = desk.held_rows(root)                                   # [{"owner": pair mint, "amount": weight}]
    if avail <= 0 or not rows:
        return {}
    per_pair = desk.split(avail, rows)
    book = books.state()["pairs"].get(root) or {}
    per_creator: dict[str, int] = {}
    for p, a in per_pair.items():
        who = (book.get(p) or {}).get("creator")
        if who:
            per_creator[who] = per_creator.get(who, 0) + a
    if desk.DRY:
        return per_creator
    with books.LOCK:
        st = books.state()
        credit = st["credit"].setdefault(root, {})
        earned = st["pair_earned"].setdefault(root, {})
        for who, a in per_creator.items():
            credit[who] = int(credit.get(who) or 0) + a
        for p, a in per_pair.items():
            if (book.get(p) or {}).get("creator"):
                earned[p] = int(earned.get(p) or 0) + a
        c["pot"], c["fee_debt"] = 0, 0
        books.event("split", coin=root, lamports=avail, holders=len(per_creator), pairs=len(per_pair))
        books.save()
    return per_creator


def run_root(w: desk.Wallet, root: str) -> None:
    st = books.state()
    c = books.coin(root)
    if c is None:
        return
    curve = pumpkit.read_bonding_curve(root)
    if not curve:
        return
    dry_pot = 0
    try:
        got = desk.collect(w, root, curve)
        dry_pot = -got if got < 0 else 0
    except Exception as exc:  # noqa: BLE001
        log(f"{root[:6]} collect failed: {exc}")
    if st["owed_assets"].get(root) and not desk.DRY:
        desk.deliver_owed(w, root)
    sample_root(w, root)
    if int(c["pot"]) - int(c["fee_debt"]) + dry_pot > 0 or st["credit"].get(root):
        shares = assign(root, dry_pot)
        if shares:
            desk.reset_held(root)
        desk.pay(w, root, shares if desk.DRY else None)


def tick(w: desk.Wallet) -> None:
    t0 = time.time()
    for r in discover_roots(w):
        try:
            if books.coin(r) is None:
                continue
            run_root(w, r)
        except Exception:  # noqa: BLE001
            log(f"{r[:6]} round failed:\n" + traceback.format_exc())
    with books.LOCK:
        st = books.state()
        st["last_tick"] = int(time.time())
        st["last_tick_s"] = round(time.time() - t0, 1)
        st["dry"] = desk.DRY
        if not desk.DRY:
            books.save()


def loop() -> None:
    w = desk.Wallet()
    with books.LOCK:
        for rows in books.state()["owed_assets"].values():
            for r in rows:
                r["tries"] = 0
    log(f"{'DRY' if desk.DRY else 'LIVE'} | payout wallet {w.me} | every {CFG['interval_s']} s | "
        f"{'root ' + (root_mints() or ['(not launched)'])[0] if CFG.get('single_root') else 'every root launched here'}")
    last_round = 0.0
    while True:
        t0 = time.time()
        if desk.STOP_FILE.exists():
            log(f"paused ({desk.STOP_FILE} exists)")
        elif t0 - last_round >= float(CFG["interval_s"]) - 1:
            last_round = t0
            try:
                tick(w)
            except Exception:  # noqa: BLE001
                log("round failed:\n" + traceback.format_exc())
        else:
            try:
                sample_all(w)
            except Exception:  # noqa: BLE001
                log("sample failed:\n" + traceback.format_exc())
        time.sleep(max(2.0, float(CFG["sample_s"]) - (time.time() - t0)))


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2 and sys.argv[1] == "scan":                # py engine/pairs.py scan <root>
        for r in scan_pairs(sys.argv[2], set()):
            print(r["mint"], r["creator"][:6], "locked", r["locked"], "graduated" if r["complete"] else "curve", r["fee_bps"], "bps")
    elif len(sys.argv) > 1 and sys.argv[1] == "once":
        tick(desk.Wallet())
    else:
        loop()
