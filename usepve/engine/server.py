"""The pair desk's site and API in one process, next to the payout desk.

  py engine/server.py                    site + API on USEPVE_PORT (8977)
  USEPVE_DESK=1 py engine/server.py     ... with the pair desk (USEPVE_DRY=0 to go live)

GET  /api/config  /api/roots  /api/root?mint=  /api/pair?mint=  /api/wallet?address=  /api/proof  /img/<mint>  /meta/<mint>.json
POST /api/launch/root/prepare  /api/launch/pair/prepare  /api/launch/send  /api/launch/status
     /api/launch/root/confirm  /api/launch/pair/confirm
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
import pairs  # noqa: E402
from op import chain as eng  # noqa: E402

WEB = ROOT.parent / "web"
PORT = int(os.environ.get("USEPVE_PORT", "8977"))
DESK_ON = os.environ.get("USEPVE_DESK", "").strip() == "1"
TUNNEL_ON = os.environ.get("USEPVE_TUNNEL", "").strip() == "1"
CFG = desk.CFG
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
    return (os.environ.get("USEPVE_SITE_URL") or CFG.get("site_url") or "").rstrip("/")


def sol_usd() -> float | None:
    return cached("solusd", 60, lambda: eng.prices_usd([desk.SOL]).get(desk.SOL))


def treasury_balance() -> int | None:
    t = desk.treasury_address()
    return cached("tbal", 20, lambda: int(round((eng.sol_balance(t) or 0) * 1e9))) if t else None


# ----------------------------------------------------------------------------- rows (call with books.LOCK held)
def weights(root: str) -> dict[str, float]:
    """Each pair's share of the next split, from the weight counted since the last one."""
    h = desk._held(root)
    w = {p: v for p, v in h["w"].items() if v > 0} or {p: float(a) for p, a in (h.get("last") or {}).items()}
    tot = sum(w.values())
    return {p: v / tot for p, v in w.items()} if tot else {}


def root_row(c: dict, st: dict) -> dict:
    m = c["mint"]
    return {"mint": m, "name": c.get("name") or "", "symbol": c.get("symbol") or "", "image": f"/img/{m}",
            "description": c.get("description") or "", "launcher": c.get("launcher"), "created_at": c.get("created_at"),
            "mcap_lamports": int(c.get("mcap_lamports") or 0), "pairs": int(c.get("pairs") or 0),
            "pairs_counted": int(c.get("pairs_counted") or 0), "locked_lamports": int(c.get("locked_lamports") or 0),
            "locked_pct": float(c.get("locked_pct") or 0), "pairs_bps": int(c.get("pairs_bps") or 10_000),
            "collected": int(c.get("collected") or 0), "sent": int(c.get("sent") or 0), "waiting": books.waiting(m),
            "builders_paid": len(st["paid"].get(m) or {}), "last_payout_at": c.get("last_payout_at"),
            "floor_lamports": int(CFG["min_lock_lamports"])}


def pair_row(root: str, p: dict, st: dict, share: dict[str, float]) -> dict:
    rc = st["coins"].get(root) or {}
    m = p["mint"]
    return {"mint": m, "name": p.get("name") or "", "symbol": p.get("symbol") or "", "image": f"/img/{m}",
            "creator": p.get("creator"), "locked": int(p.get("locked") or 0), "locked_lamports": int(p.get("locked_lamports") or 0),
            "counted": bool(p.get("counted")), "complete": bool(p.get("complete")), "fee_bps": p.get("fee_bps"),
            "age_s": int(p.get("age_s") or 0), "mult": float(p.get("mult") or 1.0), "share": round(share.get(m, 0.0), 6),
            "earned": int((st["pair_earned"].get(root) or {}).get(m) or 0), "launched_here": bool(p.get("launched_here")),
            "mcap_lamports": int(p.get("mcap_lamports") or 0), "created_at": p.get("created_at") or p.get("first_seen"),
            "root": root, "root_symbol": rc.get("symbol") or "", "root_name": rc.get("name") or ""}


