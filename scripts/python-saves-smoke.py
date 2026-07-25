"""Smoke: Python save slots write/load/clear on disk."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine-python"))

from if_engine.runtime import NovelRuntime  # noqa: E402


def main() -> int:
    src = ROOT / "projects" / "sample-project"
    bugs: list[str] = []
    with tempfile.TemporaryDirectory(prefix="if-py-saves-") as tmp:
        dest = Path(tmp) / "project"
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("saves", "*.bak"))
        rt = NovelRuntime(dest)
        rt.state["playerName"] = "PyTester"
        # Walk to look_around
        for i, c in enumerate(rt.visible_choices()):
            if "Look around" in (c.get("text") or ""):
                rt.choose(i)
                break
        else:
            bugs.append("Look around choice missing")

        save = rt.save_to_slot(3, label="py-smoke")
        path = dest / "saves" / "slot-3.json"
        if not path.is_file():
            bugs.append("slot-3.json not written")
        else:
            disk = json.loads(path.read_text(encoding="utf-8"))
            if disk.get("currentScene") != "look_around":
                bugs.append(f"bad scene on disk: {disk.get('currentScene')}")
            if disk.get("playerName") != "PyTester":
                bugs.append("bad name on disk")

        # Move elsewhere then load
        rt.state["playerName"] = "Other"
        rt.show(rt.project["start"])
        rt.load_from_slot(3)
        if rt.state["playerName"] != "PyTester":
            bugs.append("load did not restore name")
        if rt.state["currentScene"] != "look_around":
            bugs.append(f"load scene={rt.state['currentScene']}")

        slots = rt.list_save_slots()
        filled = [s for s in slots if not s.get("empty")]
        if len(filled) != 1 or filled[0]["slot"] != 3:
            bugs.append(f"list_slots unexpected: {slots}")

        # Export / import round-trip with label rename
        raw = rt.read_save_slot(3)
        if not raw or raw.get("label") != "py-smoke":
            bugs.append(f"read_save_slot label mismatch: {raw}")
        export_path = Path(tmp) / "exported-slot.json"
        export_path.write_text(json.dumps(raw, indent=2), encoding="utf-8")
        rt.clear_save_slot(3)
        if (dest / "saves" / "slot-3.json").is_file():
            bugs.append("clear did not delete file")

        imported = rt.import_save_slot(
            1, {**json.loads(export_path.read_text(encoding="utf-8")), "label": "imported-py"}
        )
        if imported.get("label") != "imported-py":
            bugs.append("import_save_slot lost label")
        if not (dest / "saves" / "slot-1.json").is_file():
            bugs.append("import did not write slot-1.json")
        listed = [s for s in rt.list_save_slots() if not s.get("empty")]
        if not any(s.get("slot") == 1 and s.get("label") == "imported-py" for s in listed):
            bugs.append(f"list after import unexpected: {listed}")

        print("save ok:", save.get("slot"), save.get("currentScene"))
        print("Python saves smoke bugs:", len(bugs))
        for b in bugs:
            print("-", b)
        return 1 if bugs else 0


if __name__ == "__main__":
    raise SystemExit(main())
