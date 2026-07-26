"""
Illustrated IF Studio — Python runtime stub (headless + optional pygame UI later).
Run: python -m if_engine.cli ../projects/sample-project
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .saves import apply_slot, delete_slot, list_slots, read_slot, write_slot


def _as_number(value: Any) -> float | None:
    """Numeric value of a var, or None when it cannot be compared.

    Mirrors the JS engine's Number() coercion: a misspelled or unset variable
    makes the comparison simply false instead of ending the game.
    """
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0  # JS Number("") is 0
        try:
            return float(text)
        except ValueError:
            return None
    return None


def eval_when(when: dict | None, state: dict) -> bool:
    if not when:
        return True
    if "hasAbility" in when:
        return when["hasAbility"] in state["abilities"]
    if "var" in when:
        left = state["vars"].get(when["var"])
        if "eq" in when:
            return left == when["eq"]
        if "gte" in when or "lte" in when:
            key = "gte" if "gte" in when else "lte"
            lhs = _as_number(left)
            rhs = _as_number(when[key])
            if lhs is None or rhs is None:
                return False
            return lhs >= rhs if key == "gte" else lhs <= rhs
        if "truthy" in when:
            return bool(left) is bool(when["truthy"])
        return left is not None
    if "not" in when:
        return not eval_when(when["not"], state)
    if "all" in when:
        return all(eval_when(w, state) for w in when["all"])
    if "any" in when:
        return any(eval_when(w, state) for w in when["any"])
    return True


class NovelRuntime:
    def __init__(self, project_dir: Path):
        self.project_dir = Path(project_dir)
        self.project = json.loads((self.project_dir / "project.json").read_text(encoding="utf-8"))
        scenes_rel = self.project["story"]["scenes"]
        scenes_doc = json.loads((self.project_dir / scenes_rel).read_text(encoding="utf-8"))
        self.scenes: dict[str, Any] = scenes_doc.get("scenes", scenes_doc)
        self.state = {
            "playerName": "Traveler",
            "abilities": [],
            "vars": {},
            "history": [],
            "currentScene": self.project["start"],
        }
        self.seen_scenes: set[str] = set()
        self.last_choice_by_scene: dict[str, str] = {}
        self._last_show_was_seen = False
        self._skip_chain: set[str] = set()
        self.show(self.project["start"])

    def interpolate(self, text: str) -> str:
        return (text or "").replace("[NAME]", self.state["playerName"] or "Traveler")

    def show(self, scene_id: str, choice_text: str | None = None, *, record_history: bool = True) -> dict:
        scene = self.scenes.get(scene_id)
        if not scene:
            raise KeyError(f"Missing scene: {scene_id}")
        self._last_show_was_seen = scene_id in self.seen_scenes
        self.state["currentScene"] = scene_id
        if record_history:
            self.state["history"].append({"id": scene_id, "choice": choice_text})
        unlock = scene.get("unlockAbility")
        if unlock and unlock not in self.state["abilities"]:
            self.state["abilities"].append(unlock)
        if scene.get("set"):
            self.state["vars"].update(scene["set"])
        self.seen_scenes.add(scene_id)
        return scene

    def visible_choices(self) -> list[dict]:
        scene = self.scenes[self.state["currentScene"]]
        return [c for c in scene.get("choices") or [] if eval_when(c.get("when"), self.state)]

    def can_rollback(self) -> bool:
        return len(self.state["history"]) > 1

    def rollback(self) -> dict:
        """Soft rewind one history beat (does not undo abilities/vars)."""
        if not self.can_rollback():
            raise ValueError("Nothing to roll back")
        self._skip_chain.clear()
        self.state["history"].pop()
        prev = self.state["history"][-1]
        return self.show(prev["id"], prev.get("choice"), record_history=False)

    def skip_if_read(self) -> dict | None:
        """If the current scene was already seen, take preferred/sole choice. Else None.

        A chain of consecutive skips refuses to revisit a scene it already
        skipped through, so cyclic stories (A -> B -> A) stop instead of
        looping forever. Any manual navigation resets the chain.
        """
        if not self._last_show_was_seen:
            self._skip_chain.clear()
            return None
        scene_id = self.state["currentScene"]
        if scene_id in self._skip_chain:
            self._skip_chain.clear()
            return None
        visible = self.visible_choices()
        if not visible:
            self._skip_chain.clear()
            return None
        preferred = self.last_choice_by_scene.get(scene_id)
        pick = None
        if preferred:
            for c in visible:
                if c.get("text") == preferred:
                    pick = c
                    break
        if pick is None and len(visible) == 1:
            pick = visible[0]
        if pick is None:
            self._skip_chain.clear()
            return None
        self._skip_chain.add(scene_id)
        if pick.get("set"):
            self.state["vars"].update(pick["set"])
        text = pick.get("text")
        if text:
            self.last_choice_by_scene[scene_id] = text
        return self.show(pick["next"], text)

    def choose(self, index: int) -> dict:
        visible = self.visible_choices()
        choice = visible[index]
        self._skip_chain.clear()
        scene_id = self.state["currentScene"]
        if choice.get("set"):
            self.state["vars"].update(choice["set"])
        text = choice.get("text")
        if text:
            self.last_choice_by_scene[scene_id] = text
        return self.show(choice["next"], text)

    def choose_by_text(self, text: str) -> dict:
        visible = self.visible_choices()
        for i, c in enumerate(visible):
            if c.get("text") == text or c.get("next") == text:
                return self.choose(i)
        raise ValueError(f"No choice '{text}'. Visible: {[c.get('text') for c in visible]}")

    def list_save_slots(self) -> list[dict[str, Any]]:
        return list_slots(self.project_dir)

    def save_to_slot(self, slot: int, *, label: str | None = None) -> dict[str, Any]:
        return write_slot(self.project_dir, slot, self.state, label=label)

    def load_from_slot(self, slot: int) -> dict[str, Any]:
        save = read_slot(self.project_dir, slot)
        if not save:
            raise FileNotFoundError(f"Empty save slot {slot}")
        self._skip_chain.clear()
        apply_slot(self.state, save)
        # Re-enter scene without appending a duplicate history beat
        scene_id = self.state["currentScene"]
        if not self.scenes.get(scene_id):
            raise KeyError(f"Missing scene: {scene_id}")
        return self.scenes[scene_id]

    def clear_save_slot(self, slot: int) -> None:
        delete_slot(self.project_dir, slot)

    def read_save_slot(self, slot: int) -> dict[str, Any] | None:
        """Raw save dict for a slot (for export), or None if empty."""
        return read_slot(self.project_dir, slot)

    def import_save_slot(self, slot: int, save: dict[str, Any]) -> dict[str, Any]:
        """Validate an external save dict and write it into a slot."""
        if not isinstance(save, dict) or not save.get("currentScene"):
            raise ValueError("Not a valid save file")
        scene_id = save["currentScene"]
        if not self.scenes.get(scene_id):
            raise KeyError(f"Save references unknown scene: {scene_id}")
        staged = {
            "playerName": save.get("playerName") or "",
            "currentScene": scene_id,
            "abilities": list(save.get("abilities") or []),
            "vars": dict(save.get("vars") or {}),
            "history": list(save.get("history") or []),
        }
        return write_slot(self.project_dir, slot, staged, label=save.get("label") or f"Slot {slot}")