def all_pair_rows(st: dict) -> list[dict]:
    out = []
    for r in pairs.root_mints():
        if r not in st["coins"]:
            continue
        share = weights(r)
        out += [pair_row(r, p, st, share) for p in (st["pairs"].get(r) or {}).values()]
    return out


PUBLIC_KINDS = {"launch", "pair", "pay", "collect", "split"}


def public_event(e: dict, st: dict) -> dict:
    e = {k: v for k, v in e.items() if k != "to" or isinstance(v, str)}
    v = e.get("coin")
    if isinstance(v, str) and v in st["coins"]:
        e["coin_symbol"] = st["coins"][v].get("symbol") or v[:4]
    pm = e.get("pair")
    if isinstance(pm, str) and isinstance(v, str):
        e["pair_symbol"] = ((st["pairs"].get(v) or {}).get(pm) or {}).get("symbol") or pm[:4]
    return e


def lock_curve() -> dict:
    return {"max": float(CFG["hold_max"]), "tau_days": float(CFG["hold_tau_days"])}


# ----------------------------------------------------------------------------- GET routes
def r_config(q, h):
    ok_root, why_root = launch.root_open()
    roots = pairs.root_mints()
    return 200, {"ok": True, "brand": CFG["brand"], "treasury": desk.treasury_address(), "interval_s": CFG["interval_s"],
                 "sample_s": CFG["sample_s"], "site_url": site_url(), "x_url": CFG.get("x_url") or "", "ca": CFG.get("ca") or (roots[0] if CFG.get("single_root") and roots else ""),
                 "single_root": bool(CFG.get("single_root")), "root": roots[0] if CFG.get("single_root") and roots else "",
                 "owner": CFG.get("owner") or "", "root_open": ok_root, "root_closed_why": why_root,
                 "launch_open": bool(CFG.get("launch_open", True)) and bool(desk.treasury_address()),
                 "max_first_buy_sol": CFG["max_first_buy_sol"], "lock": lock_curve(), "min_lock_lamports": int(CFG["min_lock_lamports"]),
                 "pair_fee_bps_default": int(CFG["pair_fee_bps_default"]), "pair_fee_bps_max": int(CFG["pair_fee_bps_max"]),
                 "root_pairs_bps_min": int(CFG["root_pairs_bps_min"]), "root_pairs_bps_default": int(CFG["root_pairs_bps_default"]),
                 "dry": desk.DRY, "desk_running": DESK_ON}


def r_roots(q, h):
    su = sol_usd()
    with books.LOCK:
        st = books.state()
        roots = [root_row(c, st) for m, c in st["coins"].items() if m in pairs.root_mints() and c.get("status", "live") != "hidden"]
        prs = sorted(all_pair_rows(st), key=lambda r: -r["locked_lamports"])[:60]
        ev = [public_event(e, st) for e in st["events"][::-1] if e["kind"] in PUBLIC_KINDS][:40]
        t = books.totals()
        t["pairs"] = sum(len(v) for k, v in st["pairs"].items() if k in st["coins"])
        last = st.get("last_tick")
    return 200, {"ok": True, "t": time.time(), "roots": roots, "pairs": prs, "events": ev, "totals": t, "sol_usd": su,
                 "last_tick": last, "interval_s": CFG["interval_s"], "lock": lock_curve()}


def r_root(q, h):
    m = (q.get("mint", [""])[0] or "").strip()
    with books.LOCK:
        st = books.state()
        if not m and CFG.get("single_root"):
            m = (pairs.root_mints() or [""])[0]
        c = st["coins"].get(m)
        if not c:
            if CFG.get("single_root") and not pairs.root_mints():
                return 404, {"ok": False, "error": f"{CFG['brand']} has not launched yet", "prelaunch": True}
            return 404, {"ok": False, "error": f"this coin is not a root on {CFG['brand']}"}
        row = root_row(c, st)
        row["supply"] = int(c.get("supply") or 0)
        share = weights(m)
        prs = sorted((pair_row(m, p, st, share) for p in (st["pairs"].get(m) or {}).values()),
                     key=lambda r: (-r["share"], -r["locked_lamports"]))
        ev = [public_event(e, st) for e in st["events"][::-1] if m == e.get("coin")][:80]
    return 200, {"ok": True, "root": row, "pairs": prs, "events": ev, "sol_usd": sol_usd(), "lock": lock_curve(),
                 "treasury": desk.treasury_address(), "interval_s": CFG["interval_s"], "last_tick": st.get("last_tick")}


