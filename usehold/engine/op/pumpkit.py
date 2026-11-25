"""pump.fun launch kit: create_v2 with any admitted quote asset, a custom creator
fee, pump.fun's own fee sharing (up to 10 shareholders, admin revoked) and a first buy.

Everything is built from the programs' Anchor IDLs:
  op/_idl_pump.json        read from chain (anchor:idl account of 6EF8...), 2026-09-15
  op/_idl_pump_fees.json   Pump Fees (pfeeU...), as shipped in pump.fun's SDK
  op/_idl_pump_amm.json    PumpSwap (pAMM...), same source

What the program accepts (VERIFIED from its IDL docs + live Global/quote-control accounts):
  * quote mint: SOL (no remaining accounts), the Global whitelist (USDC), any mint in the
    `quote-control` PDA (224 on 2026-10-24: xStocks, Backpack Securities, SPCX, wrapped assets), or ANY
    pump.fun coin, graduated or still on its curve (seen on chain / simulated 2026-10-24). Remaining accounts: quote_mint,
    associated_quote_bonding_curve, quote_token_program, quote-control, and for a pump-coin pair also the quote
    coin's bonding curve (enough while it is on the curve) plus, once graduated, its canonical PumpSwap pool and
    that pool's base and quote token accounts.
  * creator_fee_bps (EOF-tolerant u64): honoured for quote-control mints and pump.fun coins as pairs, 1..=Global.max (300).
    Seen on chain 2026-11-10: coins paired with another pump coin carry 100 to 300 bps and their creator vault fills.
  * after create the bonding curve's creator can move the coin to a sharing_config
    (create_fee_sharing_config) and set the final shareholders (update_fee_shares_v2), which
    revokes the admin: the split is then permanent and pump.fun shows it as "Shared fees".
"""
from __future__ import annotations

import base64
import json
import struct
import time
from pathlib import Path

from solders.address_lookup_table_account import AddressLookupTableAccount
from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

from op import chain as eng

ROOT = Path(__file__).resolve().parent
PUMP = eng.PUMP_PROGRAM
PFEE = eng.PFEE_PROGRAM
PAMM = eng.PUMPSWAP_PROGRAM
SIM_PAYER = "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"   # a funded account (pump.fun fee wallet) used only as payer in simulations
MAX_TX_BYTES = 1232
PUMP_ALT = Pubkey.from_string("Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP")     # pump.fun's own lookup table
QUOTE_CONTROL = eng.find_pda([b"quote-control"], PUMP)

_idls: dict[str, dict] = {}


def idl(which: str = "pump") -> dict:
    if which not in _idls:
        _idls[which] = json.loads((ROOT / f"_idl_{ {'pump': 'pump', 'fees': 'pump_fees', 'amm': 'pump_amm'}[which] }.json").read_text(encoding="utf-8"))
    return _idls[which]


def _ins(name: str, which: str = "pump") -> dict:
    for i in idl(which)["instructions"]:
        if i["name"] == name:
            return i
    raise RuntimeError(f"instruction {name} not in {which} IDL")


def resolve_accounts(ins: dict, ctx: dict, program: Pubkey = PUMP) -> list[AccountMeta]:
    """ctx: account name (or dotted seed path like 'bonding_curve.creator') -> Pubkey. Fixed addresses
    and PDAs come from the IDL, so account order and seeds are the program's own."""
    resolved: dict[str, Pubkey] = dict(ctx)
    for a in ins["accounts"]:
        if a.get("address") and a["name"] not in resolved:
            resolved[a["name"]] = Pubkey.from_string(a["address"])

    def seed(s: dict) -> bytes:
        if s["kind"] == "const":
            return bytes(s["value"])
        if s["kind"] == "account":
            if s["path"] in resolved:
                return bytes(resolved[s["path"]])
            raise RuntimeError(f"seed account {s['path']} unresolved")
        raise RuntimeError(f"seed kind {s['kind']} unsupported")

    metas = []
    for a in ins["accounts"]:
        name = a["name"]
        if name in resolved:
            pk = resolved[name]
        elif a.get("pda"):
            pda = a["pda"]
            prog = program
            if pda.get("program"):
                p = pda["program"]
                prog = Pubkey.from_bytes(bytes(p["value"])) if p.get("kind") == "const" else resolved[p["path"]]
            pk = Pubkey.find_program_address([seed(s) for s in pda["seeds"]], prog)[0]
        elif name == "program":
            pk = program
        elif name == "mayhem_token_vault":
            pk = eng.find_pda([bytes(resolved["mayhem_state"]), bytes(eng.TOKEN_2022), bytes(resolved["mint"])], eng.ATA_PROGRAM)
        else:
            raise RuntimeError(f"cannot resolve account {name}")
        resolved[name] = pk
        metas.append(AccountMeta(pk, is_signer=bool(a.get("signer")), is_writable=bool(a.get("writable"))))
    return metas


