"""Hold: the site and its API in one process, next to the payout desk.

  py usehold/engine/server.py                    site + API on USEHOLD_PORT (8973)
  USEHOLD_DESK=1 py usehold/engine/server.py  ... with the payout desk (USEHOLD_DRY=0 to go live)

GET  /api/config  /api/coins  /api/coin?mint=  /api/wallet?address=  /api/proof?limit=&kind=  /img/<mint>  /meta/<mint>.json
POST /api/launch/prepare  /api/launch/send  /api/launch/status  /api/launch/confirm
"""
from __future__ import annotations

import glob
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import books  # noqa: E402
import desk  # noqa: E402
import launch  # noqa: E402
from op import chain as eng  # noqa: E402

WEB = ROOT.parent / "web"
PORT = int(os.environ.get("USEHOLD_PORT", "8973"))
DESK_ON = os.environ.get("USEHOLD_DESK", "").strip() == "1"
TUNNEL_ON = os.environ.get("USEHOLD_TUNNEL", "").strip() == "1"
_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def cached(key: str, ttl: float, fn):
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    try:
        v = fn()
    except Exception:  # noqa: BLE001
        with _cache_lock:
            hit = _cache.get(key)
        return hit[1] if hit else None
    with _cache_lock:
        _cache[key] = (time.time(), v)
    return v


def site_url() -> str:
    return (os.environ.get("USEHOLD_SITE_URL") or desk.CFG.get("site_url") or "").rstrip("/")


def sol_usd() -> float | None:
    return cached("solusd", 60, lambda: eng.prices_usd([desk.SOL]).get(desk.SOL))


def treasury_balance() -> int | None:
    t = desk.treasury_address()
    return cached("tbal", 20, lambda: int(round((eng.sol_balance(t) or 0) * 1e9))) if t else None


# ----------------------------------------------------------------------------- rows (call with books.LOCK held)
def asset_row(mint: str) -> dict:
    """Symbol, name and logo of what a coin is paired with or paid in (SOL, or a stock from the catalog)."""
    if not mint or mint == desk.SOL:
        return {"mint": desk.SOL, "symbol": "SOL", "name": "Solana", "logo": ""}
    a = launch.catalog().get(mint) or {}
    return {"mint": mint, "symbol": a.get("symbol") or mint[:4], "name": a.get("name") or "", "logo": a.get("logo") or ""}


def coin_row(c: dict, st: dict) -> dict:
    m = c["mint"]
    return {"pair": asset_row(c.get("pair")), "paid_in": asset_row((c.get("assets") or [desk.SOL])[0]),"mint": m, "name": c.get("name") or "", "symbol": c.get("symbol") or "", "image": f"/img/{m}",
            "description": c.get("description") or "", "launcher": c.get("launcher"), "created_at": c.get("created_at"),
            "mcap_lamports": int(c.get("mcap_lamports") or 0), "holders": c.get("holders") or 0,
            "avg_hold_s": int(c.get("avg_hold_s") or 0), "avg_mult": float(c.get("avg_mult") or 1.0),
            "collected": c.get("collected") or 0, "sent": c.get("sent") or 0, "waiting": books.waiting(m),
            "holders_paid": len(st["paid"].get(m) or {}), "last_payout_at": c.get("last_payout_at")}


PUBLIC_KINDS = {"launch", "pay", "collect", "split"}


def public_event(e: dict, st: dict) -> dict:
    e = {k: v for k, v in e.items() if k != "to" or isinstance(v, str)}
    for k in ("coin", "asset"):
        v = e.get(k)
        if isinstance(v, str) and v in st["coins"]:
            e[k + "_symbol"] = st["coins"][v].get("symbol") or v[:4]
    return e


def hold_curve() -> dict:
    return {"max": float(desk.CFG["hold_max"]), "tau_days": float(desk.CFG["hold_tau_days"])}


# ----------------------------------------------------------------------------- GET routes
def r_pairs(q, h):
    rows = cached("pairs", 3600, launch.launch_pairs) or [{"mint": desk.SOL, "symbol": "SOL", "name": "Solana", "logo": "", "via": "sol"}]
    return 200, {"ok": True, "pairs": [{k: r.get(k) for k in ("mint", "symbol", "name", "logo", "via")} for r in rows]}


def r_config(q, h):
    c = desk.CFG
    return 200, {"ok": True, "brand": c["brand"], "treasury": desk.treasury_address(), "interval_s": c["interval_s"],
                 "sample_s": c["sample_s"], "min_hold_pct": int(c["min_hold_bps"]) / 100, "site_url": site_url(),
                 "x_url": c.get("x_url") or "", "ca": c.get("ca") or "",
                 "launch_open": bool(c.get("launch_open", True)) and bool(desk.treasury_address()),
                 "max_first_buy_sol": c["max_first_buy_sol"], "hold": hold_curve(), "dry": desk.DRY, "desk_running": DESK_ON}


