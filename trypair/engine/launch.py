"""Launching on the pair desk, always from the launcher's own wallet.

ROOT   a coin paired with SOL whose pump.fun creator fees are split, in the launch transaction itself, between the payout
       wallet (the part that pays the pair builders, root_pairs_bps_min .. 100 percent) and the launcher (the rest).
       update_fee_shares_v2 also revokes the admin, so the split can never be changed. Single-root sites (one coin, like
       PVE) take exactly one root launch, from the owner wallet in config.json.
PAIR   a coin whose quote asset is a root. It trades against the root, so every buy of it buys the root first and every
       root token in its curve or pool is locked. Its own creator fee (1 to 3 percent, paid in the root) stays with its
       launcher; on top of that its launcher is paid part of the root's fees, by how much root the pair keeps locked.

prepare_root / prepare_pair  build the transactions the wallet signs (create_v2, fee sharing, first buy; a pair's first
                             buy is paid in SOL and swapped into the root in the same signing).
send / status                relay and follow them (only transactions this server built).
confirm_root / confirm_pair  check on chain and book the coin.
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
import pairs
from op import chain as eng
from op import pumpkit

ROOT = Path(__file__).resolve().parent
SYMBOL_RE = re.compile(r"^[A-Za-z0-9]{1,10}$")
SOL = desk.SOL
CFG = desk.CFG
_prepared: dict[str, float] = {}                                 # message hash -> when this server built it


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
    if not re.match(r"^https?://[^\s]{3,200}$", v):
        raise ValueError(f"the {kind} link is not a web address")
    return v


def _basics(body: dict) -> tuple[str, str, str, str, tuple[bytes, str], dict, float]:
    """user, name, symbol, blurb, image, links, first buy in SOL. Raises ValueError with a message for the page."""
    user = str(body.get("user") or "")
    try:
        Pubkey.from_string(user)
    except Exception:  # noqa: BLE001
        raise ValueError("connect your wallet first") from None
    name = str(body.get("name") or "").strip()[:32]
    if not name:
        raise ValueError("give the coin a name")
    symbol = str(body.get("symbol") or "").strip().replace("$", "")
    if not SYMBOL_RE.match(symbol):
        raise ValueError("the ticker must be 1 to 10 letters or digits")
    blurb = str(body.get("description") or "").strip()
    if len(blurb) > 500:
        raise ValueError("the description must be under 500 characters")
    try:
        buy_sol = float(body.get("first_buy_sol") or 0)
    except (TypeError, ValueError):
        raise ValueError("the first buy must be a number") from None
    if not 0 <= buy_sol <= float(CFG["max_first_buy_sol"]):
        raise ValueError(f"the first buy must be between 0 and {CFG['max_first_buy_sol']} SOL")
    img = _image(str(body.get("image") or ""))
    links = {"twitter": _link(body.get("twitter"), "twitter"), "telegram": "", "website": ""}
    return user, name, symbol, blurb, img, links, buy_sol


def _remember(p: dict) -> None:
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


def _fail_build(e: Exception) -> tuple[int, dict]:
    print(f"[launch] preparing the transaction failed: {e}", flush=True)
    why = str(e)
    if "AccountNotFound" in why or "insufficient" in why.lower() or "no record of a prior credit" in why:
        return err("Your wallet does not have enough SOL for this launch: it pays the first buy, the new accounts "
                   "and the network fee. Nothing was launched.", 402)
    return err("Something went wrong on our side. Nothing was launched and nothing was spent. Try again in a minute.", 502)


def root_open() -> tuple[bool, str]:
    """Can a root be launched right now, and if not, why."""
    if not desk.treasury_address():
        return False, "launching is not open yet"
    if not CFG.get("launch_open", True):
        return False, "launching is not open yet"
    if CFG.get("single_root"):
        if pairs.root_mints():
            return False, f"{CFG['brand']} has launched; launch a pair on it instead"
        if not CFG.get("owner"):
            return False, "the genesis launch is not open yet"
    return True, ""


# ----------------------------------------------------------------------------- roots
def prepare_root(body: dict, site_url: str) -> tuple[int, dict]:
    ok, why = root_open()
    if not ok:
        return err(why, 503 if "not open" in why else 409)
    treasury = desk.treasury_address()
    try:
        user, name, symbol, blurb, img, links, buy_sol = _basics(body)
    except ValueError as e:
        return err(str(e), 401 if "wallet" in str(e) else 400)
    if CFG.get("single_root") and user != CFG.get("owner"):
        return err("only the owner wallet can make the genesis launch", 403)
    if user == treasury:
        return err("launch from your own wallet, not the payout wallet")
    lo = int(CFG.get("root_pairs_bps_min", 5000))
    try:
        bps = int(body.get("pairs_bps") or CFG.get("root_pairs_bps_default", 8000))
    except (TypeError, ValueError):
        return err("the pair builders' part must be a number")
    if not lo <= bps <= 10_000:
        return err(f"the pair builders' part must be between {lo // 100}% and 100%")
    shareholders = [(treasury, bps)] + ([(user, 10_000 - bps)] if bps < 10_000 else [])
    mint = Keypair()
    if site_url:
        links["website"] = f"{site_url.rstrip('/')}/r?mint={mint.pubkey()}"
    desc = (f"{blurb}\n\n" if blurb else "") + (
        f"A root on {CFG['brand']}: {bps / 100:g}% of every creator fee of this coin is paid to the people who build pairs "
        f"against it, by how much of it their pair keeps locked.")
    try:
        uri = metadata_uri(str(mint.pubkey()), name, symbol, desc[:1000], img, links, site_url)
    except Exception as e:  # noqa: BLE001
        print(f"[launch] metadata upload failed: {e}", flush=True)
        return err("The coin's picture and details could not be stored right now. Nothing was launched. Try again in a minute.", 502)
    try:
        p = pumpkit.prepare(user, name, symbol, uri, quote_mint=None, shareholders=shareholders,
                            first_buy=int(round(buy_sol * eng.LAMPORTS)), mint=mint, priority_micro=launch_priority())
    except Exception as e:  # noqa: BLE001
        return _fail_build(e)
    with books.LOCK:
        books.state()["pending"][p["mint"]] = {"name": name, "symbol": symbol, "launcher": user, "description": blurb,
                                               "pairs_bps": bps, "t": int(time.time()), "kind": "root"}
        books.IMAGES.mkdir(parents=True, exist_ok=True)
        (books.IMAGES / f"{p['mint']}.{img[1].split('/')[-1]}").write_bytes(img[0])
        books.save()
    _remember(p)
    return 200, {"ok": True, "kind": "root", "mint": p["mint"], "txs_b64": p["txs_b64"], "tx_kinds": p["tx_kinds"],
                 "last_valid_block_height": p["last_valid_block_height"], "pairs_bps": bps}


def confirm_root(body: dict) -> tuple[int, dict]:
    mint = str(body.get("mint") or "").strip()
    try:
        Pubkey.from_string(mint)
    except Exception:  # noqa: BLE001
        return err("bad mint")
    treasury = desk.treasury_address()
    cfg = pumpkit.read_sharing_config(mint)
    sh = (cfg or {}).get("shareholders") or []
    if not sh or sh[0]["address"] != treasury or sh[0]["bps"] < int(CFG.get("root_pairs_bps_min", 5000)):
        return err("that coin does not send its fees here", 403)
    with books.LOCK:
        st = books.state()
        if mint not in st["coins"]:
            p = st["pending"].get(mint)
            if not p or p.get("kind") != "root":
                return err("the launch details have expired", 410)
            if CFG.get("single_root"):
                if pairs.root_mints():
                    return err("the root is already set", 409)
                if p["launcher"] != CFG.get("owner"):
                    return err("only the owner wallet can make the genesis launch", 403)
                st["root"] = mint
            st["pending"].pop(mint, None)
            books.new_coin(mint, name=p["name"], symbol=p["symbol"], launcher=p["launcher"], assets=[SOL], pair=SOL,
                           description=p.get("description") or "", created_at=int(time.time()))
            books.event("launch", coin=mint, launcher=p["launcher"], sig=str(body.get("signature") or "") or None)
        st["coins"][mint]["locked"] = bool(cfg["admin_revoked"])
        st["coins"][mint]["pairs_bps"] = sh[0]["bps"]
        books.save()
    return 200, {"ok": True, "coin": st["coins"][mint]}


# ----------------------------------------------------------------------------- pairs
def prepare_pair(body: dict, site_url: str) -> tuple[int, dict]:
    if not desk.treasury_address() or not CFG.get("launch_open", True):
        return err("launching is not open yet", 503)
    root = str(body.get("root") or "").strip()
    roots = pairs.root_mints()
    if CFG.get("single_root") and not root and roots:
        root = roots[0]
    if root not in roots or books.coin(root) is None:
        return err(f"pick a root launched on {CFG['brand']}" if not CFG.get("single_root") else f"{CFG['brand']} has not launched yet", 400)
    try:
        user, name, symbol, blurb, img, links, buy_sol = _basics(body)
    except ValueError as e:
        return err(str(e), 401 if "wallet" in str(e) else 400)
    try:
        fee = int(body.get("fee_bps") or CFG.get("pair_fee_bps_default", 100))
    except (TypeError, ValueError):
        return err("the creator fee must be a number")
    hi = int(CFG.get("pair_fee_bps_max", 300))
    if not 1 <= fee <= hi:
        return err(f"the creator fee must be between 0.01% and {hi / 100:g}%")
    rc = books.coin(root) or {}
    mint = Keypair()
    if site_url:
        links["website"] = f"{site_url.rstrip('/')}/p?mint={mint.pubkey()}"
    desc = (f"{blurb}\n\n" if blurb else "") + (
        f"Paired against ${rc.get('symbol') or 'ROOT'} on {CFG['brand']}: every buy of this coin buys ${rc.get('symbol') or 'ROOT'} first, "
        f"and its launcher is paid part of ${rc.get('symbol') or 'ROOT'}'s creator fees for the ${rc.get('symbol') or 'ROOT'} it keeps locked.")
    try:
        uri = metadata_uri(str(mint.pubkey()), name, symbol, desc[:1000], img, links, site_url)
    except Exception as e:  # noqa: BLE001
        print(f"[launch] metadata upload failed: {e}", flush=True)
        return err("The coin's picture and details could not be stored right now. Nothing was launched. Try again in a minute.", 502)
    try:
        lamports = int(round(buy_sol * eng.LAMPORTS))
        p = pumpkit.prepare(user, name, symbol, uri, quote_mint=root, shareholders=None, creator_fee_bps=fee,
                            first_buy=0, swap_sol_for_buy=lamports, mint=mint, priority_micro=launch_priority())
    except Exception as e:  # noqa: BLE001
        return _fail_build(e)
    with books.LOCK:
        books.state()["pending_pairs"][p["mint"]] = {"name": name, "symbol": symbol, "launcher": user, "root": root,
                                                     "description": blurb, "fee_bps": fee, "t": int(time.time())}
        books.IMAGES.mkdir(parents=True, exist_ok=True)
        (books.IMAGES / f"{p['mint']}.{img[1].split('/')[-1]}").write_bytes(img[0])
        books.save()
    _remember(p)
    return 200, {"ok": True, "kind": "pair", "mint": p["mint"], "root": root, "txs_b64": p["txs_b64"], "tx_kinds": p["tx_kinds"],
                 "last_valid_block_height": p["last_valid_block_height"], "fee_bps": fee}


def confirm_pair(body: dict) -> tuple[int, dict]:
    mint = str(body.get("mint") or "").strip()
    try:
        Pubkey.from_string(mint)
    except Exception:  # noqa: BLE001
        return err("bad mint")
    curve = pumpkit.read_bonding_curve(mint)
    with books.LOCK:
        st = books.state()
        p = st["pending_pairs"].get(mint)
        root = (p or {}).get("root") or (curve or {}).get("quote_mint")
        if not curve or curve.get("quote_mint") != root or root not in st["coins"]:
            return err("that coin is not paired against a root here", 403)
        book = st["pairs"].setdefault(root, {})
        row = book.setdefault(mint, {"mint": mint, "first_seen": int(time.time())})
        if p:
            row.update({"name": p["name"], "symbol": p["symbol"], "description": p.get("description") or "",
                        "launched_here": True, "created_at": p.get("t"), "creator": p["launcher"], "fee_bps": p.get("fee_bps")})
            st["pending_pairs"].pop(mint, None)
            books.event("pair", coin=root, pair=mint, launcher=p["launcher"], sig=str(body.get("signature") or "") or None)
        books.save()
    return 200, {"ok": True, "pair": row, "root": root}


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


