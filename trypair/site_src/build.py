"""Wraps every page in src/pages/*.html with the shared head and scripts, into web/<name>.html (site_src stays out of the published folder).
    py site_src/build.py
A page file starts with front matter lines `title:`, `desc:` and optionally `body:` (attributes) and `scripts:`, then ---."""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
WEB = HERE.parent / "web"
SITE = json.loads((HERE / "site.json").read_text(encoding="utf-8"))
for f in sorted((HERE / "pages").glob("*.html")):
    raw = f.read_text(encoding="utf-8")
    head, body = raw.split("\n---\n", 1)
    meta = dict(re.findall(r"^(\w+):\s*(.*)$", head, re.M))
    title = meta.get("title", SITE["brand"])
    scripts = [s for s in (meta.get("scripts") or "").split() if s]
    out = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{meta.get('desc', SITE['desc'])}">
<meta name="theme-color" content="{SITE['theme']}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{meta.get('desc', SITE['desc'])}">
<meta property="og:image" content="{SITE['url']}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{SITE['fonts']}" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css?v={SITE['v']}">
</head>
<body{(' ' + meta['body']) if meta.get('body') else ''}>
{body.strip()}
<script src="/vendor/lenis.min.js"></script>
""" + "".join(f'<script src="{s}"></script>\n' for s in scripts if s.startswith("http")) + f"""<script src="/assets/site.js?v={SITE['v']}"></script>
<script src="/assets/core.js?v={SITE['v']}"></script>
""" + "".join(f'<script src="{s}?v={SITE["v"]}"></script>\n' for s in scripts if not s.startswith("http")) + "</body>\n</html>\n"
    (WEB / f.name).write_text(out, encoding="utf-8")
    print("built", f.name)