def _str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("<I", len(b)) + b


# ---------------------------------------------------------------- program state
_cache: dict[str, tuple[float, object]] = {}


def _cached(k: str, ttl: float, fn):
    hit = _cache.get(k)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    v = fn()
    _cache[k] = (time.time(), v)
    return v


def read_global() -> dict:
    def load():
        g = eng.find_pda([b"global"], PUMP)
        raw = base64.b64decode(eng.rpc("getAccountInfo", [str(g), {"encoding": "base64"}])["value"]["data"][0])
        o = 8 + 1
        o += 32
        fee_recipient = Pubkey.from_bytes(raw[o:o + 32]); o += 32
        ivt, ivs, irt, supply, fee_bps = struct.unpack_from("<5Q", raw, o); o += 40
        o += 32 + 1 + 8
        creator_fee_bps = struct.unpack_from("<Q", raw, o)[0]; o += 8
        o += 7 * 32 + 32 + 32
        create_v2_enabled = raw[o] == 1; o += 1
        o += 32 + 32 + 1 + 7 * 32 + 1
        buyback = [str(Pubkey.from_bytes(raw[o + i * 32:o + (i + 1) * 32])) for i in range(8)]; o += 8 * 32
        buyback_bps = struct.unpack_from("<Q", raw, o)[0]; o += 8
        ivq = struct.unpack_from("<Q", raw, o)[0]; o += 8
        whitelisted = str(Pubkey.from_bytes(raw[o:o + 32])); o += 32
        cfg_on = raw[o] == 1; o += 1
        max_cfg = struct.unpack_from("<Q", raw, o)[0]; o += 8
        return {"fee_recipient": str(fee_recipient), "initial_virtual_token_reserves": ivt, "initial_virtual_sol_reserves": ivs,
                "initial_real_token_reserves": irt, "fee_basis_points": fee_bps, "creator_fee_basis_points": creator_fee_bps,
                "create_v2_enabled": create_v2_enabled, "buyback_fee_recipients": buyback, "buyback_basis_points": buyback_bps,
                "initial_virtual_quote_reserves": ivq, "whitelisted_quote_mint": whitelisted,
                "creator_fee_configurable": cfg_on, "max_configurable_creator_fee_bps": max_cfg}
    return _cached("global", 600, load)


def quote_control() -> dict[str, int]:
    """mint -> initial virtual quote reserves, for every mint admitted through quote-control."""
    def load():
        raw = base64.b64decode(eng.rpc("getAccountInfo", [str(QUOTE_CONTROL), {"encoding": "base64"}])["value"]["data"][0])
        o = 8 + 32 + 64
        n = struct.unpack_from("<I", raw, o)[0]; o += 4
        out = {}
        for _ in range(n):
            out[str(Pubkey.from_bytes(raw[o:o + 32]))] = struct.unpack_from("<Q", raw, o + 32)[0]
            o += 40
        return out
    return _cached("quote_control", 900, load)


def quote_spec(quote_mint: str | None) -> dict:
    """How the program treats a quote asset: {mint, program, decimals, via, ivq, custom_fee}."""
    g = read_global()
    if not quote_mint or quote_mint == str(eng.WSOL_MINT):
        return {"mint": str(eng.WSOL_MINT), "program": str(eng.TOKEN_LEGACY), "decimals": 9, "via": "sol",
                "ivq": g["initial_virtual_sol_reserves"], "custom_fee": False}
    info = eng.mint_info(quote_mint)
    if not info:
        raise RuntimeError("quote mint not readable")
    if quote_mint == g["whitelisted_quote_mint"]:
        return {"mint": quote_mint, "program": info["program"], "decimals": info["decimals"], "via": "global",
                "ivq": g["initial_virtual_quote_reserves"], "custom_fee": False}
    qc = quote_control()
    if quote_mint in qc:
        return {"mint": quote_mint, "program": info["program"], "decimals": info["decimals"], "via": "control",
                "ivq": qc[quote_mint], "custom_fee": bool(g["creator_fee_configurable"])}
    pc = pump_coin_quote(quote_mint, g)
    if pc is None:
        raise RuntimeError("pump.fun does not accept this asset as a pair (not in Global, quote-control, nor a graduated pump coin)")
    return {"mint": quote_mint, "program": info["program"], "decimals": info["decimals"], "via": "pumpcoin",
            "ivq": pc["ivq"], "custom_fee": bool(g["creator_fee_configurable"]), "extras": pc["extras"], "pool": pc["pool"]}


