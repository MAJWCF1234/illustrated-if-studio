"""Run the graphical player: python -m if_gui <project-dir>"""

from __future__ import annotations

import sys
from pathlib import Path

from . import main

if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("project")
    raise SystemExit(main(target))
