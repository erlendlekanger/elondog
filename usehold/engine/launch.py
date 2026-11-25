"""Launching a coin on Hold from the launcher's own wallet. A coin is paired with SOL or with one of the xStocks
pump.fun accepts as a quote (TSLAx, NVDAx, SPYx ...). Its holders are paid in what it is paired with: SOL for a SOL
pair, the stock itself for a stock pair.

prepare  uploads the metadata to pump.fun's IPFS and builds the launch the launcher's wallet signs: create_v2 (the
         launcher is the creator), create_fee_sharing_config + update_fee_shares_v2 with ONE shareholder, the payout
         wallet, at 100 percent (this also revokes the admin, so the split can never be changed), and the first buy.
send     relays a signed transaction (only transactions this server built, or made only of pump.fun's programs).
status   signature statuses for the launch page.
confirm  checks on chain that the coin's fee sharing really is 100 percent to the payout wallet and books the coin
         with the assets chosen at prepare (never the ones in this request).
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
import time
import urllib.request
from pathlib import Path

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

import books
import desk
from op import chain as eng
from op import pumpkit

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT.parent / "web" / "assets" / "catalog.json"
SYMBOL_RE = re.compile(r"^[A-Za-z0-9]{1,10}$")
_catalog: dict | None = None
_prepared: dict[str, float] = {}


def catalog() -> dict[str, dict]:
    """Known assets by mint. Hold pays in SOL only, so without a catalog file SOL is all there is."""
    global _catalog
    if _catalog is None:
        try:
            _catalog = {a["mint"]: a for a in json.loads(CATALOG.read_text(encoding="utf-8"))["assets"]}
        except FileNotFoundError:
            _catalog = {desk.SOL: {"mint": desk.SOL, "symbol": "SOL", "name": "Solana", "kind": "crypto", "decimals": 9, "logo": ""}}
    return _catalog


def err(msg: str, code: int = 400):
    return code, {"ok": False, "error": msg}


def _image(data_url: str) -> tuple[bytes, str]:
    m = re.match(r"^data:(image/(png|jpeg|jpg|gif|webp));base64,(.+)$", data_url or "", re.S)
    if not m:
        raise ValueError("add a PNG, JPG, GIF or WebP image")
    raw = base64.b64decode(m.group(3))
    if len(raw) > 4_000_000:
        raise ValueError("the image must be under 4 MB")
    return raw, m.group(1).replace("image/jpg", "image/jpeg")


def _link(v, kind: str) -> str:
    v = str(v or "").strip()
    if not v:
        return ""
    if kind == "twitter" and re.match(r"^@?[A-Za-z0-9_]{1,15}$", v):
        return "https://x.com/" + v.lstrip("@")
    if kind == "telegram" and re.match(r"^@?[A-Za-z0-9_]{4,32}$", v):
        return "https://t.me/" + v.lstrip("@")
    if not re.match(r"^https?://[^\s]{3,200}$", v):
        raise ValueError(f"the {kind} link is not a web address")
    return v


def check_asset(mint: str) -> dict:
    """An asset can be paid out when its mint exists, its tokens can move freely and Jupiter can buy it with SOL."""
    if mint == desk.SOL:
        return catalog()[mint]
    try:
        Pubkey.from_string(mint)
    except Exception:  # noqa: BLE001
        raise ValueError(f"{mint[:12]} is not a mint address") from None
    row = catalog().get(mint)
    v = (eng.rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}]) or {}).get("value")
    if not v or not isinstance(v.get("data"), dict) or v["data"]["parsed"].get("type") != "mint":
        raise ValueError(f"{(row or {}).get('symbol') or mint[:6]} is not a token mint")
    for e in v["data"]["parsed"]["info"].get("extensions") or []:
        name, state = e.get("extension"), e.get("state") or {}
        if name == "nonTransferable":
            raise ValueError(f"{(row or {}).get('symbol') or mint[:6]} cannot be transferred")
        if name == "transferHook" and state.get("programId"):
            raise ValueError(f"{(row or {}).get('symbol') or mint[:6]} runs a transfer hook, so it cannot be sent in bulk")
    if not row:                                                   # a mint pasted by the launcher: it must have a route
        eng.jup_quote(desk.SOL, mint, 10_000_000, 300)
        info = v["data"]["parsed"]["info"]
        row = {"mint": mint, "symbol": mint[:4], "name": "Custom token", "kind": "crypto", "decimals": info.get("decimals"),
               "program": v["owner"], "logo": ""}
    return row


def prepare(body: dict, site_url: str) -> tuple[int, dict]:
    treasury = desk.treasury_address()
    if not treasury or not desk.CFG.get("launch_open", True):
        return err("launching is not open yet", 503)
    user = str(body.get("user") or "")
    try:
        Pubkey.from_string(user)
    except Exception:  # noqa: BLE001
        return err("connect your wallet first", 401)
    name = str(body.get("name") or "").strip()[:32]
    if not name:
        return err("give the coin a name")
    symbol = str(body.get("symbol") or "").strip().replace("$", "")
    if not SYMBOL_RE.match(symbol):
        return err("the ticker must be 1 to 10 letters or digits")
    blurb = str(body.get("description") or "").strip()
    if len(blurb) > 500:
        return err("the description must be under 500 characters")
    pair = str(body.get("pair") or desk.SOL).strip()
    try:
        allowed = {r["mint"] for r in launch_pairs()}
    except Exception as e:  # noqa: BLE001
        print(f"[launch] pair list failed: {e}", flush=True)
        allowed = {desk.SOL}
    if pair not in allowed:
        return err("Pick SOL or one of the stocks as the pair.")
    assets = [pair]                                               # holders are paid in what the coin is paired with
    try:
        prow = check_pair(pair)
    except Exception as e:  # noqa: BLE001
        print(f"[launch] pair check failed: {e}", flush=True)
        return err("Something went wrong on our side. Nothing was launched and nothing was spent. Try again in a minute.", 502)
    spec = prow["_spec"]
    try:
        buy_sol = float(body.get("first_buy_sol") or 0)
    except (TypeError, ValueError):
        return err("the first buy must be a number")
    if not 0 <= buy_sol <= float(desk.CFG["max_first_buy_sol"]):
        return err(f"the first buy must be between 0 and {desk.CFG['max_first_buy_sol']} SOL")
    try:
        img = _image(str(body.get("image") or ""))
        links = {"twitter": _link(body.get("twitter"), "twitter"), "telegram": "",       # never Telegram
                 "website": ""}                                      # always the coin's own page here, below
    except ValueError as e:
        return err(str(e))

    mint = Keypair()
    if site_url:                                                  # the coin's website is its page here, never the launcher's choice
        links["website"] = f"{site_url.rstrip('/')}/c?mint={mint.pubkey()}"
    desc = (f"{blurb}\n\n" if blurb else "") + (
        f"Launched on {desk.CFG['brand']}: every creator fee of this coin is paid in {prow.get('symbol') or 'SOL'} to its holders, "
        f"by how much they hold and how long they have held it. The longer a wallet holds, the bigger its share.")
    try:
        uri = metadata_uri(str(mint.pubkey()), name, symbol, desc[:1000], img, links, site_url)
    except Exception as e:  # noqa: BLE001
        print(f"[launch] metadata upload failed: {e}", flush=True)
        return err("The coin's picture and details could not be stored right now. Nothing was launched. Try again in a minute.", 502)
    try:
        lamports = int(round(buy_sol * eng.LAMPORTS))
        sol_pair = spec["via"] == "sol"
        # a token pair: the first buy is paid in SOL and swapped into the pair in the same signing
        p = pumpkit.prepare(user, name, symbol, uri, quote_mint=spec["mint"], shareholders=[(treasury, 10_000)],
                            creator_fee_bps=PAIR_CREATOR_FEE_BPS if spec.get("custom_fee") else 0,
                            first_buy=lamports if sol_pair else 0, swap_sol_for_buy=0 if sol_pair else lamports, mint=mint,
                            priority_micro=launch_priority())
    except Exception as e:  # noqa: BLE001
        print(f"[launch] preparing the transaction failed: {e}", flush=True)
        why = str(e)
        if "AccountNotFound" in why or "insufficient" in why.lower() or "no record of a prior credit" in why:
            return err("Your wallet does not have enough SOL for this launch: it pays the first buy, the new accounts "
                       "and the network fee. Nothing was launched.", 402)
        return err("Something went wrong on our side. Nothing was launched and nothing was spent. Try again in a minute.", 502)
    with books.LOCK:
        books.state()["pending"][p["mint"]] = {"name": name, "symbol": symbol, "launcher": user, "assets": assets,
                                               "pair": spec["mint"], "description": blurb, "t": int(time.time())}
        books.IMAGES.mkdir(parents=True, exist_ok=True)
        (books.IMAGES / f"{p['mint']}.{img[1].split('/')[-1]}").write_bytes(img[0])
        books.save()
    now = time.time()
    for t in p["txs_b64"]:
        _prepared[_msg_hash(base64.b64decode(t))] = now
        msg = VersionedTransaction.from_bytes(base64.b64decode(t)).message
        signers = [str(k) for k in list(msg.account_keys)[:msg.header.num_required_signatures]]
        _prepared_ix.append({"t": now, "payer": str(msg.account_keys[0]), "ixs": _ixs(msg),
                             "mint": p["mint"] if p["mint"] in signers else None})
    _mint_keys[p["mint"]] = (base64.b64decode(p["mint_secret"]), now)
    for k in [k for k, v in _prepared.items() if now - v > 7200]:
        _prepared.pop(k, None)
    _prepared_ix[:] = [e for e in _prepared_ix if now - e["t"] <= 7200]
    for k in [k for k, v in _mint_keys.items() if now - v[1] > 7200]:
        _mint_keys.pop(k, None)
    return 200, {"ok": True, "mint": p["mint"], "txs_b64": p["txs_b64"], "tx_kinds": p["tx_kinds"],
                 "last_valid_block_height": p["last_valid_block_height"], "sharing_config": p["sharing_config"],
                 "paid_in": [prow.get("symbol") or "SOL"], "pair": prow.get("symbol") or "SOL"}


# ----------------------------------------------------------------------------- pairs
# What a coin trades against on pump.fun. The program accepts SOL, USDC (Global's whitelisted quote), every mint in
# its quote-control list (stocks such as TSLAx and SPYx, crypto such as WBTC and HYPE) and any pump.fun coin.
# Pairs from quote-control take a creator fee the launch sets itself; pump.fun's default for them is 5 bps.
PAIR_CREATOR_FEE_BPS = int(desk.CFG.get("pair_creator_fee_bps", 95))
_pairs: dict = {"at": 0.0, "rows": None}


def _row(mint: str, via: str) -> dict:
    a = catalog().get(mint)
    if a:
        return {"mint": mint, "symbol": a["symbol"], "name": a["name"], "logo": a.get("logo") or "", "kind": a["kind"], "via": via}
    md = {}
    try:                                                          # read fresh: mint_info's cache drops the metadata
        v = (eng.rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}]) or {}).get("value") or {}
        ext = ((v.get("data") or {}).get("parsed") or {}).get("info", {}).get("extensions") or []
        md = next((e.get("state") or {} for e in ext if e.get("extension") == "tokenMetadata"), {})
    except Exception:  # noqa: BLE001
        md = {}
    return {"mint": mint, "symbol": md.get("symbol") or mint[:4], "name": md.get("name") or "Token",
            "logo": f"https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/{mint}.webp" if mint.endswith("pump") else "",
            "kind": "crypto", "via": via}


def pair_list() -> list[dict]:
    if _pairs["rows"] is None or time.time() - _pairs["at"] > 3600:
        g = pumpkit.read_global()
        rows = [_row(desk.SOL, "sol"), _row(g["whitelisted_quote_mint"], "global")]
        rows += [_row(m, "control") for m in pumpkit.quote_control()]
        order = {"crypto": 0, "stock": 1, "etf": 1}
        head, rest = rows[:2], rows[2:]
        rest.sort(key=lambda r: (order.get(r["kind"], 2), r["symbol"].lower()))
        _pairs.update({"rows": head + rest, "at": time.time()})
    return _pairs["rows"]


def is_xstock(row: dict) -> bool:
    a = catalog().get(row["mint"]) or {}
    return row.get("kind") in ("stock", "etf") and (a.get("issuer") == "xstocks"
                                                    or (row["symbol"].endswith("x") and row["mint"].startswith("Xs")))


def launch_pairs() -> list[dict]:
    """What a coin on Hold can be paired with: SOL, or one of the xStocks pump.fun accepts as a quote."""
    rows = pair_list()
    sol = next(r for r in rows if r["via"] == "sol")
    xs = sorted((r for r in rows if is_xstock(r)), key=lambda r: r["symbol"].lower())
    return [{**sol, "symbol": "SOL", "name": "Solana", "logo": ""}] + xs


def check_pair(mint: str) -> dict:
    """The pair row for a mint pump.fun accepts as a quote, with the program's own spec under _spec."""
    try:
        Pubkey.from_string(mint)
    except Exception:  # noqa: BLE001
        raise ValueError("the pair is not a mint address") from None
    try:
        spec = pumpkit.quote_spec(mint)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"pump.fun does not accept this as a pair: {str(e)[:120]}") from None
    if spec["via"] != "sol":                                       # the first buy is swapped from SOL, so it needs a route
        try:
            eng.jup_quote(desk.SOL, spec["mint"], 10_000_000, 300)
        except Exception:  # noqa: BLE001
            raise ValueError("Jupiter has no route from SOL to this pair, so the first buy and the payouts cannot be made") from None
    row = next((r for r in (_pairs["rows"] or []) if r["mint"] == spec["mint"]), None) or _row(spec["mint"], spec["via"])
    return {**row, "via": spec["via"], "_spec": spec}


