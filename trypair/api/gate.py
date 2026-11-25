"""On Vercel every /api, /source and /img request lands here (see vercel.json) and is forwarded to the payout desk on
the machine that runs it, through the Cloudflare tunnel whose address tools/deploy.py wrote into api/_origin.py.
The static pages are served by Vercel itself, so the site stays up when the desk is unreachable; the API then
answers 503 and the pages say the payout desk is not reachable.
"""
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

ALLOWED = ("api/", "source/", "img/", "meta/", "pfp/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects (Sign in with X, coin images) go back to the browser instead of being followed here."""
    def redirect_request(self, *a, **kw):
        return None


OPENER = urllib.request.build_opener(_NoRedirect)


def origin():
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        if here not in sys.path:
            sys.path.insert(0, here)
        from _origin import ORIGIN  # noqa: PLC0415
        return ORIGIN or None
    except Exception:  # noqa: BLE001
        return None


class handler(BaseHTTPRequestHandler):
    server_version = "trypair-edge"
    sys_version = ""

    def _forward(self, method):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query, keep_blank_values=True)
        path = (q.pop("p", [""])[0] or "").lstrip("/")
        if not path.startswith(ALLOWED) or ".." in path:
            return self._out(404, b'{"ok":false,"error":"not found"}', "no-store")
        rest = urllib.parse.urlencode({k: v for k, vs in q.items() for v in vs})
        body = None
        if method == "POST":
            n = int(self.headers.get("Content-Length", "0") or 0)
            if n > 8_000_000:
                return self._out(413, b'{"ok":false,"error":"too large"}', "no-store")
            body = self.rfile.read(n) if n else b""
        base = origin()
        if not base:
            return self._out(503, b'{"ok":false,"error":"Something went wrong. Try again in a minute."}', "no-store")
        fwd = {"User-Agent": "trypair-edge", "Content-Type": self.headers.get("Content-Type") or "application/json",
               "X-Forwarded-Host": self.headers.get("Host") or "", "X-Forwarded-Proto": "https",
               "X-Forwarded-For": self.headers.get("X-Forwarded-For") or self.headers.get("X-Real-Ip") or ""}
        if self.headers.get("Cookie"):
            fwd["Cookie"] = self.headers.get("Cookie")
        req = urllib.request.Request(f"{base}/{path}" + (f"?{rest}" if rest else ""), data=body, method=method, headers=fwd)
        extra = {}
        try:
            with OPENER.open(req, timeout=55) as r:
                data, code, ctype = r.read(), r.status, r.headers.get("Content-Type")
                disp = r.headers.get("Content-Disposition")
        except urllib.error.HTTPError as e:
            data, code, ctype, disp = e.read(), e.code, e.headers.get("Content-Type"), None
            if code in (301, 302, 303, 307, 308):
                extra = {k: e.headers.get(k) for k in ("Location", "Set-Cookie") if e.headers.get(k)}
        except Exception:  # noqa: BLE001
            return self._out(503, b'{"ok":false,"error":"Something went wrong. Try again in a minute."}', "no-store")
        # a coin's image and metadata never change: let Vercel's edge keep them, so pump.fun and wallets can read them
        # even while the payout desk is restarting
        cache = "public, max-age=31536000, s-maxage=31536000, immutable" if path.startswith(("img/", "meta/", "pfp/")) and code == 200 else "no-store"
        return self._out(code, data, cache, ctype, disp, extra)

    def _out(self, code, data, cache, ctype=None, disp=None, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype or "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if cache.startswith("public"):
            self.send_header("Access-Control-Allow-Origin", "*")
        if disp:
            self.send_header("Content-Disposition", disp)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")
