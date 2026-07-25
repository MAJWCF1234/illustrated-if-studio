"""CLI for headless play / smoke tests."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .runtime import NovelRuntime


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Illustrated IF Studio Python runtime (headless)")
    parser.add_argument("project", type=Path, help="Path to project folder")
    parser.add_argument(
        "--script",
        type=Path,
        help="JSON list of choice texts/indexes to auto-play",
    )
    parser.add_argument("--name", default="Traveler")
    args = parser.parse_args(argv)

    rt = NovelRuntime(args.project)
    rt.state["playerName"] = args.name

    if args.script:
        steps = json.loads(args.script.read_text(encoding="utf-8"))
        if isinstance(steps, dict):
            steps = steps.get("steps", [])
        for step in steps:
            if isinstance(step, int):
                rt.choose(step)
            else:
                rt.choose_by_text(step)
        print(
            json.dumps(
                {
                    "scene": rt.state["currentScene"],
                    "abilities": rt.state["abilities"],
                    "historyLength": len(rt.state["history"]),
                },
                indent=2,
            )
        )
        return 0

    # Interactive terminal loop
    print(f"{rt.project.get('title')} — headless Python runtime")
    print("Commands: number to choose, q to quit, a for abilities\n")
    while True:
        scene = rt.scenes[rt.state["currentScene"]]
        speaker = scene.get("speaker")
        if speaker:
            print(f"[{rt.interpolate(speaker)}]")
        print(rt.interpolate(scene.get("text", "")))
        print()
        choices = rt.visible_choices()
        if not choices:
            print("(end of path)")
            break
        for i, c in enumerate(choices, 1):
            print(f"  {i}. {c['text']}")
        raw = input("> ").strip().lower()
        if raw in {"q", "quit", "exit"}:
            break
        if raw in {"a", "abilities"}:
            print("Abilities:", ", ".join(rt.state["abilities"]) or "(none)")
            continue
        try:
            rt.choose(int(raw) - 1)
        except (ValueError, IndexError) as exc:
            print(f"Invalid: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