def r_coins(q, h):
    su = sol_usd()
    with books.LOCK:
        st = books.state()
        coins = [coin_row(c, st) for c in st["coins"].values() if c.get("status", "live") != "hidden"]
        ev = [public_event(e, st) for e in st["events"][::-1] if e["kind"] in PUBLIC_KINDS][:40]
        t = books.totals()
        last = st.get("last_tick")
    return 200, {"ok": True, "t": time.time(), "coins": coins, "events": ev, "totals": t, "sol_usd": su,
                 "last_tick": last, "interval_s": desk.CFG["interval_s"], "hold": hold_curve()}


def holder_rows(m: str, st: dict, limit: int = 100) -> list[dict]:
    """Every counted holder with what decides their share of the next split: coins x hold multiplier."""
    h = desk._held(m)
    last = h.get("last") or {}
    paid = st["paid"].get(m) or {}
    credit = st["credit"].get(m) or {}
    ages = h.get("age") or {}
    weight = {o: a * desk.multiplier(float(ages.get(o) or 0)) for o, a in last.items()}
    total = sum(weight.values()) or 1.0
    rows = []
    for o, amount in sorted(last.items(), key=lambda kv: -weight[kv[0]])[:limit]:
        age = float(ages.get(o) or 0)
        rows.append({"owner": o, "amount": amount, "age_s": int(age), "mult": round(desk.multiplier(age), 3),
                     "share": round(weight[o] / total, 6), "paid": int((paid.get(o) or {}).get("sol") or 0),
                     "owed": int(credit.get(o) or 0)})
    return rows


def r_coin(q, h):
    m = (q.get("mint", [""])[0] or "").strip()
    su = sol_usd()
    with books.LOCK:
        st = books.state()
        c = st["coins"].get(m)
        if not c:
            return 404, {"ok": False, "error": "this coin was not launched on Hold"}
        row = coin_row(c, st)
        row["supply"] = int(c.get("supply") or 0)
        top = holder_rows(m, st)
        ev = [public_event(e, st) for e in st["events"][::-1] if m == e.get("coin")][:80]
    return 200, {"ok": True, "coin": row, "holders": top, "events": ev, "sol_usd": su, "hold": hold_curve(),
                 "treasury": desk.treasury_address(), "interval_s": desk.CFG["interval_s"]}


def r_wallet(q, h):
    a = (q.get("address", [""])[0] or "").strip()
    with books.LOCK:
        st = books.state()
        rows = []
        for m, c in st["coins"].items():
            hd = desk._held(m)
            amount = int((hd.get("amt") or {}).get(a) or 0)
            paid = (st["paid"].get(m) or {}).get(a) or {}
            owed = int((st["credit"].get(m) or {}).get(a) or 0)
            age = float((hd.get("age") or {}).get(a) or 0)
            if not (amount or paid or owed):
                continue
            last = hd.get("last") or {}
            ages = hd.get("age") or {}
            tw = sum(v * desk.multiplier(float(ages.get(o) or 0)) for o, v in last.items()) or 0
            mine = int(last.get(a) or 0) * desk.multiplier(age)
            rows.append({"coin": m, "symbol": c.get("symbol"), "name": c.get("name"), "amount": amount,
                         "supply": int(c.get("supply") or 0), "counted": a in last, "age_s": int(age),
                         "mult": round(desk.multiplier(age), 3), "share": round(mine / tw, 6) if tw else 0,
                         "paid": int(paid.get("sol") or 0), "owed": owed})
    return 200, {"ok": True, "address": a, "coins": rows, "hold": hold_curve()}


def r_proof(q, h):
    with books.LOCK:
        st = books.state()
        limit = max(1, min(int(q.get("limit", ["80"])[0] or 80), 300))
        kind = q.get("kind", [""])[0] or ""
        ev = [public_event(e, st) for e in st["events"][::-1] if (not kind or e["kind"] == kind)][:limit]
        t = books.totals()
    return 200, {"ok": True, "events": ev, "totals": t, "treasury": desk.treasury_address(), "treasury_lamports": treasury_balance()}


GET = {"/api/pairs": r_pairs, "/api/config": r_config, "/api/coins": r_coins, "/api/coin": r_coin, "/api/wallet": r_wallet, "/api/proof": r_proof,
       "/api/health": lambda q, h: (200, {"ok": True, "t": int(time.time())})}
POST = {"/api/launch/prepare": lambda b, h: launch.prepare(b, site_url()),
        "/api/launch/send": lambda b, h: launch.send(b), "/api/launch/status": lambda b, h: launch.status(b),
        "/api/launch/confirm": lambda b, h: launch.confirm(b)}
PAGES = {"/": "index.html", "/launch": "launch.html", "/explore": "explore.html", "/c": "coin.html",
         "/how": "how.html", "/me": "me.html", "/proof": "proof.html"}