def r_pair(q, h):
    m = (q.get("mint", [""])[0] or "").strip()
    with books.LOCK:
        st = books.state()
        for r in pairs.root_mints():
            p = (st["pairs"].get(r) or {}).get(m)
            if p and r in st["coins"]:
                row = pair_row(r, p, st, weights(r))
                row["description"] = p.get("description") or ""
                ev = [public_event(e, st) for e in st["events"][::-1] if e.get("pair") == m or (e.get("coin") == r and e.get("kind") == "split")][:40]
                return 200, {"ok": True, "pair": row, "root": root_row(st["coins"][r], st), "events": ev, "sol_usd": sol_usd(), "lock": lock_curve()}
    return 404, {"ok": False, "error": f"this coin is not a pair on {CFG['brand']} (yet: new pairs show up within a minute)"}


def r_wallet(q, h):
    a = (q.get("address", [""])[0] or "").strip()
    with books.LOCK:
        st = books.state()
        rows = []
        for r in pairs.root_mints():
            c = st["coins"].get(r)
            if not c:
                continue
            share = weights(r)
            mine = [pair_row(r, p, st, share) for p in (st["pairs"].get(r) or {}).values() if p.get("creator") == a]
            paid = (st["paid"].get(r) or {}).get(a) or {}
            owed = int((st["credit"].get(r) or {}).get(a) or 0)
            if not (mine or paid or owed):
                continue
            rows.append({"root": r, "symbol": c.get("symbol"), "name": c.get("name"), "pairs": mine,
                         "share": round(sum(p["share"] for p in mine), 6), "paid": int(paid.get("sol") or 0), "owed": owed,
                         "earned": sum(p["earned"] for p in mine)})
    return 200, {"ok": True, "address": a, "roots": rows, "lock": lock_curve()}


def r_proof(q, h):
    with books.LOCK:
        st = books.state()
        limit = max(1, min(int(q.get("limit", ["80"])[0] or 80), 300))
        kind = q.get("kind", [""])[0] or ""
        ev = [public_event(e, st) for e in st["events"][::-1] if (not kind or e["kind"] == kind)][:limit]
        t = books.totals()
    return 200, {"ok": True, "events": ev, "totals": t, "treasury": desk.treasury_address(), "treasury_lamports": treasury_balance()}


GET = {"/api/config": r_config, "/api/roots": r_roots, "/api/root": r_root, "/api/pair": r_pair, "/api/wallet": r_wallet,
       "/api/proof": r_proof, "/api/health": lambda q, h: (200, {"ok": True, "t": int(time.time())})}
POST = {"/api/launch/root/prepare": lambda b, h: launch.prepare_root(b, site_url()),
        "/api/launch/pair/prepare": lambda b, h: launch.prepare_pair(b, site_url()),
        "/api/launch/send": lambda b, h: launch.send(b), "/api/launch/status": lambda b, h: launch.status(b),
        "/api/launch/root/confirm": lambda b, h: launch.confirm_root(b),
        "/api/launch/pair/confirm": lambda b, h: launch.confirm_pair(b)}
PAGES = {"/": "index.html", "/launch": "launch.html", "/explore": "explore.html", "/r": "root.html", "/p": "pair.html",
         "/how": "how.html", "/me": "me.html", "/proof": "proof.html"}


class Handler(BaseHTTPRequestHandler):
    server_version = "PVE"

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
                                  {"Cache-Control": "no-store", "Content-Disposition": "attachment; filename=ledger.jsonl"})
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
                    print(f"public address {_tunnel['url']} (run py usepve/tools/deploy.py to point the site at it)", flush=True)
            proc.wait()
        except Exception as e:  # noqa: BLE001
            print(f"tunnel: {e}", flush=True)
        _tunnel["url"] = None
        time.sleep(5)


def main():
    if DESK_ON:
        threading.Thread(target=pairs.loop, name="desk", daemon=True).start()
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
