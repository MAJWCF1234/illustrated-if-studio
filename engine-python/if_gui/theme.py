"""Theme loading for the graphical player.

Pure stdlib (no pygame import) — mirrors the semantics of the HTML engine's
applyTheme(): colors, fonts, layout, and scene/menu template options read from
the project's theme/theme.json with sensible "void-violet" defaults.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_COLORS: dict[str, str] = {
    "bg": "#050208",
    "frame": "#6b21a8",
    "stage": "#0a0612",
    "panel": "#12081c",
    "panelInner": "#1a0f2e",
    "accent": "#a855f7",
    "accentSoft": "#c084fc",
    "text": "#f3e8ff",
    "textOnLight": "#ede4ff",
    "muted": "#a78bba",
    "border": "#5b2d8e",
    "speaker": "#e9d5ff",
    "speakerBg": "#3b0764",
    "choice": "#7c3aed",
    "choiceHover": "#9333ea",
}

DEFAULT_FONTS: dict[str, str] = {
    "display": "Georgia",
    "ui": "Georgia",
    "body": "Georgia",
}

DEFAULT_LAYOUT: dict[str, Any] = {
    "maxWidth": 1100,
    "gameHeight": 620,
    "artRatio": 0.62,
}


def parse_hex(value: Any, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    """#rgb / #rrggbb -> (r, g, b); anything unparsable returns the fallback."""
    if not isinstance(value, str):
        return fallback
    s = value.strip().lstrip("#")
    try:
        if len(s) == 3:
            return tuple(int(c * 2, 16) for c in s)  # type: ignore[return-value]
        if len(s) == 6:
            return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError:
        pass
    return fallback


class Theme:
    """Resolved theme values with defaults applied."""

    def __init__(self, data: dict[str, Any] | None = None):
        data = data or {}
        self.raw = data
        colors = {**DEFAULT_COLORS, **(data.get("colors") or {})}
        self.colors: dict[str, tuple[int, int, int]] = {
            key: parse_hex(colors.get(key), parse_hex(DEFAULT_COLORS[key], (0, 0, 0)))
            for key in DEFAULT_COLORS
        }
        self.fonts = {**DEFAULT_FONTS, **(data.get("fonts") or {})}
        layout = {**DEFAULT_LAYOUT, **(data.get("layout") or {})}
        scene_t = (data.get("templates") or {}).get("scene") or {}
        menu_t = (data.get("templates") or {}).get("menu") or {}

        self.max_width = int(layout.get("maxWidth") or DEFAULT_LAYOUT["maxWidth"])
        self.game_height = int(layout.get("gameHeight") or DEFAULT_LAYOUT["gameHeight"])
        art_ratio = scene_t.get("artRatio", layout.get("artRatio"))
        try:
            self.art_ratio = min(0.8, max(0.25, float(art_ratio)))
        except (TypeError, ValueError):
            self.art_ratio = float(DEFAULT_LAYOUT["artRatio"])

        self.art_position = scene_t.get("artPosition") or "left"
        try:
            self.choice_columns = max(1, min(4, int(scene_t.get("choiceColumns") or 2)))
        except (TypeError, ValueError):
            self.choice_columns = 2
        self.show_hotkeys = scene_t.get("showHotkeys") is not False
        self.show_speaker = scene_t.get("showSpeaker") is not False
        self.show_hide_image = scene_t.get("showHideImage") is not False
        try:
            self.frame_border = max(1, int(scene_t.get("frameBorderPx") or 3))
        except (TypeError, ValueError):
            self.frame_border = 3
        try:
            self.story_radius = max(0, int(scene_t.get("storyRadiusPx") or 8))
        except (TypeError, ValueError):
            self.story_radius = 8

        self.show_byline = menu_t.get("showByline") is not False
        self.show_brand = menu_t.get("showBrandMark") is not False
        self.title_align = menu_t.get("titleAlign") or "center"

    def color(self, name: str) -> tuple[int, int, int]:
        return self.colors.get(name, (255, 0, 255))

    @classmethod
    def load(cls, project_dir: Path, project: dict[str, Any]) -> "Theme":
        rel = project.get("theme")
        if rel:
            path = Path(project_dir) / rel
            try:
                return cls(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                pass
        return cls()