class Handler(BaseHTTPRequestHandler):
    server_version = "Hold"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj: dict):
        if code == 302:
            self.send_response(302)
            self.send_header("Location", obj["location"])
            if obj.get("cookie"):
                self.send_header("Set-Cookie", obj["cookie"])
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        # The Cloudflare tunnel swaps an origin's 502/503/504 for its own "error code: 502" page, so the page would
        # never see why (a launch rejected by Solana showed "the server did not answer"). Send those as 424: still a
        # failure, but the JSON with the reason reaches the browser.
        if code in (502, 503, 504):
            code = 424
        self._send(code, json.dumps(obj, separators=(",", ":")).encode(), "application/json", {"Cache-Control": "no-store"})

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        path = u.path.rstrip("/") or "/"
        q = urllib.parse.parse_qs(u.query)
        try:
            if path in GET:
                code, obj = GET[path](q, self)
                return self._json(code, obj)
            if path == "/api/ledger.jsonl":
                body = books.LEDGER_FILE.read_bytes() if books.LEDGER_FILE.exists() else b""
                return self._send(200, body, "application/x-ndjson; charset=utf-8",
                                  {"Cache-Control": "no-store", "Content-Disposition": "attachment; filename=usehold-ledger.jsonl"})
            if path.startswith("/meta/") and path.endswith(".json"):
                m = path[len("/meta/"):-len(".json")]
                f = launch.META / f"{m}.json"
                if len(m) <= 44 and m.isalnum() and f.exists():
                    return self._send(200, f.read_bytes(), "application/json",
                                      {"Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*"})
                return self._json(404, {"ok": False, "error": "unknown coin"})
            if path.startswith("/img/"):
                m = path[5:]
                if m.isalnum():
                    for ext in ("png", "jpeg", "gif", "webp"):
                        f = books.IMAGES / f"{m}.{ext}"
                        if f.exists():
                            return self._send(200, f.read_bytes(), f"image/{ext}",
                                              {"Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*"})
                self.send_response(302)
                self.send_header("Location", f"https://axiomtrading.sfo3.cdn.digitaloceanspaces.com/{m}.webp")
                self.end_headers()
                return
            if path.startswith("/api/"):
                return self._json(404, {"ok": False, "error": "unknown route"})
            f = WEB / PAGES[path] if path in PAGES else (WEB / path.lstrip("/")).resolve()
            if path not in PAGES and (WEB.resolve() not in f.parents or not f.is_file()):
                f = WEB / "404.html"
                code = 404
            else:
                code = 200
            ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            cache = "no-store" if f.suffix in (".html", ".js", ".css", ".json") else "public, max-age=3600"
            return self._send(code, f.read_bytes() if f.exists() else b"not found", ctype, {"Cache-Control": cache})
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return self._json(500, {"ok": False, "error": "server error"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        n = int(self.headers.get("Content-Length") or 0)
        if n > 8_000_000:
            return self._json(413, {"ok": False, "error": "too large"})
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:  # noqa: BLE001
            return self._json(400, {"ok": False, "error": "bad json"})
        fn = POST.get(path)
        if not fn:
            return self._json(404, {"ok": False, "error": "unknown route"})
        try:
            code, obj = fn(body, self)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            code, obj = 500, {"ok": False, "error": "Something went wrong on our side. Try again in a minute."}
        return self._json(code, obj)


# ----------------------------------------------------------------------------- public tunnel (for the Vercel site)
_tunnel = {"url": None, "proc": None}


def find_cloudflared():
    hit = os.environ.get("CLOUDFLARED") or shutil.which("cloudflared")
    if hit:
        return hit
    found = glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared*\cloudflared.exe"))
    return found[0] if found else None


def tunnel_thread(exe: str, port: int):
    """A Cloudflare quick tunnel to this port. tools/deploy.py bakes its address into the Vercel site."""
    if os.name == "nt":                                           # old tunnels for this port, left by a crash
        ps = ("Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | "
              f"Where-Object {{ $_.CommandLine -like '*127.0.0.1:{port}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}")
        try:
            subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=30,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:  # noqa: BLE001
            pass
    while True:
        try:
            proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                    errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            _tunnel["proc"] = proc
            for line in proc.stdout:
                m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                if m and m.group(0) != _tunnel["url"]:
                    _tunnel["url"] = m.group(0)
                    print(f"public address {_tunnel['url']} (run py usehold/tools/deploy.py to point the site at it)", flush=True)
            proc.wait()
        except Exception as e:  # noqa: BLE001
            print(f"tunnel: {e}", flush=True)
        _tunnel["url"] = None
        time.sleep(5)


def main():
    threading.Thread(target=lambda: cached("pairs", 3600, launch.launch_pairs), name="warm-pairs", daemon=True).start()
    if DESK_ON:
        threading.Thread(target=desk.loop, name="desk", daemon=True).start()
    if TUNNEL_ON:
        exe = find_cloudflared()
        if exe:
            threading.Thread(target=tunnel_thread, args=(exe, PORT), daemon=True, name="tunnel").start()
        else:
            print("cloudflared not found: the public site cannot reach this machine", flush=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"{desk.CFG['brand']} on http://localhost:{PORT} | {'desk on' if DESK_ON else 'desk off'} | "
          f"{'DRY' if desk.DRY else 'LIVE'} | payout wallet {desk.treasury_address() or '(none)'}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