# ----------------------------------------------------------------------------- metadata
META = books.STATE_DIR / "meta"


def metadata_uri(mint: str, name: str, symbol: str, description: str, img: tuple[bytes, str], links: dict, site_url: str) -> str:
    """The coin's metadata URI. pump.fun's own IPFS upload first; when pump.fun refuses this machine (its Cloudflare
    wall answered 403 from 2026-11-07), the metadata and image are kept here and served from the site's own domain:
    <site>/meta/<mint>.json and <site>/img/<mint>. Both are written before the launch is built and never change."""
    ext = img[1].split("/")[-1]
    books.IMAGES.mkdir(parents=True, exist_ok=True)
    (books.IMAGES / f"{mint}.{ext}").write_bytes(img[0])
    try:
        uri, _ = eng.upload_metadata(name, symbol, description, img[0], img[1], **links)
        return uri
    except Exception as e:  # noqa: BLE001
        if not site_url:
            raise RuntimeError(f"pump.fun refused the upload ({str(e)[:80]}) and no site_url is set to host it") from None
    base = site_url.rstrip("/")
    meta = {"name": name, "symbol": symbol, "description": description, "image": f"{base}/img/{mint}",
            "showName": True, "createdOn": base}
    for k in ("twitter", "telegram", "website"):
        if links.get(k):
            meta[k] = links[k]
    META.mkdir(parents=True, exist_ok=True)
    (META / f"{mint}.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    uri = f"{base}/meta/{mint}.json"
    if not public_ok(uri) or not public_ok(f"{base}/img/{mint}"):
        (META / f"{mint}.json").unlink(missing_ok=True)
        raise RuntimeError("pump.fun refused the picture upload just now, and the public site cannot reach this machine to "
                           "host it instead. Try again in a moment; nothing was launched")
    return uri


def public_ok(url: str) -> bool:
    """Is this address answered on the public internet right now? A coin must never point at a dead picture."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Hold/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


ALLOWED = {str(pumpkit.PUMP), str(pumpkit.PFEE), str(pumpkit.PAMM), "ComputeBudget111111111111111111111111111111",
           "11111111111111111111111111111111", str(eng.ATA_PROGRAM), str(eng.TOKEN_LEGACY), str(eng.TOKEN_2022),
           "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"}            # Jupiter: the SOL -> pair swap before a token-pair first buy


def _msg_hash(raw: bytes) -> str:
    return hashlib.sha256(bytes(VersionedTransaction.from_bytes(raw).message)).hexdigest()


# A wallet may change a transaction before it signs it: Phantom and others set their own priority fee or add guard
# instructions. The mint's signature from prepare then no longer matches, and Solana rejects the whole launch. So the
# mint signs again in send, AFTER the wallet, but only when every instruction prepared here is still in the
# transaction, unchanged (the compute budget aside, which is the wallet's to set).
_prepared_ix: list[dict] = []                                     # {"t", "payer", "ixs", "mint"} per prepared transaction
_mint_keys: dict[str, tuple[bytes, float]] = {}                   # a launch's mint keypair, until it is sent (2 h at most)
COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111"


def _ixs(msg) -> frozenset:
    """The message's instructions as (program, data, accounts), the compute budget left out. Accounts loaded from a
    lookup table are named by table and index, so a wallet that recompiles the message still matches."""
    keys = [str(k) for k in msg.account_keys]
    for lk in msg.address_table_lookups:
        keys += [f"{lk.account_key}#{i}" for i in lk.writable_indexes]
    for lk in msg.address_table_lookups:
        keys += [f"{lk.account_key}#{i}" for i in lk.readonly_indexes]
    out = set()
    for ix in msg.instructions:
        prog = keys[ix.program_id_index]
        if prog != COMPUTE_BUDGET:
            out.add((prog, bytes(ix.data), tuple(keys[a] for a in bytes(ix.accounts))))
    return frozenset(out)


def _match(msg) -> dict | None:
    payer, ixs = str(msg.account_keys[0]), _ixs(msg)
    return next((e for e in reversed(_prepared_ix) if e["payer"] == payer and e["ixs"] <= ixs), None)


PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"


def launch_priority() -> int:
    """The priority fee for a launch (micro-lamports per compute unit): the paid RPC's estimate of what lands on the
    pump program right now ("VeryHigh"), at least 2,000,000 and at most 10,000,000. A launch of about 450k units then
    costs 0.0009 to 0.0045 SOL in priority, and does not get dropped when the network is busy (2026-11-12 launches with
    a fixed 1,000,000 were accepted by the node and never landed)."""
    try:
        r = eng.http_json(eng.paid_rpc(), {"jsonrpc": "2.0", "id": 1, "method": "getPriorityFeeEstimate",
                                           "params": [{"accountKeys": [PUMP], "options": {"priorityLevel": "VeryHigh"}}]},
                          timeout=6, tries=1)
        v = int(float(r["result"]["priorityFeeEstimate"]))
    except Exception:  # noqa: BLE001
        v = 0
    return max(2_000_000, min(v, 10_000_000))


def _rebroadcast(raw_b64: str, sig: str) -> None:
    """Sends the signed launch again every 2 s through the paid RPC until it is confirmed, fails, or 80 s have passed
    (its blockhash is gone by then). A node that accepted it once may still drop it; sending again is how it lands."""
    url = eng.paid_rpc()
    if not url:
        return
    end = time.time() + 80
    while time.time() < end:
        time.sleep(2)
        try:
            st = eng.http_json(url, {"jsonrpc": "2.0", "id": 1, "method": "getSignatureStatuses", "params": [[sig]]},
                               timeout=6, tries=1)["result"]["value"][0]
            if st and (st.get("err") or st.get("confirmationStatus") in ("confirmed", "finalized")):
                return
            eng.http_json(url, {"jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
                                "params": [raw_b64, {"encoding": "base64", "skipPreflight": True, "maxRetries": 0}]}, timeout=6, tries=1)
        except Exception:  # noqa: BLE001
            pass


def send(body: dict) -> tuple[int, dict]:
    try:
        raw = base64.b64decode(str(body.get("tx_b64") or ""))
        tx = VersionedTransaction.from_bytes(raw)
    except Exception:  # noqa: BLE001
        return err("bad transaction")
    msg = tx.message
    exact = hashlib.sha256(bytes(msg)).hexdigest() in _prepared
    match = _match(msg)
    if not exact and not match:
        return err("this transaction did not come from this site")
    if match and match["mint"] and match["mint"] in _mint_keys:   # the mint signs after the wallet
        from solders.message import to_bytes_versioned
        keys = [str(k) for k in msg.account_keys]
        sigs = list(tx.signatures)
        sigs[keys.index(match["mint"])] = Keypair.from_bytes(_mint_keys[match["mint"]][0]).sign_message(to_bytes_versioned(msg))
        tx = VersionedTransaction.populate(msg, sigs)
        raw = bytes(tx)
    if any(bytes(s) == bytes(64) for s in tx.signatures):
        return err("the transaction is not fully signed")
    try:
        sig = eng.rpc("sendTransaction", [base64.b64encode(raw).decode(), {
            "encoding": "base64", "skipPreflight": bool(body.get("skip_preflight")), "preflightCommitment": "confirmed",
            "maxRetries": 5}])
    except Exception as e:  # noqa: BLE001
        why = str(e)
        print(f"[launch] Solana rejected a launch transaction: {why[:400]}", flush=True)
        if "Blockhash not found" in why or "BlockhashNotFound" in why or "block height exceeded" in why:
            return 502, {"ok": False, "error": "The approval took too long, so Solana no longer takes this transaction. "
                         "Nothing was launched and nothing was spent. Press Launch again and approve within a minute.",
                         "why": "expired"}
        if "no record of a prior credit" in why or "insufficient lamports" in why or "insufficient funds" in why.lower():
            return 502, {"ok": False, "error": "Your wallet does not have enough SOL for this launch: it pays the first buy, "
                         "the new accounts and the network fee. Nothing was launched.",
                         "why": "funds"}
        return 502, {"ok": False, "error": "Solana did not accept the transaction. Nothing was launched. Try again in a minute."}
    threading.Thread(target=_rebroadcast, args=(base64.b64encode(raw).decode(), str(sig)), daemon=True).start()
    return 200, {"ok": True, "signature": sig}


def status(body: dict) -> tuple[int, dict]:
    sigs = [str(s) for s in (body.get("signatures") or [])][:8]
    if not sigs:
        return err("no signatures")
    try:
        res = eng.rpc("getSignatureStatuses", [sigs, {"searchTransactionHistory": False}])["value"]
    except Exception as e:  # noqa: BLE001
        return 502, {"ok": False, "error": str(e)[:200]}
    return 200, {"ok": True, "statuses": [
        {"signature": s, "confirmed": bool(v and v.get("confirmationStatus") in ("confirmed", "finalized")),
         "error": (json.dumps(v.get("err")) if v and v.get("err") else None)} for s, v in zip(sigs, res)]}


def confirm(body: dict) -> tuple[int, dict]:
    mint = str(body.get("mint") or "").strip()
    try:
        Pubkey.from_string(mint)
    except Exception:  # noqa: BLE001
        return err("bad mint")
    treasury = desk.treasury_address()
    cfg = pumpkit.read_sharing_config(mint)
    if not cfg or len(cfg["shareholders"]) != 1 or cfg["shareholders"][0]["address"] != treasury \
            or cfg["shareholders"][0]["bps"] != 10_000:
        return err("that coin does not send its fees here", 403)
    with books.LOCK:
        st = books.state()
        if mint not in st["coins"]:
            p = st["pending"].pop(mint, None)
            if not p:
                return err("the launch details have expired", 410)
            books.new_coin(mint, name=p["name"], symbol=p["symbol"], launcher=p["launcher"], assets=p.get("assets") or [desk.SOL], pair=p.get("pair") or desk.SOL,
                           description=p.get("description") or "", created_at=int(time.time()))
            books.event("launch", coin=mint, launcher=p["launcher"], sig=str(body.get("signature") or "") or None)
        st["coins"][mint]["locked"] = bool(cfg["admin_revoked"])
        books.save()
    return 200, {"ok": True, "coin": st["coins"][mint]}
