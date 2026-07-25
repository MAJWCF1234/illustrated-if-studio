"""Disk save slots (1–5) — format matches studio /api/saves JSON."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_SLOTS = 5


def saves_dir(project_dir: Path) -> Path:
    """Writable saves folder. Frozen exe uses beside the .exe (not _MEIPASS)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "saves"
    return Path(project_dir) / "saves"


def list_slots(project_dir: Path) -> list[dict[str, Any]]:
    root = saves_dir(project_dir)
    root.mkdir(parents=True, exist_ok=True)
    out: list[dict[str, Any]] = []
    for i in range(1, MAX_SLOTS + 1):
        path = root / f"slot-{i}.json"
        if not path.is_file():
            out.append({"slot": i, "empty": True})
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            out.append(
                {
                    "slot": i,
                    "empty": False,
                    "playerName": data.get("playerName") or "",
                    "currentScene": data.get("currentScene") or "",
                    "updatedAt": data.get("updatedAt"),
                    "label": data.get("label"),
                }
            )
        except Exception:
            out.append({"slot": i, "empty": False, "corrupt": True})
    return out


def read_slot(project_dir: Path, slot: int) -> dict[str, Any] | None:
    if slot < 1 or slot > MAX_SLOTS:
        raise ValueError("slot must be 1–5")
    path = saves_dir(project_dir) / f"slot-{slot}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_slot(project_dir: Path, slot: int, state: dict[str, Any], *, label: str | None = None) -> dict[str, Any]:
    if slot < 1 or slot > MAX_SLOTS:
        raise ValueError("slot must be 1–5")
    save = {
        "formatVersion": 1,
        "slot": slot,
        "label": label or f"Slot {slot}",
        "playerName": str(state.get("playerName") or ""),
        "currentScene": str(state.get("currentScene") or "start"),
        "abilities": list(state.get("abilities") or []),
        "vars": dict(state.get("vars") or {}),
        "history": list(state.get("history") or []),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    root = saves_dir(project_dir)
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"slot-{slot}.json"
    path.write_text(json.dumps(save, indent=2), encoding="utf-8")
    return save


def delete_slot(project_dir: Path, slot: int) -> None:
    if slot < 1 or slot > MAX_SLOTS:
        raise ValueError("slot must be 1–5")
    path = saves_dir(project_dir) / f"slot-{slot}.json"
    if path.is_file():
        path.unlink()


def apply_slot(state: dict[str, Any], save: dict[str, Any]) -> None:
    state["playerName"] = save.get("playerName") or ""
    state["currentScene"] = save.get("currentScene") or "start"
    state["abilities"] = list(save.get("abilities") or [])
    state["vars"] = dict(save.get("vars") or {})
    state["history"] = list(save.get("history") or [])
