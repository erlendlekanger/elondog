"""Deploys the PVE site to Vercel with the payout desk's current tunnel address baked into api/_origin.py.
Run it after run.ps1 has started (the address is read from engine_run.log), and again after every restart of the desk.

    py usepve/tools/deploy.py              (add --no-engine to deploy only the static pages)

.vercel/project.json links this folder to the Vercel project "usepve", so the CLI never connects it to git
(a git-connected project would redeploy without the tunnel address on every push).
"""
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCOPE = "erlproja-projects"
if False:
    pass
elif "--no-engine" not in sys.argv:
    try:
        log = open(os.path.join(ROOT, "engine_run.log"), "rb").read().replace(b"\x00", b"")   # run.ps1 writes UTF-16
    except FileNotFoundError:
        sys.exit("No engine_run.log. Start the desk with run.ps1 first, or pass --no-engine.")
    urls = re.findall(rb"https://[a-z0-9-]+\.trycloudflare\.com", log)
    if not urls:
        sys.exit("No tunnel address in engine_run.log. Start the desk with run.ps1 first.")
    url = urls[-1].decode()
    try:
        urllib.request.urlopen(url + "/api/health", timeout=10).read()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"The desk's tunnel {url} does not answer ({e}). Is run.ps1 running?")
    with open(os.path.join(ROOT, "api", "_origin.py"), "w", encoding="utf-8") as f:
        f.write(f'ORIGIN = "{url}"\n')
    print("origin", url)
try:
    r = subprocess.run(f"npx vercel deploy --prod --yes --scope {SCOPE}", cwd=ROOT, shell=True)
finally:
    try:
        os.remove(os.path.join(ROOT, ".env.local"))
    except FileNotFoundError:
        pass
sys.exit(r.returncode)