def pump_coin_quote(quote_mint: str, g: dict | None = None) -> dict | None:
    """Any pump.fun coin can be a quote asset (seen on chain 2026-10-24, create_v2 with eight remaining
    accounts: the four quote-control ones, then the quote coin's own bonding curve, its canonical PumpSwap pool and
    the pool's base and quote token accounts, all read-only). The curve's starting quote reserve is the SOL curve's
    30 SOL priced through that pool: ivq = initial_virtual_sol_reserves * pool_base / (pool_quote + pool_virtual_quote)."""
    g = g or read_global()
    qm = Pubkey.from_string(quote_mint)
    curve = read_bonding_curve(quote_mint)
    if not curve:
        return None                                          # not a pump coin
    extras = [bonding_curve_pda(qm)]
    pool = None; base_bal = quote_bal = 0
    if curve.get("complete"):                                # graduated: the program prices through the PumpSwap pool
        pool_authority = eng.find_pda([b"pool-authority", bytes(qm)], PUMP)
        pool = eng.find_pda([b"pool", struct.pack("<H", 0), bytes(pool_authority), bytes(qm), bytes(eng.WSOL_MINT)], PAMM)
        acc = eng.rpc("getAccountInfo", [str(pool), {"encoding": "base64"}])["value"]
        if not acc:
            return None
        raw = base64.b64decode(acc["data"][0])
        o = 8 + 1 + 2 + 32 + 32 + 32 + 32                   # bump, index, creator, base_mint, quote_mint, lp_mint
        base_ta = Pubkey.from_bytes(raw[o:o + 32]); quote_ta = Pubkey.from_bytes(raw[o + 32:o + 64])
        # read as plain accounts: free RPCs refuse getTokenAccountBalance ("indexed requests") but serve account data
        bal = eng.rpc("getMultipleAccounts", [[str(base_ta), str(quote_ta)], {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]
        base_bal, quote_bal = (int(a["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for a in bal)
        vqr = int.from_bytes(raw[245:261], "little", signed=True)   # the pool's virtual quote reserve, part of its price
        extras += [pool, base_ta, quote_ta]
        ivq = g["initial_virtual_sol_reserves"] * base_bal // max(1, quote_bal + max(0, vqr))   # rough; the program decides
    else:                                                    # still on its curve: the program prices off that curve (verified in simulation 2026-10-24)
        ivq = g["initial_virtual_sol_reserves"] * curve["virtual_token_reserves"] // max(1, curve["virtual_quote_reserves"])
    try:                                                     # exact: let the program build a throwaway curve in simulation
        info = eng.mint_info(quote_mint)
        q = {"mint": quote_mint, "program": info["program"], "via": "pumpcoin", "custom_fee": False, "extras": extras}
        probe = Keypair(); payer = Pubkey.from_string(SIM_PAYER)
        ix = create_v2_ix(payer, probe.pubkey(), payer, "probe", "PRB", "https://pump.fun", q)
        bh, _ = eng.blockhash()
        tx = eng.partial_sign(_compile(payer, [ix], bh, 250_000, 0), [probe])
        res = eng.rpc("simulateTransaction", [base64.b64encode(bytes(tx)).decode(),
                      {"encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True, "commitment": "processed",
                       "accounts": {"encoding": "base64", "addresses": [str(bonding_curve_pda(probe.pubkey()))]}}])
        v = (res or {}).get("value") or {}
        acc = (v.get("accounts") or [None])[0]
        if v.get("err") is None and acc:
            ivq = struct.unpack_from("<Q", base64.b64decode(acc["data"][0]), 16)[0]
    except Exception:  # noqa: BLE001
        pass
    return {"ivq": ivq, "pool": str(pool) if pool else None, "pool_base": base_bal, "pool_quote": quote_bal, "extras": extras,
            "graduated": bool(curve.get("complete"))}


# ---------------------------------------------------------------- PDAs
def bonding_curve_pda(mint: Pubkey) -> Pubkey:
    return eng.find_pda([b"bonding-curve", bytes(mint)], PUMP)


def sharing_config_pda(mint: Pubkey) -> Pubkey:
    return eng.find_pda([b"sharing-config", bytes(mint)], PFEE)


def creator_vault_pda(owner: Pubkey) -> Pubkey:
    return eng.find_pda([b"creator-vault", bytes(owner)], PUMP)


def fee_vaults(mint: str, quote_mint: str, quote_program: str, creator: str | None = None) -> dict:
    """Where a coin's creator fees sit before distribution. `creator` defaults to the coin's sharing_config.
    SOL pair: lamports in the pump creator-vault PDA (curve) + WSOL in the PumpSwap creator-vault ATA (after graduation).
    Token pair: the quote token account of both."""
    m = Pubkey.from_string(mint)
    owner = Pubkey.from_string(creator) if creator else sharing_config_pda(m)
    q, qp = Pubkey.from_string(quote_mint), Pubkey.from_string(quote_program)
    cv = creator_vault_pda(owner)
    amm_auth = eng.find_pda([b"creator_vault", bytes(owner)], PAMM)
    sol = q == eng.WSOL_MINT
    return {"curve": str(cv) if sol else str(eng.ata(cv, q, qp)), "amm": str(eng.ata(amm_auth, q, qp)),
            "curve_kind": "lamports" if sol else "token"}


# ---------------------------------------------------------------- instructions
def create_v2_ix(user: Pubkey, mint: Pubkey, creator: Pubkey, name: str, symbol: str, uri: str,
                 quote: dict, creator_fee_bps: int = 0) -> Instruction:
    ins = _ins("create_v2")
    metas = resolve_accounts(ins, {"mint": mint, "user": user})
    data = (bytes(ins["discriminator"]) + _str(name) + _str(symbol) + _str(uri) + bytes(creator)
            + b"\x00"                                   # is_mayhem_mode = false
            + b"\x00"                                   # is_cashback_enabled (deprecated, must be false)
            + struct.pack("<Q", int(creator_fee_bps if quote["custom_fee"] else 0))
            + b"\x00")                                  # is_holder_reward = false (pump's own claim authority would pay)
    if quote["via"] != "sol":
        q, qp = Pubkey.from_string(quote["mint"]), Pubkey.from_string(quote["program"])
        metas += [AccountMeta(q, False, False), AccountMeta(eng.ata(bonding_curve_pda(mint), q, qp), False, True),
                  AccountMeta(qp, False, False), AccountMeta(QUOTE_CONTROL, False, False)]
        metas += [AccountMeta(x, False, False) for x in quote.get("extras") or []]   # pump-coin pair: its curve and pool
    return Instruction(PUMP, data, metas)


def fee_sharing_ixs(user: Pubkey, mint: Pubkey, shareholders: list[tuple[Pubkey, int]], quote: dict) -> list[Instruction]:
    """create_fee_sharing_config + update_fee_shares_v2 exactly as pump.fun's SDK builds them. `user` must be the
    bonding curve's creator (the create_v2 creator). Omitted optional accounts are the Pump Fees program id."""
    if not 1 <= len(shareholders) <= 10:
        raise RuntimeError("1 to 10 fee recipients")
    if sum(b for _, b in shareholders) != 10_000 or any(b <= 0 for _, b in shareholders):
        raise RuntimeError("fee shares must be above 0 and add up to 100%")
    if len({str(p) for p, _ in shareholders}) != len(shareholders):
        raise RuntimeError("the same wallet is listed twice")
    cfg = _ins("create_fee_sharing_config", "fees")
    ix_cfg = Instruction(PFEE, bytes(cfg["discriminator"]), resolve_accounts(
        cfg, {"payer": user, "mint": mint, "pool": PFEE, "pump_amm_program": PFEE, "pump_amm_event_authority": PFEE}, PFEE))
    q, qp = Pubkey.from_string(quote["mint"]), Pubkey.from_string(quote["program"])
    pre = []
    if q != eng.WSOL_MINT:
        # token pair: update_fee_shares_v2 CPIs distribute_creator_fees_v2, which needs the new vault's quote
        # account to exist (simulated 2026-09-15: InvalidAccountData without it, success with it)
        pre = [eng.ata_create_idempotent_ix(user, creator_vault_pda(sharing_config_pda(mint)), q, qp)]
    upd = _ins("update_fee_shares_v2", "fees")
    metas = resolve_accounts(upd, {"authority": user, "mint": mint, "quote_mint": q, "token_program": qp}, PFEE)
    metas.append(AccountMeta(user, False, True))                         # current shareholders: [(creator, 100%)]
    if q != eng.WSOL_MINT:
        metas.append(AccountMeta(eng.ata(user, q, qp), False, True))
    data = bytes(upd["discriminator"]) + struct.pack("<I", len(shareholders))
    for pk, bps in shareholders:
        data += bytes(pk) + struct.pack("<H", bps)
    return [ix_cfg] + pre + [Instruction(PFEE, data, metas)]


def expected_tokens(quote_in: int, ivq: int, g: dict) -> int:
    """Tokens out of a fresh curve for `quote_in` raw quote units, after protocol + creator fee (schedule rate)."""
    net = quote_in * (10_000 - g["fee_basis_points"] - g["creator_fee_basis_points"]) // 10_000
    vt = g["initial_virtual_token_reserves"]
    out = vt - (vt * ivq) // (ivq + net)
    return max(0, min(out, g["initial_real_token_reserves"]))


def _buy_ctx(user: Pubkey, mint: Pubkey, quote: dict, fee_owner: Pubkey) -> dict:
    g = read_global()
    q, qp = Pubkey.from_string(quote["mint"]), Pubkey.from_string(quote["program"])
    return {"user": user, "base_mint": mint, "quote_mint": q, "base_token_program": eng.TOKEN_2022, "quote_token_program": qp,
            "fee_recipient": Pubkey.from_string(g["fee_recipient"]), "buyback_fee_recipient": Pubkey.from_string(g["buyback_fee_recipients"][0]),
            "associated_base_user": eng.ata(user, mint, eng.TOKEN_2022), "associated_quote_user": eng.ata(user, q, qp),
            "bonding_curve.creator": fee_owner}


def buy_ixs(user: Pubkey, mint: Pubkey, quote: dict, fee_owner: Pubkey, quote_in: int, slippage_bps: int = 500) -> tuple[list[Instruction], int]:
    """First buy right after create. SOL pair: buy_v2(amount, max_sol_cost) with native SOL.
    Token pair: buy_exact_quote_in_v2(spendable_quote_in, min_tokens_out) from the user's quote token account.
    `fee_owner` is the curve's creator at buy time (the sharing_config once fee sharing is set)."""
    g = read_global()
    tokens = expected_tokens(quote_in, quote["ivq"], g)
    ixs = [eng.ata_create_idempotent_ix(user, user, mint, eng.TOKEN_2022)]
    ctx = _buy_ctx(user, mint, quote, fee_owner)
    if quote["via"] == "sol":
        ins = _ins("buy_v2")
        data = bytes(ins["discriminator"]) + struct.pack("<QQ", tokens, quote_in * (10_000 + slippage_bps) // 10_000)
    else:
        ins = _ins("buy_exact_quote_in_v2")
        data = bytes(ins["discriminator"]) + struct.pack("<QQ", quote_in, tokens * (10_000 - slippage_bps) // 10_000)
    ixs.append(Instruction(PUMP, data, resolve_accounts(ins, ctx)))
    return ixs, tokens


SWEEP_CREATOR_FEE = bytes([32, 246, 191, 52, 8, 201, 73, 186])     # pump `sweep_creator_fee` (pump-sdk 4.3.1, 2026-10-29)


def sweep_creator_fee_ix(payer: Pubkey, mint: Pubkey, creator: Pubkey, quote_mint: Pubkey = None,
                         quote_program: Pubkey = None) -> Instruction:
    """Moves the creator fees that v3 trades leave on the curve (BondingCurve.creator_fee) into the creator vault of the
    curve's creator. Since pump.fun's October 2026 upgrade, distribute_creator_fees(_v2), fee-sharing changes and CTOs
    fail with 6095 CreatorFeesNotSwept while that bucket is not empty, so it goes first in the same transaction.
    Permissionless, harmless when the bucket is empty. Account order from the program's IDL in pump-sdk 4.3.1."""
    q = quote_mint or eng.WSOL_MINT
    qp = quote_program or eng.TOKEN_LEGACY
    bc = bonding_curve_pda(mint)
    vault = creator_vault_pda(creator)
    metas = [AccountMeta(payer, True, True), AccountMeta(eng.find_pda([b"global"], PUMP), False, False), AccountMeta(mint, False, False),
             AccountMeta(q, False, False), AccountMeta(qp, False, False), AccountMeta(eng.ATA_PROGRAM, False, False),
             AccountMeta(eng.SYS_PROGRAM, False, False), AccountMeta(bc, False, True), AccountMeta(eng.ata(bc, q, qp), False, True),
             AccountMeta(vault, False, True), AccountMeta(eng.ata(vault, q, qp), False, True),
             AccountMeta(eng.find_pda([b"__event_authority"], PUMP), False, False), AccountMeta(PUMP, False, False)]
    return Instruction(PUMP, SWEEP_CREATOR_FEE, metas)


def distribute_ixs(payer: Pubkey, mint: Pubkey, shareholders: list[Pubkey], quote_mint: Pubkey, quote_program: Pubkey,
                   graduated_side: bool = False) -> list[Instruction]:
    """Permissionless payout of a shared coin's vault to its on-chain shareholders, in the coin's quote asset.
    graduated_side=True first sweeps PumpSwap's creator vault into the pump vault (transfer_creator_fees_to_pump_v2)."""
    sc = sharing_config_pda(mint)
    out = [sweep_creator_fee_ix(payer, mint, sc, quote_mint, quote_program)]
    if graduated_side:
        t = _ins("transfer_creator_fees_to_pump_v2", "amm")
        out.append(Instruction(PAMM, bytes(t["discriminator"]), resolve_accounts(
            t, {"payer": payer, "quote_mint": quote_mint, "token_program": quote_program, "coin_creator": sc}, PAMM)))
    ins = _ins("distribute_creator_fees_v2")
    metas = resolve_accounts(ins, {"payer": payer, "mint": mint, "sharing_config": sc, "quote_mint": quote_mint,
                                   "quote_token_program": quote_program, "bonding_curve.creator": sc})
    metas += [AccountMeta(pk, False, True) for pk in shareholders]
    if quote_mint != eng.WSOL_MINT:
        metas += [AccountMeta(eng.ata(pk, quote_mint, quote_program), False, True) for pk in shareholders]
    out.append(Instruction(PUMP, bytes(ins["discriminator"]) + bytes([1 if quote_mint != eng.WSOL_MINT else 0]), metas))
    return out


# ---------------------------------------------------------------- reads
def read_bonding_curve(mint: str) -> dict | None:
    bc = bonding_curve_pda(Pubkey.from_string(mint))
    v = (eng.rpc("getAccountInfo", [str(bc), {"encoding": "base64", "commitment": "confirmed"}]) or {}).get("value")
    if not v:
        return None
    raw = base64.b64decode(v["data"][0])
    o = 8
    vt, vq, rt, rq, supply = struct.unpack_from("<5Q", raw, o); o += 40
    complete = raw[o] == 1; o += 1
    creator = str(Pubkey.from_bytes(raw[o:o + 32])); o += 32
    out = {"bonding_curve": str(bc), "virtual_token_reserves": vt, "virtual_quote_reserves": vq, "real_token_reserves": rt,
           "real_quote_reserves": rq, "complete": complete, "creator": creator, "quote_mint": str(eng.WSOL_MINT), "creator_fee_bps": 0}
    if len(raw) >= o + 2 + 32:
        o += 2                                                  # is_mayhem_mode, is_cashback_coin
        qm = Pubkey.from_bytes(raw[o:o + 32]); o += 32
        if qm != Pubkey.default():
            out["quote_mint"] = str(qm)
        if len(raw) >= o + 8:
            out["creator_fee_bps"] = struct.unpack_from("<Q", raw, o)[0]
        o += 8 + 2                                              # creator_fee_bps, can_edit_creator_fee, is_holder_reward
        if len(raw) >= o + 8:                                   # creator fees of v3 trades still on the curve (BondingCurve.creator_fee)
            out["creator_fee_pending"] = struct.unpack_from("<Q", raw, o)[0]
    out.setdefault("creator_fee_pending", 0)
    return out


def read_sharing_config(mint: str) -> dict | None:
    sc = sharing_config_pda(Pubkey.from_string(mint))
    v = (eng.rpc("getAccountInfo", [str(sc), {"encoding": "base64", "commitment": "confirmed"}]) or {}).get("value")
    if not v or v.get("owner") != str(PFEE):
        return None
    raw = base64.b64decode(v["data"][0])
    o = 8 + 3
    cfg_mint = str(Pubkey.from_bytes(raw[o:o + 32])); o += 32
    admin = str(Pubkey.from_bytes(raw[o:o + 32])); o += 32
    revoked = raw[o] == 1; o += 1
    n = struct.unpack_from("<I", raw, o)[0]; o += 4
    sh = []
    for _ in range(min(n, 10)):
        sh.append({"address": str(Pubkey.from_bytes(raw[o:o + 32])), "bps": struct.unpack_from("<H", raw, o + 32)[0]})
        o += 34
    return {"address": str(sc), "mint": cfg_mint, "admin": admin, "admin_revoked": revoked, "shareholders": sh}


# ---------------------------------------------------------------- transaction assembly
_alt: dict = {}


def load_alt() -> AddressLookupTableAccount:
    if _alt.get("at", 0) > time.time() - 3600:
        return _alt["alt"]
    raw = base64.b64decode(eng.rpc("getAccountInfo", [str(PUMP_ALT), {"encoding": "base64"}])["value"]["data"][0])
    addrs = [Pubkey.from_bytes(raw[56 + i * 32:56 + (i + 1) * 32]) for i in range((len(raw) - 56) // 32)]
    _alt.update({"alt": AddressLookupTableAccount(key=PUMP_ALT, addresses=addrs), "at": time.time()})
    return _alt["alt"]


def _compile(payer: Pubkey, ixs: list[Instruction], bh: str, units: int, micro: int) -> MessageV0:
    return MessageV0.try_compile(payer, [set_compute_unit_limit(units), set_compute_unit_price(micro)] + ixs, [load_alt()], Hash.from_string(bh))


def prepare(user: str, name: str, symbol: str, uri: str, *, quote_mint: str | None = None, creator_fee_bps: int = 0,
            shareholders: list[tuple[str, int]] | None = None, first_buy: int = 0, swap_sol_for_buy: int = 0,
            mint: Keypair | None = None, priority_micro: int = 1_000_000, simulate: bool = True) -> dict:
    """Builds the launch as 1 to 4 transactions the wallet signs together (signAllTransactions) and sends in order:
      1. create_v2 (+ fee sharing + first buy when it all fits in one packet)
      2. fee sharing, when it did not fit
      3. Jupiter SOL -> quote swap, when the first buy is paid in SOL on a token pair
      4. first buy, when it did not fit
    shareholders None = no fee sharing (the launcher keeps the creator fee).
    first_buy: raw quote units (lamports on a SOL pair). swap_sol_for_buy: lamports to swap into the quote first.
    Every transaction is simulated in sequence where the chain allows (later ones depend on earlier ones)."""
    mint = mint or Keypair()
    u = Pubkey.from_string(user)
    m = mint.pubkey()
    quote = quote_spec(quote_mint)
    shares = [(Pubkey.from_string(a), int(b)) for a, b in (shareholders or [])]
    fee_owner = sharing_config_pda(m) if shares else u
    bh, lvbh = eng.blockhash()

    create = [create_v2_ix(u, m, u, name, symbol, uri, quote, creator_fee_bps)]
    sharing = fee_sharing_ixs(u, m, shares, quote) if shares else []
    swap_tx = None
    buy, tokens = [], 0
    if swap_sol_for_buy and quote["via"] != "sol":
        qd = eng.jup_quote(str(eng.WSOL_MINT), quote["mint"], swap_sol_for_buy, slippage_bps=300, exclude_dexes=eng.PROP_AMMS)
        first_buy = int(int(qd["otherAmountThreshold"]))                     # spend only what the swap guarantees
        swap_tx = eng.jup_swap_tx(qd, user)
    if first_buy > 0:
        buy, tokens = buy_ixs(u, m, quote, fee_owner, first_buy)

    # try the fewest transactions first; a SOL-funded buy on a token pair must come after the swap, so it stays separate
    if swap_tx is not None:
        plans = [[create + sharing, buy], [create, sharing, buy]]
    else:
        plans = [[create + sharing + buy], [create + sharing, buy], [create, sharing + buy], [create, sharing, buy]]
    txs, kinds = None, None
    for plan in plans:
        parts = [p for p in plan if p]
        built = []
        for ixs in parts:
            units = 250_000 + (150_000 if any(x.program_id == PFEE for x in ixs) else 0) + (250_000 if buy and buy[-1] in ixs else 0)
            built.append(eng.partial_sign(_compile(u, ixs, bh, units, priority_micro), [mint] if create[0] in ixs else []))
        if all(len(bytes(t)) <= MAX_TX_BYTES for t in built):
            txs = built
            kinds = ["+".join(k for k, part in (("create", create), ("sharing", sharing), ("buy", buy)) if part and part[-1] in ixs) for ixs in parts]
            break
    if txs is None:
        raise RuntimeError("the launch does not fit Solana's packet size even split in parts; shorten the name or ticker")
    if swap_tx is not None:                                   # order: create, (sharing), swap, buy
        txs.insert(len(txs) - 1, swap_tx)
        kinds.insert(len(kinds) - 1, "swap")
    sim = eng.simulate(txs[0]) if simulate else {"ok": True, "skipped": True}
    if not sim["ok"]:
        raise RuntimeError(f"simulation failed: {sim['err']} | {' / '.join((sim.get('logs') or [])[-4:])}")
    return {"mint": str(m), "mint_secret": base64.b64encode(bytes(mint)).decode(), "txs_b64": [base64.b64encode(bytes(t)).decode() for t in txs],
            "tx_bytes": [len(bytes(t)) for t in txs], "tx_kinds": kinds, "sim": sim, "last_valid_block_height": lvbh, "quote": quote,
            "sharing_config": str(sharing_config_pda(m)) if shares else None, "first_buy_tokens": tokens,
            "vaults": fee_vaults(str(m), quote["mint"], quote["program"], None if shares else user)}


# ---------------------------------------------------------------- trading on the curve
def curve_quote(curve: dict, quote_in: int = 0, tokens_in: int = 0) -> dict:
    """Price a buy (quote_in raw quote units) or a sell (tokens_in raw tokens) against a curve's live
    reserves. Fees are the protocol + creator rate from Global, the same rate the program charges."""
    g = read_global()
    fee = g["fee_basis_points"] + g["creator_fee_basis_points"] + (curve.get("creator_fee_bps") or 0)
    vt, vq = curve["virtual_token_reserves"], curve["virtual_quote_reserves"]
    if quote_in > 0:
        net = quote_in * (10_000 - fee) // 10_000
        out = vt - (vt * vq) // (vq + net) if vq + net else 0
        return {"side": "buy", "in": quote_in, "out": max(0, min(out, curve["real_token_reserves"])), "fee_bps": fee}
    gross = vq - (vq * vt) // (vt + tokens_in) if vt + tokens_in else 0
    return {"side": "sell", "in": tokens_in, "out": max(0, gross * (10_000 - fee) // 10_000), "fee_bps": fee}


def trade_ixs(user: Pubkey, mint: Pubkey, curve: dict, side: str, amount: int, slippage_bps: int = 300) -> tuple[list[Instruction], dict]:
    """buy_v2 / sell_v2 against a live bonding curve. `amount` is lamports in on a buy and raw tokens in on
    a sell; `curve` is read_bonding_curve()'s output, whose `creator` is the fee owner at trade time."""
    quote = quote_spec(curve.get("quote_mint"))
    ctx = _buy_ctx(user, mint, quote, Pubkey.from_string(curve["creator"]))
    q = curve_quote(curve, quote_in=amount if side == "buy" else 0, tokens_in=0 if side == "buy" else amount)
    if q["out"] <= 0:
        raise RuntimeError("the trade is too small to move the curve")
    if side == "buy":
        ins = _ins("buy_v2")
        data = bytes(ins["discriminator"]) + struct.pack("<QQ", q["out"], amount * (10_000 + slippage_bps) // 10_000)
        pre = [eng.ata_create_idempotent_ix(user, user, mint, eng.TOKEN_2022)]
    else:
        ins = _ins("sell_v2")
        data = bytes(ins["discriminator"]) + struct.pack("<QQ", amount, q["out"] * (10_000 - slippage_bps) // 10_000)
        pre = []
    return pre + [Instruction(PUMP, data, resolve_accounts(ins, ctx))], q


def buy_on_curve_ixs(user: Pubkey, mint: Pubkey, curve: dict, quote_in: int, slippage_bps: int = 500) -> tuple[list[Instruction], int]:
    """Spend `quote_in` raw quote units on a live curve, whatever the coin is paired with. SOL pair:
    buy_v2 as in trade_ixs. Token pair: buy_exact_quote_in_v2 from the user's quote token account, with
    the minimum out priced off the curve's live reserves (buy_ixs prices off a fresh curve, which only
    holds for the first buy). Returns (instructions, expected raw tokens)."""
    quote = quote_spec(curve.get("quote_mint"))
    if quote["via"] == "sol":
        ixs, q = trade_ixs(user, mint, curve, "buy", quote_in, slippage_bps)
        return ixs, q["out"]
    q = curve_quote(curve, quote_in=quote_in)
    if q["out"] <= 0:
        raise RuntimeError("the buy is too small to move the curve")
    ctx = _buy_ctx(user, mint, quote, Pubkey.from_string(curve["creator"]))
    ins = _ins("buy_exact_quote_in_v2")
    data = bytes(ins["discriminator"]) + struct.pack("<QQ", quote_in, q["out"] * (10_000 - slippage_bps) // 10_000)
    return [eng.ata_create_idempotent_ix(user, user, mint, eng.TOKEN_2022),
            Instruction(PUMP, data, resolve_accounts(ins, ctx))], q["out"]


def trade_tx(user: str, mint: str, side: str, amount: int, slippage_bps: int = 300, priority_micro: int = 400_000) -> dict:
    """One unsigned transaction for a trade on the curve, simulated before it is handed to the wallet."""
    u, m = Pubkey.from_string(user), Pubkey.from_string(mint)
    curve = read_bonding_curve(mint)
    if not curve:
        raise RuntimeError("this coin has no bonding curve")
    if curve["complete"]:
        raise RuntimeError("the curve has graduated; this coin trades in its pool")
    ixs, q = trade_ixs(u, m, curve, side, amount, slippage_bps)
    bh, lvbh = eng.blockhash()
    tx = eng.partial_sign(_compile(u, ixs, bh, 250_000, priority_micro), [])
    sim = eng.simulate(tx)
    if not sim["ok"]:
        raise RuntimeError(f"simulation failed: {sim['err']} | {' / '.join((sim.get('logs') or [])[-3:])}")
    return {"tx_b64": base64.b64encode(bytes(tx)).decode(), "expected_out": q["out"], "fee_bps": q["fee_bps"],
            "last_valid_block_height": lvbh}
