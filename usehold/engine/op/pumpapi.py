"""pump.fun client for free, off-chain coin registration (mapped from pump.fun's own route definitions).

Nothing is sent to Solana. The coin is registered with pump.fun with `initialized: false`; the accounts on
chain are created by the first buyer, who pays the rent. Three calls, all keyless apart from the creator's
own signature:
  1. POST /auth/login/token    sign "Sign in to pump.fun: <ms>" with the creator key -> JWT
  2. POST /ipfs/token-metadata image + fields -> metadataUri
  3. POST /coins/create-v2     -> {"mint": "...pump"}  (pump.fun picks the mint address)"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid

import base58
from solders.keypair import Keypair

API = "https://frontend-api-v3.pump.fun"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


class PumpError(RuntimeError):
    pass


def _request(method: str, path: str, *, body: bytes | None = None, ctype: str | None = None, token: str | None = None, timeout: int = 60) -> dict:
    headers = {"User-Agent": UA, "Origin": "https://pump.fun", "Referer": "https://pump.fun/", "Accept": "application/json"}
    if ctype:
        headers["Content-Type"] = ctype
    if token:
        headers["Authorization"] = "Bearer " + token
        headers["Cookie"] = "auth_token=" + token
    req = urllib.request.Request(API + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise PumpError(f"{method} {path} -> {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from None


def _signed_body(kp: Keypair) -> bytes:
    ts = int(time.time() * 1000)
    sig = base58.b58encode(bytes(kp.sign_message(f"Sign in to pump.fun: {ts}".encode()))).decode()
    return json.dumps({"signature": sig, "timestamp": ts, "address": str(kp.pubkey()), "authType": "non_custodial"}).encode()


def login(kp: Keypair) -> str:
    """Signs in the creator. A wallet pump.fun has never seen answers 404 ACCOUNT_NOT_FOUND, so it is registered first
    (POST /auth/register with the same signed body, verified 2026-10-20) and the sign-in is repeated."""
    try:
        res = _request("POST", "/auth/login/token", body=_signed_body(kp), ctype="application/json")
    except PumpError as e:
        if "ACCOUNT_NOT_FOUND" not in str(e):
            raise
        _request("POST", "/auth/register", body=_signed_body(kp), ctype="application/json")
        res = _request("POST", "/auth/login/token", body=_signed_body(kp), ctype="application/json")
    tok = res.get("access_token")
    if not tok:
        raise PumpError(f"no access_token in the reply: {str(res)[:160]}")
    return tok


def _multipart(fields: dict, filename: str, ctype: str, data: bytes) -> tuple[str, bytes]:
    boundary = "----holdlonger" + uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return boundary, bytes(out)


def upload_metadata(token: str, name: str, symbol: str, description: str, image: bytes, image_type: str = "image/png",
                    twitter: str = "", telegram: str = "", website: str = "") -> dict:
    fields = {"name": name, "symbol": symbol, "description": description, "showName": "true"}
    for k, v in (("twitter", twitter), ("telegram", telegram), ("website", website)):
        if v:
            fields[k] = v
    boundary, body = _multipart(fields, "image." + image_type.split("/")[-1], image_type, image)
    res = _request("POST", "/ipfs/token-metadata", body=body, ctype=f"multipart/form-data; boundary={boundary}", token=token, timeout=120)
    if not res.get("metadataUri"):
        raise PumpError(f"no metadataUri: {str(res)[:160]}")
    return res


def create_coin(token: str, name: str, ticker: str, description: str, metadata_uri: str, image_uri: str = "",
                twitter: str = "", telegram: str = "", website: str = "") -> str:
    if not name.strip() or not ticker.strip():
        raise PumpError("name and ticker cannot be empty")
    body = {"name": name, "ticker": ticker, "description": description, "metadataUri": metadata_uri, "showName": True, "tokenProgram": TOKEN_2022}
    for k, v in (("image", image_uri), ("twitter", twitter), ("telegram", telegram), ("website", website)):
        if v:
            body[k] = v
    res = _request("POST", "/coins/create-v2", body=json.dumps(body).encode(), ctype="application/json", token=token)
    mint = res.get("mint")
    if not mint:
        raise PumpError(f"no mint in the reply: {str(res)[:160]}")
    return mint


def coin(mint: str) -> dict | None:
    """The coin as pump.fun lists it, or None while pump.fun has not indexed it."""
    try:
        return _request("GET", f"/coins-v2/{mint}")
    except PumpError as exc:
        if "404" in str(exc):
            return None
        raise
