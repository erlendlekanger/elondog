"""The payout desk of Hold. Every interval_s (6 minutes) it runs one round over every coin launched here:

  1. Collect   distribute_creator_fees_v2 (permissionless) pushes the coin's creator fees out of its pump.fun fee vaults
               to its only shareholder, the payout wallet. The lamports that arrived are read from the transaction.
  2. Split     what arrived, minus the Solana fees the coin's own transactions cost, is credited to every wallet holding
               at least min_hold_bps of the coin's supply (10 bps = 0.1 %), by

                 coins held  x  seconds held  x  hold multiplier

               hold multiplier  1x the moment a wallet buys, climbing with every hour it keeps the coins:
                                1 + (hold_max - 1) x (1 - e^(-days held / hold_tau_days))
                                with hold_max 10 and tau 7 days: 2.2x after a day, 6.7x after a week, 8.8x after two
                                weeks, 9.9x after a month. Buying more mixes new coins into the bag (the hold time is
                                averaged over the coins), selling part cuts the hold time by the part sold, selling
                                everything starts it again at zero.
               Programs (the bonding curve, the PumpSwap pool) and the payout wallet itself are not holders.
  3. Send      SOL to every holder whose credit is due, many per transaction (one Solana packet).

Nothing is kept. The only cost is the Solana network fee of each transaction, charged to the coin it was for.
Run it through server.py (USEHOLD_DESK=1) or alone: py engine/desk.py [once|loop|plan <mint>|holders <mint>|costs].
DRY by default (USEHOLD_DRY=1): every transaction is built and simulated, nothing is sent, the books are not touched.
"""
from __future__ import annotations

import base64
import json
import math
import os
import struct
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price  # noqa: E402
from solders.hash import Hash  # noqa: E402
from solders.instruction import Instruction  # noqa: E402
from solders.message import MessageV0  # noqa: E402
from solders.pubkey import Pubkey  # noqa: E402

import books  # noqa: E402
from op import chain as eng  # noqa: E402
from op import pumpkit  # noqa: E402

CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
DRY = eng.DRY
SOL = str(eng.WSOL_MINT)
LEGACY = str(eng.TOKEN_LEGACY)
INCINERATOR = "1nc1nerator11111111111111111111111111111111"
HOLDER_RPC = os.environ.get("USEHOLD_HOLDER_RPC", "").strip() or "https://api.mainnet-beta.solana.com"   # publicnode refuses getProgramAccounts


def holder_rpc() -> str:
    """getProgramAccounts goes to the paid RPC when there is one (chain.paid_rpc), else to mainnet-beta."""
    return eng.paid_rpc() or HOLDER_RPC
STOP_FILE = Path(os.path.expanduser("~/usehold.stop"))
MAX_TX = 1232
SYSTEM_RENT = 890_880                                            # a wallet with no data must hold at least this
# measured on mainnet 2026-11-07 with tools/measure.py (TSLAx, Token-2022): compute units per instruction
CU_TRANSFER = 5_500
CU_OPEN = 26_000
CU_SOL = 450
CU_MEMO = 15_000                                                 # the memo program logs its signer; 7,700 was not enough (2026-11-07)


def cfg(k: str):
    return CFG[k]


class DeskError(RuntimeError):
    pass


def log(*a):
    print(time.strftime("%H:%M:%S"), "[desk]", *a, flush=True)


# ----------------------------------------------------------------------------- wallet
class Wallet:
    def __init__(self):
        self.kp = eng.load_keypair()
        if self.kp:
            self.pk = self.kp.pubkey()
        elif CFG.get("treasury"):
            self.pk = Pubkey.from_string(CFG["treasury"])
        else:
            raise DeskError("no payout wallet: run py usehold/tools/wallet.py")
        if not DRY and not self.kp:
            raise DeskError("live mode needs the payout wallet's key (~/usehold_key.txt)")
        self.me = str(self.pk)

    def sign(self, msg):
        return eng.partial_sign(msg, [self.kp] if self.kp else [])


def treasury_address() -> str:
    kp = eng.load_keypair()
    return str(kp.pubkey()) if kp else (CFG.get("treasury") or "")


def compile_msg(w: Wallet, ixs: list[Instruction], units: int, bh: str, alt: bool = False) -> MessageV0:
    pre = [set_compute_unit_limit(int(units)), set_compute_unit_price(int(cfg("priority_micro_lamports")))]
    return MessageV0.try_compile(w.pk, pre + ixs, [pumpkit.load_alt()] if alt else [], Hash.from_string(bh))


def send(w: Wallet, ixs: list[Instruction], units: int, alt: bool = True) -> dict | None:
    """Simulate, send, wait. Returns the confirmed transaction (json) or None in DRY."""
    bh, _ = eng.blockhash()
    tx = w.sign(compile_msg(w, ixs, units, bh, alt))
    sim = eng.simulate(tx)
    if not sim["ok"]:
        raise DeskError(f"simulation failed: {sim['err']} | {' / '.join((sim.get('logs') or [])[-3:])}")
    if DRY:
        return None
    sig = eng.send_tx(tx)
    if not eng.wait_confirmed(sig, 75):
        raise DeskError(f"not confirmed: {sig}")
    t = eng.get_tx(sig)
    if not t:
        raise DeskError(f"confirmed but not readable yet: {sig}")
    t["_sig"] = sig
    return t


# ----------------------------------------------------------------------------- chain reads
def coins_on_chain(me: str) -> list[dict]:
    """Every coin whose pump.fun fee sharing sends 100 percent to the payout wallet (Pump Fees sharing configs whose
    first shareholder is us; the shareholder list starts at byte 80 of the account)."""
    res = eng.http_json(holder_rpc(), {"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": [
        str(eng.PFEE_PROGRAM), {"encoding": "base64", "filters": [{"memcmp": {"offset": 80, "bytes": me}}]}]}, timeout=40)
    if res.get("error"):
        raise DeskError(f"coin lookup failed: {str(res['error'])[:160]}")
    out = []
    for acc in res.get("result") or []:
        raw = base64.b64decode(acc["account"]["data"][0])
        if len(raw) < 80 + 34:
            continue
        n = struct.unpack_from("<I", raw, 76)[0]
        bps = struct.unpack_from("<H", raw, 80 + 32)[0]
        if n == 1 and bps == 10_000:
            out.append({"mint": str(Pubkey.from_bytes(raw[11:43])), "locked": raw[75] == 1})
    return out


