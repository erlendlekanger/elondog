"""The payout wallet: every coin launched here sends 100 percent of its creator fees to it, and the desk pays out of it.

  py trypair/tools/wallet.py     prints the address; creates ~/trypair_key.txt (base58) the first time, never overwrites
The public address is written to engine/config.json ("treasury") so the site can show it and the launch can route to it.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from solders.keypair import Keypair

KEY = Path(os.path.expanduser(os.environ.get("TRYPAIR_KEY_FILE", "~/trypair_key.txt")))
CFG = Path(__file__).resolve().parents[1] / "engine" / "config.json"


def main() -> None:
    if KEY.exists():
        raw = KEY.read_text(encoding="utf-8-sig").strip().splitlines()[0].strip()
        kp = Keypair.from_bytes(bytes(json.loads(raw))) if raw.startswith("[") else Keypair.from_base58_string(raw)
        made = False
    else:
        kp = Keypair()
        fd = os.open(str(KEY), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(str(kp) + "\n")
        made = True
    addr = str(kp.pubkey())
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    if cfg.get("treasury") != addr:
        cfg["treasury"] = addr
        CFG.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    print(("created " if made else "") + f"payout wallet {addr} (key in {KEY})")


if __name__ == "__main__":
    main()
