"""Smoke: Python runtime rollback + skip-if-read."""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

studio = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(studio / "engine-python"))

from if_engine.runtime import NovelRuntime  # noqa: E402


def main() -> int:
    bugs: list[str] = []
    src = studio / "projects" / "sample-project"
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "project"
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("saves", "__pycache__"))

        rt = NovelRuntime(dest)
        rt.state["playerName"] = "Skipper"
        start = rt.state["currentScene"]
        if start != "start":
            bugs.append(f"expected start, got {start}")

        if rt.can_rollback():
            bugs.append("can_rollback true on first scene")

        rt.choose_by_text("Step into the workshop")
        if rt.state["currentScene"] != "workshop":
            bugs.append(f"after workshop: {rt.state['currentScene']}")

        rt.rollback()
        if rt.state["currentScene"] != "start":
            bugs.append(f"rollback target {rt.state['currentScene']}")
        if len(rt.state["history"]) != 1:
            bugs.append(f"history len after rollback {len(rt.state['history'])}")

        # Walk a short remembered path
        rt.choose_by_text("Step into the workshop")
        rt.choose_by_text("Read the notes on the wall")
        mid = rt.state["currentScene"]
        rt.rollback()
        rt.rollback()
        if rt.state["currentScene"] != "start":
            bugs.append("double rollback failed")

        # Skip should replay remembered choices through seen scenes
        hops = 0
        while True:
            nxt = rt.skip_if_read()
            if nxt is None:
                break
            hops += 1
            if hops > 20:
                bugs.append("skip loop runaway")
                break
        if hops < 1:
            bugs.append("skip_if_read did not advance any seen scenes")
        if rt.state["currentScene"] == "start":
            bugs.append("still on start after skip")
        print("skip hops:", hops, "landed:", rt.state["currentScene"], "mid was:", mid)

        before = len(rt.state["history"])
        rt.show(rt.state["currentScene"], record_history=False)
        if len(rt.state["history"]) != before:
            bugs.append("record_history=False still grew history")

        print("Python rollback smoke bugs:", len(bugs))
        for b in bugs:
            print("-", b)
        return 1 if bugs else 0


if __name__ == "__main__":
    raise SystemExit(main())
