"""Illustrated IF — graphical desktop player (pygame).

Presentation layer only: all story logic, saves, and rollback live in the
shared ``if_engine`` runtime. Mirrors the HTML engine's semantics:

* background image cover-scaled into the art pane, with a themed procedural
  fallback when the file is missing or unloadable (e.g. exotic SVG),
* left/right character sprites hidden when missing,
* theme colors / fonts / layout from ``theme/theme.json``,
* name gate, speaker chip, wrapped scrollable story text, hotkeyed choices,
  Back / Skip read / Restart / Abilities / Saves / Hide art controls.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

# Allow the window to be centered nicely and avoid audio init issues on
# machines without sound devices (pygame.display is all we need).
os.environ.setdefault("SDL_VIDEO_CENTERED", "1")

import pygame

from if_engine.runtime import NovelRuntime

from .theme import Theme

MIN_W, MIN_H = 860, 540
MARGIN = 16
GAP = 12
PAD = 14
TOOLBAR_H = 42
SKIP_INTERVAL_MS = 380
TOAST_MS = 2800

FONT_FALLBACKS = ("georgia", "palatinolinotype", "bookantiqua", "timesnewroman")


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


class FontCache:
    def __init__(self, theme: Theme):
        self.theme = theme
        self._paths: dict[str, str | None] = {}
        self._fonts: dict[tuple[str, int, bool], pygame.font.Font] = {}

    def _resolve(self, kind: str) -> str | None:
        if kind not in self._paths:
            name = self.theme.fonts.get(kind) or ""
            path = None
            for cand in (name, *FONT_FALLBACKS):
                if not cand:
                    continue
                path = pygame.font.match_font(cand.lower().replace(" ", ""))
                if path:
                    break
            self._paths[kind] = path
        return self._paths[kind]

    def get(self, kind: str, size: int, bold: bool = False) -> pygame.font.Font:
        key = (kind, size, bold)
        font = self._fonts.get(key)
        if font is None:
            path = self._resolve(kind)
            font = pygame.font.Font(path, size)
            font.set_bold(bold)
            self._fonts[key] = font
        return font


def wrap_text(font: pygame.font.Font, text: str, max_width: int) -> list[str]:
    """Word-wrap preserving explicit newlines (blank lines kept)."""
    lines: list[str] = []
    for para in (text or "").split("\n"):
        if not para.strip():
            lines.append("")
            continue
        words = para.split()
        cur = ""
        for word in words:
            trial = f"{cur} {word}".strip()
            if cur and font.size(trial)[0] > max_width:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        if cur:
            lines.append(cur)
    return lines or [""]


class PlayerApp:
    def __init__(self, project_dir: Path):
        pygame.init()
        pygame.key.set_repeat(350, 40)

        self.runtime = NovelRuntime(Path(project_dir))
        self.theme = Theme.load(Path(project_dir), self.runtime.project)
        self.assets_dir = Path(project_dir) / "assets"
        self.title = self.runtime.project.get("title", "Illustrated IF")

        info = pygame.display.Info()
        width = min(self.theme.max_width, max(MIN_W, info.current_w - 80))
        height = min(max(self.theme.game_height, MIN_H), max(MIN_H, info.current_h - 120))
        self.screen = pygame.display.set_mode((width, height), pygame.RESIZABLE)
        pygame.display.set_caption(self.title)

        self.fonts = FontCache(self.theme)
        self.clock = pygame.time.Clock()

        self.screen_name = "gate"  # gate | story
        self.overlay: str | None = None  # None | abilities | saves
        self.name_input = ""
        self.art_hidden = False
        self.scroll = 0
        self.sel = 0
        self.skip_mode = False
        self._skip_hops = 0
        self._next_skip_ms = 0
        self._toast: tuple[str, int] | None = None
        self._hits: list[tuple[pygame.Rect, Callable[[], None]]] = []
        self._hover_any = False
        self.mouse = (0, 0)
        self.running = True

        self._img_cache: dict[tuple[str, str], pygame.Surface | None] = {}
        self._scaled_cache: dict[tuple[str, str, int, int], pygame.Surface] = {}
        self._fallback_cache: dict[tuple[int, int], pygame.Surface] = {}
        self._slots_cache: list[dict[str, Any]] | None = None

    # ---------------------------------------------------------------- assets

    @staticmethod
    def _is_flat(surf: pygame.Surface) -> bool:
        """True when a surface is (near-)uniform — a failed vector rasterization."""
        w, h = surf.get_size()
        if w < 2 or h < 2:
            return True
        lo = [255, 255, 255]
        hi = [0, 0, 0]
        for fx in (0.08, 0.5, 0.92):
            for fy in (0.08, 0.5, 0.92):
                px = surf.get_at((int((w - 1) * fx), int((h - 1) * fy)))
                for i in range(3):
                    lo[i] = min(lo[i], px[i])
                    hi[i] = max(hi[i], px[i])
        return max(hi[i] - lo[i] for i in range(3)) < 16

    def _load_image(self, folder: str, name: str | None) -> pygame.Surface | None:
        if not name:
            return None
        key = (folder, name)
        if key in self._img_cache:
            return self._img_cache[key]
        surf: pygame.Surface | None = None
        path = self.assets_dir / folder / name
        if path.is_file():
            try:
                surf = pygame.image.load(str(path)).convert_alpha()
            except Exception:
                surf = None
            # pygame's built-in SVG rasterizer (nanosvg) drops gradients/text and
            # often yields a flat sheet; prefer the themed fallback in that case.
            if surf is not None and path.suffix.lower() == ".svg" and self._is_flat(surf):
                surf = None
        self._img_cache[key] = surf
        return surf

    def _scaled(self, folder: str, name: str, size: tuple[int, int], cover: bool) -> pygame.Surface | None:
        key = (folder, name, size[0], size[1])
        if key in self._scaled_cache:
            return self._scaled_cache[key]
        src = self._load_image(folder, name)
        if src is None:
            return None
        sw, sh = src.get_size()
        tw, th = size
        if sw <= 0 or sh <= 0 or tw <= 0 or th <= 0:
            return None
        scale = max(tw / sw, th / sh) if cover else min(tw / sw, th / sh)
        nw, nh = max(1, round(sw * scale)), max(1, round(sh * scale))
        scaled = pygame.transform.smoothscale(src, (nw, nh))
        if cover:
            out = pygame.Surface((tw, th), pygame.SRCALPHA)
            out.blit(scaled, ((tw - nw) // 2, (th - nh) // 2))
        else:
            out = scaled
        self._scaled_cache[key] = out
        return out

    def _fallback_bg(self, size: tuple[int, int]) -> pygame.Surface:
        """Themed stand-in mirroring assets/scene_images/default.svg."""
        if size in self._fallback_cache:
            return self._fallback_cache[size]
        w, h = size
        surf = pygame.Surface(size)
        top = self.theme.color("panel")
        bottom = self.theme.color("speakerBg")
        for y in range(h):
            for_x = y / max(1, h - 1)
            pygame.draw.line(surf, mix(top, bottom, for_x * 0.85), (0, y), (w, y))
        # soft diagonal sheen
        sheen = pygame.Surface(size, pygame.SRCALPHA)
        pygame.draw.polygon(
            sheen, (*self.theme.color("accent"), 18),
            [(0, 0), (int(w * 0.7), 0), (0, int(h * 0.7))],
        )
        surf.blit(sheen, (0, 0))
        font = self.fonts.get("display", max(20, min(34, w // 18)))
        label = font.render(self.title, True, self.theme.color("accentSoft"))
        surf.blit(label, label.get_rect(center=(w // 2, h // 2)))
        self._fallback_cache[size] = surf
        return surf

    # ----------------------------------------------------------------- state

    @property
    def scene(self) -> dict[str, Any]:
        return self.runtime.scenes[self.runtime.state["currentScene"]]

    def toast(self, msg: str) -> None:
        self._toast = (msg, pygame.time.get_ticks() + TOAST_MS)

    def scene_changed(self) -> None:
        self.scroll = 0
        self.sel = 0

    def begin(self) -> None:
        name = self.name_input.strip()
        if not name:
            return
        self.runtime.state["playerName"] = name
        self.screen_name = "story"
        self.scene_changed()

    def choose(self, index: int) -> None:
        visible = self.runtime.visible_choices()
        if index < 0 or index >= len(visible):
            return
        self.runtime.choose(index)
        self.scene_changed()
        if self.skip_mode:
            self._skip_hops = 0
            self._next_skip_ms = pygame.time.get_ticks() + SKIP_INTERVAL_MS

    def rollback(self) -> None:
        if not self.runtime.can_rollback():
            return
        try:
            self.runtime.rollback()
            self.scene_changed()
        except ValueError as err:
            self.toast(str(err))

    def restart(self) -> None:
        keep = bool((self.runtime.project.get("meta") or {}).get("keepAbilitiesOnRestart"))
        self.runtime.state["abilities"] = list(self.runtime.state["abilities"]) if keep else []
        self.runtime.state["vars"] = {}
        self.runtime.state["history"] = []
        self.runtime.show(self.runtime.project["start"])
        self.skip_mode = False
        self.scene_changed()
        self.toast("Story restarted")

    def toggle_skip(self) -> None:
        self.skip_mode = not self.skip_mode
        if self.skip_mode:
            self._skip_hops = 0
            self._next_skip_ms = pygame.time.get_ticks()

    def _tick_skip(self) -> None:
        if not self.skip_mode or self.screen_name != "story" or self.overlay:
            return
        now = pygame.time.get_ticks()
        if now < self._next_skip_ms:
            return
        nxt = self.runtime.skip_if_read()
        if nxt is None:
            if self._skip_hops == 0:
                self.toast("Skip stopped — unread scene or branching choice")
            self.skip_mode = False
            return
        self._skip_hops += 1
        self.scene_changed()
        self._next_skip_ms = now + SKIP_INTERVAL_MS
        if self._skip_hops > 200:
            self.skip_mode = False

    # ----------------------------------------------------------------- saves

    def _slots(self, refresh: bool = False) -> list[dict[str, Any]]:
        if self._slots_cache is None or refresh:
            self._slots_cache = self.runtime.list_save_slots()
        return self._slots_cache

    def save_slot(self, slot: int) -> None:
        state = self.runtime.state
        label = f"{state.get('playerName') or 'Traveler'} — {state.get('currentScene') or ''}".strip(" —")
        try:
            self.runtime.save_to_slot(slot, label=label or f"Slot {slot}")
            self.toast(f"Saved to slot {slot}")
        except Exception as err:
            self.toast(f"Save failed: {err}")
        self._slots(refresh=True)

    def load_slot(self, slot: int) -> None:
        try:
            self.runtime.load_from_slot(slot)
            self.screen_name = "story"
            self.overlay = None
            self.scene_changed()
            self.toast(f"Loaded slot {slot}")
        except Exception as err:
            self.toast(f"Load failed: {err}")
        self._slots(refresh=True)

    def clear_slot(self, slot: int) -> None:
        try:
            self.runtime.clear_save_slot(slot)
            self.toast(f"Cleared slot {slot}")
        except Exception as err:
            self.toast(f"Clear failed: {err}")
        self._slots(refresh=True)

    # ---------------------------------------------------------------- events

    def handle_event(self, event: pygame.event.Event) -> None:
        if event.type == pygame.QUIT:
            self.running = False
        elif event.type == pygame.VIDEORESIZE:
            w = max(MIN_W, event.w)
            h = max(MIN_H, event.h)
            self.screen = pygame.display.set_mode((w, h), pygame.RESIZABLE)
            self._scaled_cache.clear()
            self._fallback_cache.clear()
        elif event.type == pygame.MOUSEMOTION:
            self.mouse = event.pos
        elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            self.mouse = event.pos
            for rect, cb in reversed(self._hits):
                if rect.collidepoint(event.pos):
                    cb()
                    break
        elif event.type == pygame.MOUSEWHEEL:
            if self.screen_name == "story" and not self.overlay:
                self.scroll = max(0, self.scroll - event.y * 44)
        elif event.type == pygame.TEXTINPUT and self.screen_name == "gate":
            if len(self.name_input) < 24:
                self.name_input += event.text
        elif event.type == pygame.KEYDOWN:
            self._handle_key(event)

    def _handle_key(self, event: pygame.event.Event) -> None:
        key = event.key
        if self.overlay:
            if key in (pygame.K_ESCAPE, pygame.K_RETURN):
                self.overlay = None
            return
        if self.screen_name == "gate":
            if key == pygame.K_BACKSPACE:
                self.name_input = self.name_input[:-1]
            elif key in (pygame.K_RETURN, pygame.K_KP_ENTER):
                self.begin()
            return
        # story keys
        visible = self.runtime.visible_choices()
        if pygame.K_1 <= key <= pygame.K_9:
            self.choose(key - pygame.K_1)
        elif key in (pygame.K_DOWN, pygame.K_RIGHT, pygame.K_TAB):
            if visible:
                self.sel = (self.sel + 1) % len(visible)
        elif key in (pygame.K_UP, pygame.K_LEFT):
            if visible:
                self.sel = (self.sel - 1) % len(visible)
        elif key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
            self.choose(self.sel)
        elif key in (pygame.K_BACKSPACE, pygame.K_b):
            self.rollback()
        elif key == pygame.K_h:
            self.art_hidden = not self.art_hidden
        elif key == pygame.K_ESCAPE:
            self.skip_mode = False

    # --------------------------------------------------------------- drawing

    def _button(
        self,
        rect: pygame.Rect,
        label: str,
        cb: Callable[[], None],
        *,
        enabled: bool = True,
        toggled: bool = False,
        primary: bool = False,
        font: pygame.font.Font | None = None,
        interactive: bool = True,
    ) -> None:
        t = self.theme
        font = font or self.fonts.get("ui", 14)
        hover = enabled and interactive and rect.collidepoint(self.mouse)
        if primary:
            bg = t.color("choiceHover") if hover else t.color("choice")
            fg = t.color("text")
        else:
            base = mix(t.color("panelInner"), t.color("choice"), 0.25)
            bg = mix(base, t.color("choiceHover"), 0.5) if hover else base
            fg = t.color("text")
        if toggled:
            bg = t.color("choiceHover")
        if not enabled:
            bg = mix(t.color("panelInner"), t.color("panel"), 0.5)
            fg = t.color("muted")
        pygame.draw.rect(self.screen, bg, rect, border_radius=8)
        border = t.color("accent") if (hover or toggled) else t.color("border")
        pygame.draw.rect(self.screen, border, rect, width=1, border_radius=8)
        text = font.render(label, True, fg)
        self.screen.blit(text, text.get_rect(center=rect.center))
        if enabled and interactive:
            self._hits.append((rect.copy(), cb))
            if hover:
                self._hover_any = True

    def _panel(self, rect: pygame.Rect, *, inner: bool = False) -> None:
        t = self.theme
        color = t.color("panelInner") if inner else t.color("panel")
        pygame.draw.rect(self.screen, color, rect, border_radius=t.story_radius)
        pygame.draw.rect(self.screen, t.color("border"), rect, width=1, border_radius=t.story_radius)

    def draw(self) -> None:
        self._hits = []
        self._hover_any = False
        self.screen.fill(self.theme.color("bg"))
        if self.screen_name == "gate":
            self._draw_gate()
        else:
            self._draw_story()
        if self.overlay == "abilities":
            self._draw_abilities()
        elif self.overlay == "saves":
            self._draw_saves()
        self._draw_toast()
        if pygame.mouse.get_focused():
            cursor = pygame.SYSTEM_CURSOR_HAND if self._hover_any else pygame.SYSTEM_CURSOR_ARROW
            pygame.mouse.set_cursor(cursor)

    # ------------------------------------------------------------------ gate

    def _draw_gate(self) -> None:
        t = self.theme
        w, h = self.screen.get_size()
        card_w = min(560, w - 2 * MARGIN)
        card_h = min(400, h - 2 * MARGIN)
        card = pygame.Rect((w - card_w) // 2, (h - card_h) // 2, card_w, card_h)

        # backdrop uses the story's default art, dimmed
        backdrop = self._scaled("scene_images", "default.svg", (w, h), True) or self._fallback_bg((w, h))
        self.screen.blit(backdrop, (0, 0))
        dim = pygame.Surface((w, h), pygame.SRCALPHA)
        dim.fill((*t.color("bg"), 200))
        self.screen.blit(dim, (0, 0))

        self._panel(card)
        cx = card.centerx
        y = card.y + 30

        if t.show_brand:
            pygame.draw.polygon(
                self.screen, t.color("accent"),
                [(cx, y), (cx + 10, y + 12), (cx, y + 24), (cx - 10, y + 12)],
            )
            pygame.draw.polygon(
                self.screen, t.color("accentSoft"),
                [(cx, y), (cx + 10, y + 12), (cx, y + 24), (cx - 10, y + 12)], width=1,
            )
            y += 40

        title_font = self.fonts.get("display", 34)
        title = title_font.render(self.title, True, t.color("text"))
        self.screen.blit(title, title.get_rect(midtop=(cx, y)))
        y += title.get_height() + 6

        meta = self.runtime.project.get("meta") or {}
        fmt_label = meta.get("formatLabel") or "Illustrated text-based RPG"
        sub = self.fonts.get("ui", 14).render(fmt_label, True, t.color("muted"))
        self.screen.blit(sub, sub.get_rect(midtop=(cx, y)))
        y += sub.get_height() + 4

        author = self.runtime.project.get("author")
        if t.show_byline and author:
            byline = self.fonts.get("ui", 13).render(f"by {author}", True, t.color("muted"))
            self.screen.blit(byline, byline.get_rect(midtop=(cx, y)))
            y += byline.get_height()
        y += 24

        prompt = self.fonts.get("ui", 15).render("What is your name?", True, t.color("speaker"))
        self.screen.blit(prompt, prompt.get_rect(midtop=(cx, y)))
        y += prompt.get_height() + 10

        box = pygame.Rect(cx - 170, y, 340, 42)
        pygame.draw.rect(self.screen, t.color("panelInner"), box, border_radius=8)
        pygame.draw.rect(self.screen, t.color("accent"), box, width=2, border_radius=8)
        name_font = self.fonts.get("body", 18)
        shown = self.name_input
        caret = "|" if (pygame.time.get_ticks() // 500) % 2 == 0 else " "
        text = name_font.render(shown + caret, True, t.color("text"))
        self.screen.blit(text, text.get_rect(midleft=(box.x + 12, box.centery)))
        y = box.bottom + 18

        begin = pygame.Rect(cx - 90, y, 180, 44)
        self._button(begin, "Begin", self.begin, enabled=bool(self.name_input.strip()),
                     primary=True, font=self.fonts.get("ui", 16))
        hint = self.fonts.get("ui", 12).render("Press Enter to begin", True, t.color("muted"))
        self.screen.blit(hint, hint.get_rect(midtop=(cx, begin.bottom + 10)))

    # ----------------------------------------------------------------- story

    def _draw_story(self) -> None:
        t = self.theme
        w, h = self.screen.get_size()
        content = pygame.Rect(MARGIN, MARGIN, w - 2 * MARGIN, h - 2 * MARGIN)

        art_rect: pygame.Rect | None = None
        panel_rect = content
        if not self.art_hidden:
            art_w = int(content.w * t.art_ratio) - GAP // 2
            if t.art_position == "right":
                art_rect = pygame.Rect(content.right - art_w, content.y, art_w, content.h)
                panel_rect = pygame.Rect(content.x, content.y, content.w - art_w - GAP, content.h)
            else:
                art_rect = pygame.Rect(content.x, content.y, art_w, content.h)
                panel_rect = pygame.Rect(art_rect.right + GAP, content.y, content.w - art_w - GAP, content.h)

        if art_rect:
            self._draw_art(art_rect)
        self._draw_panel(panel_rect)

    def _draw_art(self, rect: pygame.Rect) -> None:
        t = self.theme
        scene = self.scene
        inner = rect.inflate(-2 * t.frame_border, -2 * t.frame_border)
        pygame.draw.rect(self.screen, t.color("stage"), rect)

        name = scene.get("sceneImage") or "default.svg"
        bg = self._scaled("scene_images", name, inner.size, True)
        if bg is None and name != "default.svg":
            bg = self._scaled("scene_images", "default.svg", inner.size, True)
        if bg is None:
            bg = self._fallback_bg(inner.size)
        self.screen.blit(bg, inner.topleft)

        # sprites: bottom-aligned, hidden when missing (mirrors HTML setSprite)
        max_h = int(inner.h * 0.92)
        for slot, align in (("characterLeft", "left"), ("characterRight", "right")):
            file = scene.get(slot)
            if not file:
                continue
            src = self._load_image("characters", file)
            if src is None:
                continue
            sw, sh = src.get_size()
            scale = min(max_h / sh, (inner.w * 0.48) / sw, 1.5)
            size = (max(1, round(sw * scale)), max(1, round(sh * scale)))
            sprite = self._scaled("characters", file, size, False)
            if sprite is None:
                continue
            x = inner.x + int(inner.w * 0.03) if align == "left" else inner.right - sprite.get_width() - int(inner.w * 0.03)
            self.screen.blit(sprite, (x, inner.bottom - sprite.get_height()))

        pygame.draw.rect(self.screen, t.color("frame"), rect, width=t.frame_border)

    def _draw_panel(self, rect: pygame.Rect) -> None:
        t = self.theme
        self._panel(rect)
        inner = rect.inflate(-2 * PAD, -2 * PAD)
        interactive = self.overlay is None
        y = inner.y

        scene = self.scene
        speaker = scene.get("speaker")
        if t.show_speaker and speaker:
            label = self.fonts.get("ui", 14, bold=True).render(
                self.runtime.interpolate(speaker), True, t.color("speaker"))
            chip = pygame.Rect(inner.x, y, label.get_width() + 24, 30)
            pygame.draw.rect(self.screen, t.color("speakerBg"), chip, border_radius=15)
            self.screen.blit(label, label.get_rect(center=chip.center))
            y = chip.bottom + 10

        # toolbar (bottom)
        toolbar = pygame.Rect(inner.x, inner.bottom - TOOLBAR_H + 6, inner.w, TOOLBAR_H - 6)
        self._draw_toolbar(toolbar, interactive)

        # choices (above toolbar)
        visible = self.runtime.visible_choices()
        choice_font = self.fonts.get("ui", 15)
        cols = t.choice_columns if len(visible) > 1 else 1
        col_w = (inner.w - (cols - 1) * 8) // max(1, cols)
        rows: list[list[tuple[int, dict[str, Any], list[str]]]] = []
        for i, choice in enumerate(visible):
            if i % cols == 0:
                rows.append([])
            label = self.runtime.interpolate(choice.get("text") or "")
            pad_x = 40 if t.show_hotkeys else 20
            rows[-1].append((i, choice, wrap_text(choice_font, label, col_w - pad_x)))
        line_h = choice_font.get_linesize()
        row_heights = [max(len(lines) for _, _, lines in row) * line_h + 18 for row in rows]
        choices_h = sum(row_heights) + max(0, len(rows) - 1) * 8 if rows else 30
        choices_top = toolbar.y - 10 - choices_h

        if visible:
            ry = choices_top
            for row, rh in zip(rows, row_heights):
                for i, choice, lines in row:
                    col = i % cols
                    brect = pygame.Rect(inner.x + col * (col_w + 8), ry, col_w, rh)
                    self._draw_choice(brect, i, lines, choice_font, interactive)
                ry += rh + 8
        else:
            note = self.fonts.get("body", 15).render(
                "The story path ends here for now.", True, t.color("muted"))
            self.screen.blit(note, (inner.x, choices_top + 8))

        # story text (fills remaining space, scrollable)
        text_rect = pygame.Rect(inner.x, y, inner.w, choices_top - 12 - y)
        if text_rect.h > 30:
            self._draw_story_text(text_rect)

    def _draw_choice(self, rect: pygame.Rect, index: int, lines: list[str],
                     font: pygame.font.Font, interactive: bool) -> None:
        t = self.theme
        hover = interactive and rect.collidepoint(self.mouse)
        selected = index == self.sel
        bg = t.color("choiceHover") if hover else t.color("choice")
        pygame.draw.rect(self.screen, bg, rect, border_radius=8)
        border = t.color("accentSoft") if (hover or selected) else t.color("border")
        pygame.draw.rect(self.screen, border, rect, width=2 if selected else 1, border_radius=8)

        x = rect.x + 12
        if t.show_hotkeys and index < 9:
            badge = pygame.Rect(rect.x + 8, rect.centery - 10, 20, 20)
            pygame.draw.rect(self.screen, mix(t.color("choice"), (0, 0, 0), 0.35), badge, border_radius=5)
            num = self.fonts.get("ui", 12, bold=True).render(str(index + 1), True, t.color("accentSoft"))
            self.screen.blit(num, num.get_rect(center=badge.center))
            x = badge.right + 8

        line_h = font.get_linesize()
        total = len(lines) * line_h
        ty = rect.centery - total // 2
        for line in lines:
            surf = font.render(line, True, t.color("text"))
            self.screen.blit(surf, (x, ty))
            ty += line_h

        if interactive:
            self._hits.append((rect.copy(), lambda idx=index: self.choose(idx)))
            if hover:
                self._hover_any = True

    def _draw_story_text(self, rect: pygame.Rect) -> None:
        t = self.theme
        pygame.draw.rect(self.screen, t.color("panelInner"), rect, border_radius=t.story_radius)
        pygame.draw.rect(self.screen, t.color("border"), rect, width=1, border_radius=t.story_radius)
        inner = rect.inflate(-24, -20)

        font = self.fonts.get("body", 18)
        text = self.runtime.interpolate(self.scene.get("text") or "")
        lines = wrap_text(font, text, inner.w)
        line_h = int(font.get_linesize() * 1.22)
        total_h = len(lines) * line_h
        max_scroll = max(0, total_h - inner.h)
        self.scroll = min(self.scroll, max_scroll)

        clip = self.screen.get_clip()
        self.screen.set_clip(rect.inflate(-4, -8))
        ty = inner.y - self.scroll
        for line in lines:
            if ty + line_h >= inner.y - line_h and ty <= inner.bottom:
                if line:
                    surf = font.render(line, True, t.color("textOnLight"))
                    self.screen.blit(surf, (inner.x, ty))
            ty += line_h
        self.screen.set_clip(clip)

        if max_scroll > 0:
            track = pygame.Rect(rect.right - 8, rect.y + 6, 4, rect.h - 12)
            thumb_h = max(24, int(track.h * inner.h / total_h))
            thumb_y = track.y + int((track.h - thumb_h) * (self.scroll / max_scroll))
            pygame.draw.rect(self.screen, t.color("border"), track, border_radius=2)
            pygame.draw.rect(self.screen, t.color("accent"),
                             pygame.Rect(track.x, thumb_y, 4, thumb_h), border_radius=2)

    def _draw_toolbar(self, rect: pygame.Rect, interactive: bool) -> None:
        font = self.fonts.get("ui", 13)
        labels: list[tuple[str, Callable[[], None], dict[str, Any]]] = [
            ("Back", self.rollback, {"enabled": self.runtime.can_rollback()}),
            ("Skip read" + (" ✓" if self.skip_mode else ""), self.toggle_skip, {"toggled": self.skip_mode}),
            ("Restart", self.restart, {}),
            ("Abilities", lambda: self._open_overlay("abilities"), {}),
            ("Saves", lambda: self._open_overlay("saves"), {}),
        ]
        if self.theme.show_hide_image:
            labels.append(("Show art" if self.art_hidden else "Hide art", self._toggle_art, {}))
        gap = 6
        bw = (rect.w - gap * (len(labels) - 1)) // len(labels)
        x = rect.x
        for label, cb, opts in labels:
            brect = pygame.Rect(x, rect.y, bw, rect.h)
            self._button(brect, label, cb, font=font, interactive=interactive, **opts)
            x += bw + gap

    def _toggle_art(self) -> None:
        self.art_hidden = not self.art_hidden

    def _open_overlay(self, name: str) -> None:
        self.overlay = name
        if name == "saves":
            self._slots(refresh=True)

    # -------------------------------------------------------------- overlays

    def _overlay_frame(self, width: int, height: int, title: str) -> pygame.Rect:
        w, h = self.screen.get_size()
        dim = pygame.Surface((w, h), pygame.SRCALPHA)
        dim.fill((0, 0, 0, 160))
        self.screen.blit(dim, (0, 0))
        panel = pygame.Rect((w - width) // 2, (h - height) // 2, width, height)
        self._panel(panel)
        t_font = self.fonts.get("display", 22)
        label = t_font.render(title, True, self.theme.color("text"))
        self.screen.blit(label, (panel.x + 20, panel.y + 16))
        close = pygame.Rect(panel.right - 92, panel.y + 14, 72, 30)
        self._button(close, "Close", lambda: setattr(self, "overlay", None))
        return panel

    def _draw_abilities(self) -> None:
        abilities = self.runtime.state["abilities"] or []
        w, _ = self.screen.get_size()
        height = 110 + max(1, len(abilities)) * 30
        panel = self._overlay_frame(min(420, w - 80), min(height, 420), "Abilities")
        font = self.fonts.get("body", 16)
        y = panel.y + 64
        if not abilities:
            surf = font.render("(none yet)", True, self.theme.color("muted"))
            self.screen.blit(surf, (panel.x + 24, y))
        else:
            for name in abilities:
                pygame.draw.circle(self.screen, self.theme.color("accent"), (panel.x + 30, y + 9), 4)
                surf = font.render(str(name), True, self.theme.color("text"))
                self.screen.blit(surf, (panel.x + 44, y))
                y += 30

    def _draw_saves(self) -> None:
        t = self.theme
        w, h = self.screen.get_size()
        panel = self._overlay_frame(min(620, w - 60), min(370, h - 60), "Save slots")
        font = self.fonts.get("ui", 13)
        row_h = 52
        y = panel.y + 60
        for info in self._slots():
            slot = info["slot"]
            row = pygame.Rect(panel.x + 16, y, panel.w - 32, row_h - 6)
            pygame.draw.rect(self.screen, t.color("panelInner"), row, border_radius=8)
            if info.get("empty"):
                summary = "Empty"
            elif info.get("corrupt"):
                summary = "Corrupt save file"
            else:
                summary = info.get("label") or (
                    f"{info.get('playerName') or '—'} · {info.get('currentScene') or '?'}"
                )
            text = font.render(f"Slot {slot} — {summary}", True,
                               t.color("muted") if info.get("empty") else t.color("text"))
            self.screen.blit(text, text.get_rect(midleft=(row.x + 12, row.centery)))

            usable = not info.get("empty") and not info.get("corrupt")
            bw, bh = 62, 28
            bx = row.right - 3 * (bw + 6)
            for label, cb, enabled in (
                ("Save", lambda s=slot: self.save_slot(s), True),
                ("Load", lambda s=slot: self.load_slot(s), usable),
                ("Clear", lambda s=slot: self.clear_slot(s), not info.get("empty")),
            ):
                brect = pygame.Rect(bx, row.centery - bh // 2, bw, bh)
                self._button(brect, label, cb, enabled=enabled, font=font)
                bx += bw + 6
            y += row_h

    def _draw_toast(self) -> None:
        if not self._toast:
            return
        msg, until = self._toast
        if pygame.time.get_ticks() > until:
            self._toast = None
            return
        t = self.theme
        font = self.fonts.get("ui", 14)
        surf = font.render(msg, True, t.color("text"))
        w, h = self.screen.get_size()
        pill = pygame.Rect(0, 0, surf.get_width() + 36, surf.get_height() + 18)
        pill.midbottom = (w // 2, h - 18)
        pygame.draw.rect(self.screen, mix(t.color("panelInner"), (0, 0, 0), 0.2), pill, border_radius=pill.h // 2)
        pygame.draw.rect(self.screen, t.color("accent"), pill, width=1, border_radius=pill.h // 2)
        self.screen.blit(surf, surf.get_rect(center=pill.center))

    # ------------------------------------------------------------------ loop

    def run(self) -> int:
        while self.running:
            for event in pygame.event.get():
                self.handle_event(event)
            self._tick_skip()
            self.draw()
            pygame.display.flip()
            self.clock.tick(60)
        pygame.quit()
        return 0


def run(project_dir: Path | str) -> int:
    app = PlayerApp(Path(project_dir))
    return app.run()
