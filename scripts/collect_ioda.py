from __future__ import annotations

import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from netguard.collector import run_collection


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        return run_collection()
    except Exception as exc:
        logging.error("Collector could not start: %s", type(exc).__name__)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