def quote_of(curve: dict) -> tuple[str, Pubkey]:
    """The coin's pair (quote) mint and its token program."""
    q = curve.get("quote_mint") or SOL
    if q == SOL:
        return SOL, eng.TOKEN_LEGACY
    info = eng.mint_info(q)
    if not info:
        raise DeskError(f"pair {q[:6]} not readable")
    return q, Pubkey.from_string(info["program"])


_qpx: dict[str, tuple[float, float]] = {}


def lamports_per_quote_raw(q: str) -> float:
    """What one raw unit of the pair is worth in lamports (Jupiter prices, cached a minute). 1 for SOL."""
    if q == SOL:
        return 1.0
    hit = _qpx.get(q)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    px = eng.prices_usd([q, SOL])
    if not px.get(q) or not px.get(SOL):
        raise DeskError(f"no price for the pair {q[:6]}")
    v = px[q] / px[SOL] * 1e9 / 10 ** int(eng.mint_info(q)["decimals"])
    _qpx[q] = (time.time(), v)
    return v


def fees_waiting(mint: str, curve: dict) -> dict:
    """Fees in the coin's fee vaults right now, in the pair's raw units and in lamports: the pump vault of its sharing
    config (for SOL: minus that account's rent), the PumpSwap creator vault once graduated, and fees v3 trades left on
    the curve itself."""
    q, qp = quote_of(curve)
    v = pumpkit.fee_vaults(mint, q, str(qp))
    res = eng.rpc("getMultipleAccounts", [[v["curve"], v["amm"]], {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]

    def tok(acc):
        try:
            return int(acc["data"]["parsed"]["info"]["tokenAmount"]["amount"]) if acc else 0
        except Exception:  # noqa: BLE001
            return 0
    if q == SOL:
        pump = max(0, int(res[0]["lamports"]) - eng.VAULT_RENT_LAMPORTS) if res[0] else 0
    else:
        pump = tok(res[0])
    amm = tok(res[1])
    curve_left = int(curve.get("creator_fee_pending") or 0)
    raw = pump + amm + curve_left
    try:
        lam = int(raw * lamports_per_quote_raw(q))
    except DeskError:
        lam = 0
    return {"pump": pump, "amm": amm, "curve": curve_left, "raw": raw, "total": lam, "quote": q}


def price_lamports(mint: str, curve: dict | None = None) -> float:
    """What one raw unit of the coin is worth in lamports right now, read from the chain: the bonding curve's virtual
    reserves while it is on the curve, the PumpSwap pool's reserves (plus its virtual quote reserve) once graduated.
    For a token pair the price in the pair is converted to lamports at the pair's price."""
    curve = curve if curve and "virtual_token_reserves" in curve else pumpkit.read_bonding_curve(mint)
    if not curve:
        raise DeskError("no bonding curve, so no price")
    q, _ = quote_of(curve)
    k = lamports_per_quote_raw(q)
    if not curve.get("complete"):
        return curve["virtual_quote_reserves"] / max(1, curve["virtual_token_reserves"]) * k
    m = Pubkey.from_string(mint)
    auth = eng.find_pda([b"pool-authority", bytes(m)], pumpkit.PUMP)
    pool = eng.find_pda([b"pool", struct.pack("<H", 0), bytes(auth), bytes(m), bytes(Pubkey.from_string(q))], pumpkit.PAMM)
    acc = (eng.rpc("getAccountInfo", [str(pool), {"encoding": "base64", "commitment": "confirmed"}]) or {}).get("value")
    if not acc:
        raise DeskError("graduated, but the PumpSwap pool is not readable")
    raw = base64.b64decode(acc["data"][0])
    o = 8 + 1 + 2 + 32 * 4                                        # bump, index, creator, base, quote, lp mints
    base_ta, quote_ta = str(Pubkey.from_bytes(raw[o:o + 32])), str(Pubkey.from_bytes(raw[o + 32:o + 64]))
    vqr = int.from_bytes(raw[245:261], "little", signed=True) if len(raw) >= 261 else 0
    bal = eng.rpc("getMultipleAccounts", [[base_ta, quote_ta], {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]
    base = int(bal[0]["data"]["parsed"]["info"]["tokenAmount"]["amount"])
    quote = int(bal[1]["data"]["parsed"]["info"]["tokenAmount"]["amount"])
    return (quote + max(0, vqr)) / max(1, base) * k


_supply: dict[str, tuple[float, int]] = {}
_amounts: dict[str, dict[str, int]] = {}                         # every holder's amount at the last look, above the line or not
_price: dict[str, float] = {}


def holders(mint: str, exclude: set[str], curve: dict | None = None) -> tuple[list[dict], int, int]:
    """Wallets holding at least min_hold_bps of the supply (10 bps = 0.1 %) when the look runs, largest first. Returns (rows, floor in raw tokens, supply).
    Only owner and amount are fetched (dataSlice 32..72), so a coin with many thousand accounts stays small."""
    info = eng.mint_info(mint)
    if not info:
        raise DeskError("mint not readable")
    hit = _supply.get(mint)
    if hit and time.time() - hit[0] < 300:
        supply = hit[1]
    else:
        supply = int(eng.rpc("getTokenSupply", [mint])["value"]["amount"])   # burns lower it, so re-read every 5 min
        _supply[mint] = (time.time(), supply)
    try:                                                          # the price only feeds the market cap shown on the site
        _price[mint] = price_lamports(mint, curve)
    except Exception as exc:  # noqa: BLE001
        log(f"{mint[:6]} price not readable, market cap kept: {str(exc)[:100]}")
    floor = max(1, -(-supply * int(cfg("min_hold_bps")) // 10_000))     # 0.1 % of the supply, rounded up
    filters = [{"memcmp": {"offset": 0, "bytes": mint}}]
    if info["program"] == LEGACY:
        filters.append({"dataSize": 165})
    res = eng.http_json(holder_rpc(), {"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": [
        info["program"], {"encoding": "base64", "dataSlice": {"offset": 32, "length": 40}, "filters": filters}]}, timeout=60)
    if res.get("error"):
        raise DeskError(f"holder lookup failed: {str(res['error'])[:160]}")
    rows: dict[str, int] = {}
    for acc in res.get("result") or []:
        raw = base64.b64decode(acc["account"]["data"][0])
        if len(raw) < 40:
            continue
        owner = Pubkey.from_bytes(raw[:32])
        amount = struct.unpack_from("<Q", raw, 32)[0]
        o = str(owner)
        if amount <= 0 or o in exclude or o == INCINERATOR or not owner.is_on_curve():   # PDAs: curve, pool, vaults
            continue
        rows[o] = rows.get(o, 0) + amount
    _amounts[mint] = rows
    out = sorted(({"owner": o, "amount": a} for o, a in rows.items() if a >= floor), key=lambda r: -r["amount"])
    return out, floor, supply


def split(total: int, rows: list[dict]) -> dict[str, int]:
    """Pro rata by holding in whole lamports; the rounding remainder goes one lamport each to the largest holders."""
    weight = sum(r["amount"] for r in rows)
    if total <= 0 or weight <= 0:
        return {}
    out = {r["owner"]: total * r["amount"] // weight for r in rows}
    left = total - sum(out.values())
    for r in rows[:left]:
        out[r["owner"]] += 1
    return out


def missing_accounts(addrs: list[str]) -> set[str]:
    gone = set()
    for i in range(0, len(addrs), 100):
        res = eng.rpc("getMultipleAccounts", [addrs[i:i + 100], {"encoding": "base64", "dataSlice": {"offset": 0, "length": 0}}])
        for a, v in zip(addrs[i:i + 100], (res or {}).get("value") or []):
            if not v:
                gone.add(a)
    return gone


_rent: dict[int, int] = {}


def rent_for(size: int) -> int:
    if size not in _rent:
        _rent[size] = int(eng.rpc("getMinimumBalanceForRentExemption", [size]))
    return _rent[size]


def asset_info(mint: str) -> dict:
    if mint == SOL:
        return {"mint": SOL, "native": True, "decimals": 9, "program": None}
    info = eng.mint_info(mint)
    if not info:
        raise DeskError(f"asset {mint[:6]} not readable")
    return {"mint": mint, "native": False, "decimals": int(info["decimals"]), "program": Pubkey.from_string(info["program"])}


def ensure_own_account(w: Wallet, a: dict) -> int:
    """The payout wallet's own account for the asset (Jupiter delivers the swap there). Opened once, paid by the
    operator's float (booked as setup, never charged to a coin). Returns the account's size in bytes."""
    mint = Pubkey.from_string(a["mint"])
    own = eng.ata(w.pk, mint, a["program"])
    v = eng.rpc("getAccountInfo", [str(own), {"encoding": "base64", "commitment": "confirmed"}])["value"]
    if v:
        return len(base64.b64decode(v["data"][0]))
    t = send(w, [eng.ata_create_idempotent_ix(w.pk, w.pk, mint, a["program"])], 40_000, alt=False)
    if t is None:                                                 # DRY: what the account would weigh
        return 179 if a["program"] == eng.TOKEN_2022 else 165
    cost = -(eng.tx_sol_delta(t, w.me) or 0) + t["meta"]["fee"]
    with books.LOCK:
        books.state()["totals"]["setup"] += cost
        books.event("setup", asset=a["mint"], lamports=cost, sig=t["_sig"])
        books.save()
    v = eng.rpc("getAccountInfo", [str(own), {"encoding": "base64", "commitment": "confirmed"}])["value"]
    return len(base64.b64decode(v["data"][0])) if v else 179


# ----------------------------------------------------------------------------- 1. collect
def collect(w: Wallet, mint: str, curve: dict) -> int:
    """SOL pair: the fees arrive as lamports. Token pair: they arrive as the pair token in the payout wallet's own
    account for it and are swapped to SOL (convert_pair), so the books stay in lamports."""
    c = books.coin(mint)
    f = fees_waiting(mint, curve)
    c["vault"] = {"lamports": f["total"], "raw": f["raw"], "t": int(time.time())}
    if f["total"] < int(cfg("min_collect_lamports")):
        return 0
    q, qp = quote_of(curve)
    qm = Pubkey.from_string(q)
    graduated = bool(curve.get("complete")) and f["amm"] > 0
    m = Pubkey.from_string(mint)
    pre = [] if q == SOL else [eng.ata_create_idempotent_ix(w.pk, w.pk, qm, qp)]
    ixs = pre + pumpkit.distribute_ixs(w.pk, m, [w.pk], qm, qp, graduated_side=graduated)
    t = send(w, ixs, 300_000 if graduated else 200_000)
    if t is None:
        log(f"dry: {mint[:6]} would collect {f['total'] / 1e9:.6f} SOL worth (pump {f['pump']}, pumpswap {f['amm']}, curve {f['curve']})")
        return -f["total"]                                        # negative = what a live round would have collected
    fee = int(t["meta"]["fee"])
    if q == SOL:
        got = max(0, int(eng.tx_sol_delta(t, w.me) or 0))
        with books.LOCK:
            c["collected"] += got
            c["pot"] += got
            c["fees"] += fee
            c["fee_debt"] += fee
            c["last_collect_at"] = int(time.time())
            tot = books.state()["totals"]
            tot["collected"] += got
            tot["fees"] += fee
            books.event("collect", coin=mint, lamports=got, fee=fee, sig=t["_sig"])
            books.save()
        log(f"{mint[:6]} collected {got / 1e9:.6f} SOL (fee {fee}): {t['_sig']}")
        return got
    got_raw = max(0, eng.tx_token_delta(t, w.me, q))
    setup = max(0, -int(eng.tx_sol_delta(t, w.me) or 0))       # the payout wallet's own account for the pair, first time only
    with books.LOCK:
        c["quote_held"] = int(c.get("quote_held") or 0) + got_raw
        c["fees"] += fee
        c["fee_debt"] += fee
        c["last_collect_at"] = int(time.time())
        tot = books.state()["totals"]
        tot["fees"] += fee
        tot["setup"] += setup
        books.event("claim", coin=mint, asset=q, raw=got_raw, fee=fee, sig=t["_sig"])
        books.save()
    log(f"{mint[:6]} collected {got_raw} raw of {q[:6]} (fee {fee}): {t['_sig']}")
    return convert_pair(w, mint, q)


def convert_pair(w: Wallet, mint: str, q: str) -> int:
    """Swaps the pair tokens collected for this coin into SOL. What the swap delivers is what the coin collected.
    A failed swap leaves them for the next round."""
    c = books.coin(mint)
    held = int(c.get("quote_held") or 0)
    if held <= 0 or q == SOL:
        return 0
    try:
        qd = eng.jup_quote(q, SOL, held, 300)
        signed = w.sign(eng.jup_swap_tx(qd, w.me, int(cfg("swap_priority_max_lamports"))).message)
        sim = eng.simulate(signed)
        if not sim["ok"]:
            raise DeskError(f"simulation failed: {sim['err']}")
        if DRY:
            return 0
        sig = eng.send_tx(signed)
        if not eng.wait_confirmed(sig, 75):
            raise DeskError(f"not confirmed: {sig}")
        t = eng.get_tx(sig)
        if not t:
            raise DeskError(f"confirmed but not readable: {sig}")
    except Exception as exc:  # noqa: BLE001
        log(f"{mint[:6]} swapping {held} raw of {q[:6]} to SOL failed, kept for the next round: {str(exc)[:160]}")
        return 0
    got = max(0, int(eng.tx_sol_delta(t, w.me) or 0))
    fee = int(t["meta"]["fee"])
    spent = -eng.tx_token_delta(t, w.me, q)
    with books.LOCK:
        c["quote_held"] = max(0, held - max(spent, 0))
        c["collected"] += got
        c["pot"] += got
        c["fees"] += fee
        c["fee_debt"] += fee
        tot = books.state()["totals"]
        tot["collected"] += got
        tot["fees"] += fee
        books.event("collect", coin=mint, lamports=got, fee=fee, sig=sig, asset=q, raw=spent)
        books.save()
    log(f"{mint[:6]} swapped {spent} raw of {q[:6]} into {got / 1e9:.6f} SOL: {sig}")
    return got


# ----------------------------------------------------------------------------- 2. split
def assign(mint: str, rows: list[dict], floor: int, dry_extra: int = 0) -> dict[str, int]:
    """Splits the coin's pot (minus the fees its transactions cost) over the holders as credit. Returns the shares."""
    c = books.coin(mint)
    avail = int(c["pot"]) - int(c["fee_debt"]) + dry_extra
    if avail <= 0 or not rows:
        return {}
    shares = split(avail, rows)
    if DRY:
        return shares
    with books.LOCK:
        credit = books.state()["credit"].setdefault(mint, {})
        for o, a in shares.items():
            credit[o] = int(credit.get(o) or 0) + a
        c["pot"], c["fee_debt"] = 0, 0
        books.event("split", coin=mint, lamports=avail, holders=len(rows), floor=floor)
        books.save()
    return shares


# ----------------------------------------------------------------------------- 3 + 4. swap and send
def _batches(w: Wallet, items: list[dict], a: dict, bh: str) -> list[dict]:
    """Packs payments into as few transactions as fit one Solana packet (1232 bytes)."""
    mint = Pubkey.from_string(a["mint"])
    src = None if a["native"] else eng.ata(w.pk, mint, a["program"])
    memo = Instruction(eng.MEMO_PROGRAM, f"{CFG['brand']}: fees to holders".encode(), [])
    out, cur, ixs, units = [], [], [], 3_000

    def ix_for(it):
        o = Pubkey.from_string(it["owner"])
        if a["native"]:
            return [eng.system_transfer_ix(w.pk, o, it["amount"])], CU_SOL
        dst = eng.ata(o, mint, a["program"])
        tx = [eng.transfer_checked_ix(src, mint, dst, w.pk, it["amount"], a["decimals"], a["program"])]
        if it["open"]:
            return [eng.ata_create_idempotent_ix(w.pk, o, mint, a["program"])] + tx, CU_OPEN + CU_TRANSFER
        return tx, CU_TRANSFER

    def flush():
        nonlocal cur, ixs, units
        if cur:
            out.append({"items": cur, "ixs": ixs + [memo], "units": units + CU_MEMO})
        cur, ixs, units = [], [], 3_000

    for it in items:
        add, cu = ix_for(it)
        trial = ixs + add + [memo]
        if cur and len(bytes(w.sign(compile_msg(w, trial, units + cu + CU_MEMO, bh, alt=False)))) > MAX_TX:
            flush()
        cur.append(it)
        ixs += add
        units += cu
    flush()
    return out


def _statuses(sigs: list[str], history: bool = False) -> list:
    out = []
    for i in range(0, len(sigs), 200):
        try:
            out += eng.rpc("getSignatureStatuses", [sigs[i:i + 200], {"searchTransactionHistory": history}])["value"]
        except Exception:  # noqa: BLE001
            out += [None] * len(sigs[i:i + 200])
    return out


def _landed(s) -> bool:
    return bool(s) and not s.get("err") and s.get("confirmationStatus") in ("confirmed", "finalized")


def _deliver(w: Wallet, batches: list[dict]) -> list[dict]:
    """Sends every batch and follows each one. A batch that has not landed is broadcast again with the SAME bytes
    (same signature) until its blockhash has expired; only then is it rebuilt with a new blockhash, after one more
    look in the history. So a payment can never land twice. Never raises: what did not land is marked."""
    for attempt in range(3):
        todo = [b for b in batches if b.get("state") in (None, "rebuild")]
        if not todo:
            break
        if attempt:
            for b, s in zip(todo, _statuses([b["sig"] for b in todo], history=True)):
                if _landed(s):
                    b["state"] = "landed"
            todo = [b for b in todo if b["state"] == "rebuild"]
            if not todo:
                break
        bh, lvbh = eng.blockhash()
        for b in todo:
            b["tx"] = w.sign(compile_msg(w, b["ixs"], b["units"], bh))
            b["sig"], b["lvbh"], b["state"] = str(b["tx"].signatures[0]), int(lvbh or 0), "sent"
        sim = eng.simulate(todo[0]["tx"])
        if not sim["ok"]:
            err = f"simulation failed: {sim['err']} | {' / '.join((sim.get('logs') or [])[-3:])}"
            for b in todo:
                b["state"], b["err"] = "failed", err
            log(f"payout batch {err}")
            break
        for b in todo:
            try:
                eng.send_tx(b["tx"])
            except Exception as exc:  # noqa: BLE001
                log(f"send error (rebroadcast follows): {str(exc)[:120]}")
            time.sleep(0.25)                                      # public RPC: about 40 sends per 10 s
        while True:
            live = [b for b in todo if b["state"] == "sent"]
            if not live:
                break
            for b, s in zip(live, _statuses([b["sig"] for b in live])):
                if s and s.get("err"):
                    b["state"], b["err"] = "failed", json.dumps(s["err"])
                elif _landed(s):
                    b["state"] = "landed"
            live = [b for b in todo if b["state"] == "sent"]
            if not live:
                break
            height = eng.block_height() or 0
            for b in live:
                if height and b["lvbh"] and height > b["lvbh"] + 30:
                    b["state"] = "rebuild"                        # expired: the old signature can never land now
                else:
                    try:
                        eng.send_tx(b["tx"])                      # same bytes, same signature
                    except Exception:  # noqa: BLE001
                        pass
                    time.sleep(0.1)
            time.sleep(3)
    for b in batches:
        if b.get("state") != "landed":
            b["state"] = "failed" if b.get("state") == "failed" else "unlanded"
    return batches


def pay(w: Wallet, mint: str, extra: dict | None = None) -> dict:
    """Pays this round's asset to every holder whose credit is due. `extra` (DRY only) is credit a live round would
    have assigned. Returns a summary."""
    st = books.state()
    c = books.coin(mint)
    assets = c.get("assets") or [SOL]
    credit = {o: int(v) for o, v in (st["credit"].get(mint) or {}).items() if int(v) > 0}
    for o, v in (extra or {}).items():
        credit[o] = credit.get(o, 0) + int(v)
    if not credit:
        return {"paid": 0}
    if sum(credit.values()) < int(cfg("min_round_lamports")):
        return {"paid": 0, "why": "below the round minimum"}
    owners = sorted(credit, key=lambda o: -credit[o])
    tried = 0
    while tried < len(assets):
        asset = assets[(int(c.get("next") or 0) + tried) % len(assets)]
        tried += 1
        try:
            res = _pay_asset(w, mint, asset, credit, owners)
        except DeskError as exc:
            log(f"{mint[:6]} paying in {asset[:6]} failed, trying the next asset: {exc}")
            books.event("skip", coin=mint, asset=asset, why=str(exc)[:200]) if not DRY else None
            continue
        if not DRY:
            with books.LOCK:
                c["next"] = (int(c.get("next") or 0) + tried) % len(assets)
                books.save()
        return res
    return {"paid": 0, "why": "no asset could be paid this round"}


def _pay_asset(w: Wallet, mint: str, asset: str, credit: dict[str, int], owners: list[str]) -> dict:
    a = asset_info(asset)
    min_send = int(cfg("min_send_lamports"))
    if a["native"]:
        gone = missing_accounts(owners)
        due = [{"owner": o, "credit": credit[o], "open": False, "rent": 0} for o in owners
               if credit[o] >= max(min_send, SYSTEM_RENT if o in gone else 0)]
        rent = 0
    else:
        size = ensure_own_account(w, a)
        rent = rent_for(size)
        m = Pubkey.from_string(asset)
        atas = {o: str(eng.ata(Pubkey.from_string(o), m, a["program"])) for o in owners}
        gone_atas = missing_accounts(list(atas.values()))
        due = []
        for o in owners:
            new = atas[o] in gone_atas
            need = int(rent * float(cfg("open_account_multiple"))) if new else min_send
            if credit[o] >= max(need, min_send):
                due.append({"owner": o, "credit": credit[o], "open": new, "rent": rent if new else 0})
    if not due:
        return {"paid": 0, "why": "no holder's credit is due yet"}
    spend = sum(d["credit"] for d in due)
    bal = int(round((eng.sol_balance(w.me) or 0) * 1e9))
    if bal - int(cfg("reserve_lamports")) < spend:
        raise DeskError(f"payout wallet holds {bal} lamports, round needs {spend} plus the reserve")

    swap_in = sum(d["credit"] - d["rent"] for d in due)
    swap_sig, swap_fee, got = None, 0, swap_in
    if not a["native"]:
        q = eng.jup_quote(SOL, asset, swap_in, 300)
        impact = float(q.get("priceImpactPct") or 0) * 100
        if impact > float(cfg("max_price_impact_pct")):
            raise DeskError(f"price impact {impact:.2f}% is above {cfg('max_price_impact_pct')}%")
        signed = w.sign(eng.jup_swap_tx(q, w.me, int(cfg("swap_priority_max_lamports"))).message)
        sim = eng.simulate(signed)
        if not sim["ok"]:
            raise DeskError(f"swap simulation failed: {sim['err']}")
        if DRY:
            got = int(q["outAmount"])
        else:
            swap_sig = eng.send_tx(signed)
            if not eng.wait_confirmed(swap_sig, 75):
                raise DeskError(f"swap not confirmed: {swap_sig}")
            t = eng.get_tx(swap_sig)
            if not t:
                raise DeskError(f"swap confirmed but not readable: {swap_sig}")
            got = max(0, eng.tx_token_delta(t, w.me, asset))
            spent = -(eng.tx_sol_delta(t, w.me) or 0) + int(t["meta"]["fee"])
            swap_fee = max(0, spent - swap_in)
            if got <= 0:
                raise DeskError(f"swap landed but delivered nothing: {swap_sig}")
    # each holder's part of what the swap delivered, pro rata to the lamports they put in
    for d in due:
        d["amount"] = got * (d["credit"] - d["rent"]) // swap_in if swap_in else 0
    left = got - sum(d["amount"] for d in due)
    for d in due[:max(0, left)]:
        d["amount"] += 1
    items = [d for d in due if d["amount"] > 0]
    bh, _ = eng.blockhash()
    batches = _batches(w, items, a, bh)
    if DRY:
        sim = eng.simulate(w.sign(compile_msg(w, batches[0]["ixs"], batches[0]["units"], bh))) if a["native"] else {"ok": None}
        log(f"dry: {mint[:6]} would pay {len(items)} holders in {asset[:6]} ({sum(d['open'] for d in items)} new accounts) "
            f"with {swap_in / 1e9:.6f} SOL -> {got} raw, in {len(batches)} transactions"
            + (f"; first batch sim ok={sim['ok']}" if sim["ok"] is not None else ""))
        return {"paid": 0, "dry": True, "holders": len(items), "transactions": len(batches), "asset": asset, "swap_in": swap_in, "got": got}

    with books.LOCK:                                              # the credit is spent the moment the swap landed
        st = books.state()
        cr = st["credit"].setdefault(mint, {})
        for d in due:
            cr[d["owner"]] = int(cr.get(d["owner"]) or 0) - d["credit"]
            if cr[d["owner"]] <= 0:
                cr.pop(d["owner"], None)
        owed = st["owed_assets"].setdefault(mint, [])
        for d in items:
            owed.append({"owner": d["owner"], "asset": asset, "raw": d["amount"], "sol": d["credit"], "open": d["open"]})
        c = books.coin(mint)
        c["fees"] += swap_fee
        c["fee_debt"] += swap_fee
        st["totals"]["fees"] += swap_fee
        if swap_sig:
            books.event("swap", coin=mint, asset=asset, lamports=swap_in, raw=got, fee=swap_fee, sig=swap_sig)
        books.save()
    return deliver_owed(w, mint, batches_hint=None)


def deliver_owed(w: Wallet, mint: str, batches_hint=None) -> dict:
    """Sends everything in owed_assets for this coin: assets already bought for holders and not yet in their wallets."""
    st = books.state()
    owed = list(st["owed_assets"].get(mint) or [])
    if not owed:
        return {"paid": 0}
    summary = {"paid": 0, "holders": 0, "transactions": 0, "failed": 0}
    by_asset: dict[str, list[dict]] = {}
    for o in owed:
        if int(o.get("tries") or 0) < 5:                           # 5 failed rounds: left for a manual look, shown as stuck
            by_asset.setdefault(o["asset"], []).append(o)
    for asset, rows in by_asset.items():
        a = asset_info(asset)
        if not a["native"]:
            atas = {r["owner"]: str(eng.ata(Pubkey.from_string(r["owner"]), Pubkey.from_string(asset), a["program"])) for r in rows}
            gone = missing_accounts(list(atas.values()))
            for r in rows:
                r["open"] = atas[r["owner"]] in gone
        bh, _ = eng.blockhash()
        batches = _batches(w, [{"owner": r["owner"], "amount": r["raw"], "open": r.get("open", False), "row": r} for r in rows], a, bh)
        _deliver(w, batches)
        with books.LOCK:
            c = books.coin(mint)
            tot = st["totals"]
            keep = []
            for b in batches:
                ok = b["state"] == "landed"
                fee = 0
                if ok:
                    t = eng.get_tx(b["sig"], tries=4)
                    fee = int(t["meta"]["fee"]) if t else 5_000 + b["units"] * int(cfg("priority_micro_lamports")) // 1_000_000
                    c["fees"] += fee
                    c["fee_debt"] += fee
                    tot["fees"] += fee
                    for it in b["items"]:
                        r = it["row"]
                        c["sent"] += r["sol"]
                        tot["sent"] += r["sol"]
                        per = st["paid"].setdefault(mint, {}).setdefault(r["owner"], {"sol": 0, "n": 0, "assets": {}})
                        per["sol"] += r["sol"]
                        per["n"] += 1
                        per["assets"][asset] = int(per["assets"].get(asset) or 0) + r["raw"]
                        per["last"] = int(time.time())
                    c["transfers"] += len(b["items"])
                    tot["transfers"] += len(b["items"])
                    summary["holders"] += len(b["items"])
                    summary["paid"] += sum(it["row"]["sol"] for it in b["items"])
                else:
                    for it in b["items"]:
                        it["row"]["tries"] = int(it["row"].get("tries") or 0) + 1
                    keep += [it["row"] for it in b["items"]]
                    summary["failed"] += 1
                books.event("pay" if ok else "pay_failed", coin=mint, asset=asset, holders=len(b["items"]),
                            lamports=sum(it["row"]["sol"] for it in b["items"]), raw=sum(it["row"]["raw"] for it in b["items"]),
                            opened=sum(1 for it in b["items"] if it["open"]), fee=fee, sig=b["sig"],
                            err=b.get("err") or (None if ok else "did not land, retried next round"),
                            to=[[it["row"]["owner"], it["row"]["raw"]] for it in b["items"]])
            summary["transactions"] += len(batches)
            sent_ids = {id(r) for r in rows}
            others = [o for o in st["owed_assets"].get(mint) or [] if id(o) not in sent_ids]
            st["owed_assets"][mint] = others + keep
            if not st["owed_assets"][mint]:
                st["owed_assets"].pop(mint, None)
            books.save()
    with books.LOCK:
        c = books.coin(mint)
        if summary["holders"]:
            c["rounds"] += 1
            c["last_payout_at"] = int(time.time())
            st["totals"]["payouts"] += 1
            st["rounds"].append({"t": int(time.time()), "coin": mint, "holders": summary["holders"], "lamports": summary["paid"],
                                 "transactions": summary["transactions"], "asset": list(by_asset)[0]})
            st["rounds"] = st["rounds"][-books.ROUNDS_KEPT:]
        books.save()
    log(f"{mint[:6]} paid {summary['holders']} holders ({summary['paid'] / 1e9:.6f} SOL worth) in {summary['transactions']} "
        f"transactions, {summary['failed']} failed")
    return summary


# ----------------------------------------------------------------------------- the round
METAPLEX = Pubkey.from_string("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")


def coin_names(mint: str) -> tuple[str, str, str]:
    """Name, ticker and description of a coin read from the chain, for a coin whose fees route here but that was not
    launched on this site (the Hold coin itself, say): the Token-2022 metadata of pump.fun's create_v2, else the
    Metaplex metadata account of a classic create. The description comes from the metadata file when it answers."""
    name = symbol = uri = ""
    try:
        v = (eng.rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}]) or {}).get("value") or {}
        ext = ((v.get("data") or {}).get("parsed") or {}).get("info", {}).get("extensions") or []
        md = next((e.get("state") or {} for e in ext if e.get("extension") == "tokenMetadata"), {})
        name, symbol, uri = md.get("name") or "", md.get("symbol") or "", md.get("uri") or ""
        if not name:
            pda = eng.find_pda([b"metadata", bytes(METAPLEX), bytes(Pubkey.from_string(mint))], METAPLEX)
            acc = (eng.rpc("getAccountInfo", [str(pda), {"encoding": "base64"}]) or {}).get("value")
            if acc:
                raw = base64.b64decode(acc["data"][0])
                o = 1 + 32 + 32
                vals = []
                for _ in range(3):                                # name, symbol, uri: u32 length + bytes
                    n = struct.unpack_from("<I", raw, o)[0]
                    vals.append(raw[o + 4:o + 4 + n].decode("utf-8", "ignore").rstrip("\x00").strip())
                    o += 4 + n
                name, symbol, uri = vals
    except Exception as exc:  # noqa: BLE001
        log(f"{mint[:6]} name not readable: {str(exc)[:100]}")
    desc = ""
    if uri.startswith("http"):
        try:
            desc = str(eng.http_get_json(uri, timeout=8).get("description") or "")[:500] if hasattr(eng, "http_get_json") else ""
        except Exception:  # noqa: BLE001
            desc = ""
    return name[:32], symbol[:10], desc


def discover(w: Wallet) -> list[str]:
    st = books.state()
    try:
        chain = coins_on_chain(w.me)
    except Exception as exc:  # noqa: BLE001
        log(f"coin discovery failed, using the books only: {exc}")
        chain = []
    with books.LOCK:
        for row in chain:
            m = row["mint"]
            if m in st["coins"]:
                st["coins"][m]["locked"] = row["locked"]
                c = st["coins"][m]
                if not c.get("name") and not c.get("named_at"):      # found on chain earlier: fill in its name once
                    c["name"], c["symbol"], c["description"] = coin_names(m)
                    c["named_at"] = int(time.time())
            if m not in st["coins"]:
                p = st["pending"].pop(m, None) or {}
                nm, sym, desc = (p.get("name", ""), p.get("symbol", ""), p.get("description", "")) if p else coin_names(m)
                books.new_coin(m, name=nm, symbol=sym, description=desc, launcher=p.get("launcher", ""),
                               assets=p.get("assets") or [SOL], pair=p.get("pair") or SOL, created_at=p.get("t") or int(time.time()),
                               note="" if p else "found on chain: its fee sharing sends 100 percent here, so its holders are paid like every coin launched here")
                st["coins"][m]["locked"] = row["locked"]
                log(f"{m[:6]} {'launched here' if p else 'found on chain'}: {nm or '?'} ({sym or '?'}), fee split {'locked' if row['locked'] else 'not locked yet'}")
        if not DRY:
            books.save()
    return list(st["coins"])


def run_coin(w: Wallet, mint: str) -> None:
    st = books.state()
    c = books.coin(mint)
    curve = pumpkit.read_bonding_curve(mint)
    if not curve:
        return
    dry_pot = 0
    q, _ = quote_of(curve)
    if q != SOL and int(c.get("quote_held") or 0) > 0 and not DRY:
        convert_pair(w, mint, q)                                  # pair tokens a swap could not sell last round
    try:
        got = collect(w, mint, curve)
        dry_pot = -got if got < 0 else 0
    except Exception as exc:  # noqa: BLE001
        log(f"{mint[:6]} collect failed: {exc}")
    if st["owed_assets"].get(mint) and not DRY:
        deliver_owed(w, mint)                                     # last round's undelivered payments first
    rows, floor = sample(w, mint, curve)                          # the round's own look counts as a sample too
    if int(c["pot"]) - int(c["fee_debt"]) + dry_pot > 0 or st["credit"].get(mint):
        weighted = held_rows(mint)
        shares = assign(mint, weighted, floor, dry_pot)
        if shares:
            reset_held(mint)                                      # the next split counts holding time from now
        pay(w, mint, shares if DRY else None)


# ----------------------------------------------------------------------------- how long each wallet held
# Between two splits the desk looks at every coin's holders every sample_s seconds (20). Each look adds
# amount held x seconds since the previous look to the wallet's weight, but only for wallets that were above the
# 0.2 SOL line at that look. The split then goes by weight: a wallet that held for one minute of three gets a third
# of what a wallet holding the same amount for all three minutes gets, and buying just before a round earns
# almost nothing.
HELD: dict[str, dict] = {}


def _held(mint: str) -> dict:
    h = HELD.get(mint)
    if h is None:
        saved = (books.state().get("held") or {}).get(mint) or {}
        h = HELD[mint] = {"w": {o: float(v) for o, v in (saved.get("w") or {}).items()}, "t": saved.get("t"),
                          "last": dict(saved.get("last") or {}), "since": saved.get("since") or time.time(),
                          "age": {o: float(v) for o, v in (saved.get("age") or {}).items()},
                          "amt": {o: int(v) for o, v in (saved.get("amt") or {}).items()}}
    return h


def _save_held(mint: str, h: dict) -> None:
    with books.LOCK:
        books.state().setdefault("held", {})[mint] = {"w": {o: round(v) for o, v in h["w"].items()}, "t": h["t"],
                                                      "last": h["last"], "since": h["since"],
                                                      "age": {o: round(v) for o, v in h["age"].items()}, "amt": h["amt"]}


def multiplier(age_s: float) -> float:
    """The hold multiplier: 1x for coins bought just now, then a curve that climbs fast in the first days and flattens
    towards hold_max (10x). With tau 7 days: 1.05x after an hour, 2.2x after a day, 6.7x after a week, 8.8x after two
    weeks, 9.9x after a month."""
    tau = float(cfg("hold_tau_days")) * 86400
    return 1.0 + (float(cfg("hold_max")) - 1.0) * (1.0 - math.exp(-max(0.0, age_s) / tau))


loyalty = multiplier                                              # the old name, kept for anything that still calls it


def age_step(h: dict, amounts: dict[str, int], dt: float) -> None:
    """Moves every holder's age forward by dt. The age belongs to the coins: buying more mixes in new coins (age x
    old / new), selling part cuts the age by the part sold (age x new / old), selling everything resets it."""
    old_amt, age = h["amt"], h["age"]
    new_age = {}
    for o, a in amounts.items():
        prev = int(old_amt.get(o) or 0)
        g = float(age.get(o) or 0.0)
        if prev <= 0:
            g = 0.0
        else:
            g = g * (prev / a if a > prev else a / prev) + dt
        new_age[o] = g
    h["age"], h["amt"] = new_age, {o: int(a) for o, a in amounts.items()}


def sample(w: Wallet, mint: str, curve: dict | None = None) -> tuple[list[dict], int]:
    """The time since the previous look is credited to what wallets held AT the previous look, so a wallet only
    earns from the first moment it was seen holding: buying a second before a round earns about a second."""
    rows, floor, supply = holders(mint, {w.me}, curve)
    now = time.time()
    h = _held(mint)
    dt = max(0.0, min(now - h["t"], 2 * float(cfg("sample_s")))) if h["t"] else 0.0   # a gap never counts double
    age_step(h, _amounts.get(mint) or {}, dt)
    if dt:
        for o, amount in h["last"].items():
            h["w"][o] = h["w"].get(o, 0.0) + amount * dt * multiplier(h["age"].get(o, 0.0))
    h["last"] = {r["owner"]: r["amount"] for r in rows}
    h["t"] = now
    with books.LOCK:
        c = books.coin(mint)
        if c is not None:
            c["holders"], c["floor"] = len(rows), floor
            c["supply"] = supply
            c["mcap_lamports"], c["mcap_at"] = int(_price.get(mint, 0.0) * supply), int(now)
            ages = [h["age"].get(r["owner"], 0.0) for r in rows]
            c["avg_hold_s"] = int(sum(ages) / len(ages)) if ages else 0
            held_all = sum(r["amount"] for r in rows) or 1
            c["avg_mult"] = round(sum(r["amount"] * multiplier(h["age"].get(r["owner"], 0.0)) for r in rows) / held_all, 3) if rows else 1.0
    _save_held(mint, h)
    return rows, floor


def held_rows(mint: str) -> list[dict]:
    """Wallets and their weight (amount x seconds held) since the last split. Right after a restart, when nothing
    has been counted yet, the current holdings stand in for one sample interval."""
    h = _held(mint)
    w = h["w"] or {o: a * float(cfg("sample_s")) for o, a in h["last"].items()}
    return sorted(({"owner": o, "amount": int(v)} for o, v in w.items() if v >= 1), key=lambda r: -r["amount"])


def reset_held(mint: str) -> None:
    """After a split the weights start again; who holds right now keeps counting from now."""
    h = _held(mint)
    now = time.time()
    h.update({"w": {}, "t": now, "since": now})
    _save_held(mint, h)


def sample_all(w: Wallet) -> None:
    for m in list(books.state()["coins"]):
        try:
            curve = pumpkit.read_bonding_curve(m)
            if curve:
                sample(w, m, curve)
        except Exception as exc:  # noqa: BLE001
            log(f"{m[:6]} sample skipped: {str(exc)[:120]}")


def tick(w: Wallet) -> None:
    t0 = time.time()
    mints = discover(w)
    for m in mints:
        try:
            run_coin(w, m)
        except Exception:  # noqa: BLE001
            log(f"{m[:6]} round failed:\n" + traceback.format_exc())
    with books.LOCK:
        st = books.state()
        st["last_tick"] = int(time.time())
        st["last_tick_s"] = round(time.time() - t0, 1)
        st["dry"] = DRY
        if not DRY:
            books.save()


def loop() -> None:
    w = Wallet()
    with books.LOCK:                                              # a restart usually brings a fix: failed payments get a fresh start
        for rows in books.state()["owed_assets"].values():
            for r in rows:
                r["tries"] = 0
    log(f"{'DRY' if DRY else 'LIVE'} | payout wallet {w.me} | every {cfg('interval_s')} s | holders >= "
        f"{int(cfg('min_hold_bps')) / 100:g}% of the supply | holder RPC {holder_rpc().split('?')[0]}")
    last_round = 0.0
    while True:
        t0 = time.time()
        if STOP_FILE.exists():
            log(f"paused ({STOP_FILE} exists)")
        elif t0 - last_round >= float(cfg("interval_s")) - 1:
            last_round = t0
            try:
                tick(w)
            except Exception:  # noqa: BLE001
                log("round failed:\n" + traceback.format_exc())
        else:
            try:
                sample_all(w)                                     # who holds what, and for how long
            except Exception:  # noqa: BLE001
                log("sample failed:\n" + traceback.format_exc())
        time.sleep(max(2.0, float(cfg("sample_s")) - (time.time() - t0)))


# ----------------------------------------------------------------------------- what a round costs
def costs(holders_n: int = 2000, pot_sol: float = 1.0, new_accounts: int = 0, asset_account_bytes: int = 179) -> dict:
    """What one round costs on Solana, from the measured packet sizes and compute units. Lamports."""
    micro = int(cfg("priority_micro_lamports"))
    per_tx_existing, per_tx_new, per_tx_sol = 18, 9, 19
    existing = max(0, holders_n - new_accounts)
    tx_existing = -(-existing // per_tx_existing) if existing else 0
    tx_new = -(-new_accounts // per_tx_new) if new_accounts else 0
    fee_existing = tx_existing * (5_000 + (3_000 + per_tx_existing * CU_TRANSFER) * micro // 1_000_000)
    fee_new = tx_new * (5_000 + (3_000 + per_tx_new * (CU_OPEN + CU_TRANSFER)) * micro // 1_000_000)
    claim = 5_000 + 300_000 * micro // 1_000_000
    swap = 5_000 + int(cfg("swap_priority_max_lamports"))
    rent = 0
    try:
        rent = rent_for(asset_account_bytes)
    except Exception:  # noqa: BLE001
        rent = 1_559_560
    network = claim + swap + fee_existing + fee_new
    pot = int(pot_sol * 1e9)
    return {"holders": holders_n, "pot": pot, "transactions": 2 + tx_existing + tx_new, "claim": claim, "swap": swap,
            "transfers": fee_existing + fee_new, "network": network, "network_pct": round(network / pot * 100, 4) if pot else None,
            "to_holders": pot - network, "per_holder": (pot - network) // holders_n if holders_n else 0,
            "rent_per_new_account": rent, "rent_if_all_new": rent * holders_n,
            "per_tx": {"existing": per_tx_existing, "new": per_tx_new, "sol": per_tx_sol},
            "fee_per_tx": {"existing": 5_000 + (3_000 + per_tx_existing * CU_TRANSFER) * micro // 1_000_000,
                           "new": 5_000 + (3_000 + per_tx_new * (CU_OPEN + CU_TRANSFER)) * micro // 1_000_000},
            "open_multiple": float(cfg("open_account_multiple")),
            "rounds_per_day": 86_400 // int(cfg("interval_s")),
            "min_hold_bps": int(cfg("min_hold_bps"))}


def main(argv: list[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "loop"
    if cmd == "loop":
        return loop()
    if cmd == "once":
        return tick(Wallet())
    if cmd == "costs":
        print(json.dumps(costs(int(argv[2]) if len(argv) > 2 else 2000, float(argv[3]) if len(argv) > 3 else 1.0,
                               int(argv[4]) if len(argv) > 4 else 0), indent=1))
        return
    if cmd == "holders":
        rows, floor, supply = holders(argv[2], {treasury_address()})
        weight = sum(r["amount"] for r in rows) or 1
        print(f"{len(rows)} wallets hold at least {int(cfg('min_hold_bps')) / 100:g}% of the supply ({floor} raw of {supply})")
        for r in rows[:40]:
            print(f"  {r['owner']}  {r['amount'] / supply * 100:6.3f}% of supply  {r['amount'] / weight * 100:6.2f}% of each payout")
        return
    if cmd == "plan":
        w = Wallet()
        mint = argv[2]
        books.new_coin(mint, assets=argv[3].split(",") if len(argv) > 3 else [SOL])
        curve = pumpkit.read_bonding_curve(mint)
        print("fees waiting:", fees_waiting(mint, curve))
        rows, floor, supply = holders(mint, {w.me})
        print(f"{len(rows)} holders >= floor {floor}")
        return
    print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
