import {
  COLOR_FIELDS,
  DEFAULT_THEME,
  MENU_TEMPLATE_OPTIONS,
  SCENE_TEMPLATE_OPTIONS,
  mergeTheme,
} from "./theme-defaults.js";

/**
 * Design studio: colors + scene/menu templates for creators.
 * @param {{ getTheme: () => object, setTheme: (t: object, opts?: {dirty?: boolean}) => void, onDirty: () => void }} api
 */
export function mountDesignStudio(root, api) {
  root.innerHTML = `
    <aside class="design-rail">
      <p class="design-kicker">Game UX</p>
      <nav class="design-nav" role="tablist">
        <button type="button" class="design-nav-btn active" data-design="colors">Colors</button>
        <button type="button" class="design-nav-btn" data-design="scene">Scene template</button>
        <button type="button" class="design-nav-btn" data-design="menu">Menu template</button>
      </nav>
      <p class="design-foot">Defaults = current void-violet illustrated IF look. Changes save with the project theme.</p>
      <button type="button" class="btn" id="btn-reset-theme">Reset to default</button>
    </aside>
    <section class="design-main">
      <div id="design-colors" class="design-panel active"></div>
      <div id="design-scene" class="design-panel" hidden></div>
      <div id="design-menu" class="design-panel" hidden></div>
    </section>
    <aside class="design-preview-pane">
      <header class="design-preview-head">
        <strong>Live UX preview</strong>
        <div class="design-preview-tabs">
          <button type="button" class="btn tiny active" data-prev="scene">Scene</button>
          <button type="button" class="btn tiny" data-prev="menu">Menu</button>
        </div>
      </header>
      <div id="ux-preview" class="ux-preview" aria-label="Theme preview"></div>
    </aside>
  `;

  const colorsEl = root.querySelector("#design-colors");
  const sceneEl = root.querySelector("#design-scene");
  const menuEl = root.querySelector("#design-menu");
  const preview = root.querySelector("#ux-preview");
  let previewMode = "scene";

  function theme() {
    return mergeTheme(api.getTheme());
  }

  function patch(mutator) {
    const next = mergeTheme(api.getTheme());
    mutator(next);
    api.setTheme(next, { dirty: true });
    api.onDirty();
    renderPreview();
  }

  function renderColors() {
    const t = theme();
    colorsEl.innerHTML = `
      <h2>Color scheme</h2>
      <p class="insp-hint">Every player surface (gate, scene frame, actions, settings) reads these tokens.</p>
      <div class="color-grid">
        ${COLOR_FIELDS.map(
          ([key, label]) => `
          <label class="color-field">
            <span>${label}</span>
            <div class="color-row">
              <input type="color" data-color="${key}" value="${escapeAttr(normalizeHex(t.colors[key]))}" />
              <input type="text" data-color-hex="${key}" value="${escapeAttr(t.colors[key])}" spellcheck="false" />
            </div>
          </label>`
        ).join("")}
      </div>
      <h3 class="design-sub">Fonts</h3>
      <div class="font-grid">
        <label class="field">Display (title)
          <input type="text" data-font="display" value="${escapeAttr(t.fonts.display)}" />
        </label>
        <label class="field">UI (buttons / tabs)
          <input type="text" data-font="ui" value="${escapeAttr(t.fonts.ui)}" />
        </label>
        <label class="field">Body (story)
          <input type="text" data-font="body" value="${escapeAttr(t.fonts.body)}" />
        </label>
      </div>
    `;

    colorsEl.querySelectorAll("[data-color]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.color;
        const hex = input.value;
        const text = colorsEl.querySelector(`[data-color-hex="${key}"]`);
        if (text) text.value = hex;
        patch((t) => {
          t.colors[key] = hex;
        });
      });
    });
    colorsEl.querySelectorAll("[data-color-hex]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.colorHex;
        let v = input.value.trim();
        if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return;
        if (v.length === 4) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
        const color = colorsEl.querySelector(`[data-color="${key}"]`);
        if (color) color.value = normalizeHex(v);
        patch((t) => {
          t.colors[key] = v;
        });
      });
    });
    colorsEl.querySelectorAll("[data-font]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.font;
        patch((t) => {
          t.fonts[key] = input.value.trim() || DEFAULT_THEME.fonts[key];
        });
      });
    });
  }

  function selectHtml(name, options, current) {
    return `<select data-scene="${name}">${options
      .map(
        (o) =>
          `<option value="${escapeAttr(String(o.value))}" ${
            String(o.value) === String(current) ? "selected" : ""
          }>${escapeHtml(o.label)}</option>`
      )
      .join("")}</select>`;
  }

  function renderScene() {
    const s = theme().templates.scene;
    sceneEl.innerHTML = `
      <h2>Scene template</h2>
      <p class="insp-hint">Layout of the play frame: art pane, story box, and action grid.</p>
      <label class="field">Art position ${selectHtml("artPosition", SCENE_TEMPLATE_OPTIONS.artPosition, s.artPosition)}</label>
      <label class="field">Action columns ${selectHtml("choiceColumns", SCENE_TEMPLATE_OPTIONS.choiceColumns, s.choiceColumns)}</label>
      <label class="field">Action button style ${selectHtml("choiceStyle", SCENE_TEMPLATE_OPTIONS.choiceStyle, s.choiceStyle)}</label>
      <label class="field">Art width ratio (0.35–0.75)
        <input type="number" min="0.35" max="0.75" step="0.01" data-scene-num="artRatio" value="${escapeAttr(String(s.artRatio))}" />
      </label>
      <label class="field">Frame border (px)
        <input type="number" min="0" max="12" step="1" data-scene-num="frameBorderPx" value="${escapeAttr(String(s.frameBorderPx))}" />
      </label>
      <label class="field">Story box radius (px)
        <input type="number" min="0" max="24" step="1" data-scene-num="storyRadiusPx" value="${escapeAttr(String(s.storyRadiusPx))}" />
      </label>
      <div class="check-grid">
        <label class="check"><input type="checkbox" data-scene-bool="showHotkeys" ${s.showHotkeys !== false ? "checked" : ""} /> Numbered hotkeys on actions</label>
        <label class="check"><input type="checkbox" data-scene-bool="showSpeaker" ${s.showSpeaker !== false ? "checked" : ""} /> Speaker nameplate</label>
        <label class="check"><input type="checkbox" data-scene-bool="showHideImage" ${s.showHideImage !== false ? "checked" : ""} /> Hide Image button</label>
      </div>
    `;

    sceneEl.querySelectorAll("[data-scene]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.scene;
        let val = el.value;
        if (key === "choiceColumns") val = Number(val);
        patch((t) => {
          t.templates.scene[key] = val;
          if (key === "artRatio") t.layout.artRatio = Number(val);
        });
      });
    });
    sceneEl.querySelectorAll("[data-scene-num]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.sceneNum;
        const val = Number(el.value);
        patch((t) => {
          t.templates.scene[key] = val;
          if (key === "artRatio") t.layout.artRatio = val;
        });
      });
    });
    sceneEl.querySelectorAll("[data-scene-bool]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.sceneBool;
        patch((t) => {
          t.templates.scene[key] = el.checked;
        });
      });
    });
  }

  function renderMenu() {
    const m = theme().templates.menu;
    menuEl.innerHTML = `
      <h2>Menu template</h2>
      <p class="insp-hint">Title / name gate and in-game Settings tab chrome.</p>
      <label class="field">Gate style
        <select data-menu="gateStyle">
          ${MENU_TEMPLATE_OPTIONS.gateStyle
            .map(
              (o) =>
                `<option value="${o.value}" ${m.gateStyle === o.value ? "selected" : ""}>${o.label}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">Primary button style
        <select data-menu="buttonStyle">
          ${MENU_TEMPLATE_OPTIONS.buttonStyle
            .map(
              (o) =>
                `<option value="${o.value}" ${m.buttonStyle === o.value ? "selected" : ""}>${o.label}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">Title alignment
        <select data-menu="titleAlign">
          ${MENU_TEMPLATE_OPTIONS.titleAlign
            .map(
              (o) =>
                `<option value="${o.value}" ${m.titleAlign === o.value ? "selected" : ""}>${o.label}</option>`
            )
            .join("")}
        </select>
      </label>
      <label class="field">Settings layout
        <select data-menu="settingsLayout">
          ${MENU_TEMPLATE_OPTIONS.settingsLayout
            .map(
              (o) =>
                `<option value="${o.value}" ${m.settingsLayout === o.value ? "selected" : ""}>${o.label}</option>`
            )
            .join("")}
        </select>
      </label>
      <div class="check-grid">
        <label class="check"><input type="checkbox" data-menu-bool="showBrandMark" ${m.showBrandMark !== false ? "checked" : ""} /> Brand mark (“Illustrated IF”)</label>
        <label class="check"><input type="checkbox" data-menu-bool="showByline" ${m.showByline !== false ? "checked" : ""} /> Author byline</label>
      </div>
    `;

    menuEl.querySelectorAll("[data-menu]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.menu;
        patch((t) => {
          t.templates.menu[key] = el.value;
        });
      });
    });
    menuEl.querySelectorAll("[data-menu-bool]").forEach((el) => {
      el.addEventListener("change", () => {
        const key = el.dataset.menuBool;
        patch((t) => {
          t.templates.menu[key] = el.checked;
        });
      });
    });
  }

  function renderPreview() {
    const raw = theme();
    // Theme strings land inside style="" / class="" of an innerHTML template. A value
    // carrying a quote closes the attribute and the rest of it is parsed as markup, so
    // an imported theme could run script in the editor origin (which owns the write APIs).
    const t = {
      ...raw,
      colors: mapValues(raw.colors, (v, k) => cssToken(v, DEFAULT_THEME.colors[k] || "#000")),
      fonts: mapValues(raw.fonts, (v, k) => cssToken(v, DEFAULT_THEME.fonts[k] || "serif")),
    };
    const c = t.colors;
    const rawScene = raw.templates.scene;
    const rawMenu = raw.templates.menu;
    const d = DEFAULT_THEME.templates;
    const s = {
      ...rawScene,
      artPosition: cssClass(rawScene.artPosition, d.scene.artPosition),
      choiceStyle: cssClass(rawScene.choiceStyle, d.scene.choiceStyle),
      artRatio: cssNumber(rawScene.artRatio, d.scene.artRatio, 0.05, 0.95),
      frameBorderPx: cssNumber(rawScene.frameBorderPx, d.scene.frameBorderPx, 0, 24),
      storyRadiusPx: cssNumber(rawScene.storyRadiusPx, d.scene.storyRadiusPx, 0, 64),
      choiceColumns: cssNumber(rawScene.choiceColumns, d.scene.choiceColumns, 1, 6),
    };
    const m = {
      ...rawMenu,
      gateStyle: cssClass(rawMenu.gateStyle, d.menu.gateStyle),
      buttonStyle: cssClass(rawMenu.buttonStyle, d.menu.buttonStyle),
      titleAlign: cssClass(rawMenu.titleAlign, d.menu.titleAlign),
    };
    const artPos = s.artPosition;
    const cols = s.choiceColumns;

    if (previewMode === "menu") {
      preview.innerHTML = `
        <div class="uxp-shell" style="--bg:${c.bg};--accent:${c.accent};--accent-soft:${c.accentSoft};--text:${c.text};--muted:${c.muted};--border:${c.border};--choice:${c.choice};font-family:${t.fonts.ui},serif;">
          <div class="uxp-brand" style="text-align:${m.titleAlign || "center"}">
            ${m.showBrandMark !== false ? `<p class="uxp-mark">Illustrated IF</p>` : ""}
            <h3 style="color:${c.accent}">Game Title</h3>
            ${m.showByline !== false ? `<p class="uxp-by" style="color:${c.muted}">Game by Author</p>` : ""}
          </div>
          <div class="uxp-gate ${m.gateStyle || "centered-card"}" style="border-color:${c.accentSoft};background:rgba(0,0,0,.35)">
            <p style="color:${c.accentSoft};font-family:${t.fonts.display},serif">What is your name, traveler?</p>
            <div class="uxp-gate-row">
              <span class="uxp-input" style="border-color:${c.border};background:${c.stage};color:${c.text}">Traveler</span>
              <button class="uxp-btn ${m.buttonStyle || "filled"}" style="--c:${c.choice};--a:${c.accent}">Begin</button>
            </div>
          </div>
        </div>`;
      return;
    }

    const flexDir =
      artPos === "right" ? "row-reverse" : artPos === "top" ? "column" : "row";
    const artFlex = artPos === "hidden" ? "0" : artPos === "top" ? "0 0 38%" : `${s.artRatio || 0.62}`;
    const storyFlex = artPos === "hidden" ? "1" : artPos === "top" ? "1" : `${1 - (s.artRatio || 0.62)}`;

    preview.innerHTML = `
      <div class="uxp-shell" style="--bg:${c.bg};--frame:${c.frame};--stage:${c.stage};--panel:${c.panel};--inner:${c.panelInner};--text:${c.textOnLight};--ui:${c.text};--muted:${c.muted};--choice:${c.choice};--choice-h:${c.choiceHover};--speaker:${c.speaker};--speaker-bg:${c.speakerBg};--accent:${c.accent};font-family:${t.fonts.body},serif;">
        <div class="uxp-frame" style="flex-direction:${flexDir};border-width:${s.frameBorderPx || 3}px;border-color:${c.frame}">
          ${
            artPos !== "hidden"
              ? `<div class="uxp-art" style="flex:${artFlex};background:${c.stage};min-height:${artPos === "top" ? "90px" : "auto"}"><span style="color:${c.muted}">Art</span></div>`
              : ""
          }
          <div class="uxp-story" style="flex:${storyFlex};background:${c.panel}">
            <div class="uxp-tabs" style="color:${c.muted};border-color:${c.border}"><span style="color:${c.text};border-bottom:2px solid ${c.accent}">Story</span><span>Settings</span></div>
            ${
              s.showSpeaker !== false
                ? `<div class="uxp-speaker" style="background:${c.speakerBg};color:${c.speaker}">Narrator</div>`
                : ""
            }
            <div class="uxp-text" style="background:${c.panelInner};color:${c.textOnLight};border-radius:${s.storyRadiusPx || 8}px">You stand at the temple threshold. Moonlight pools on the stone.</div>
            <div class="uxp-choices" style="grid-template-columns:repeat(${cols},1fr)">
              <button class="uxp-choice ${s.choiceStyle || "filled"}" style="--c:${c.choice};--ch:${c.choiceHover};--a:${c.accent};--t:${c.text}">${s.showHotkeys !== false ? "<i>1</i>" : ""}Explore</button>
              <button class="uxp-choice ${s.choiceStyle || "filled"}" style="--c:${c.choice};--ch:${c.choiceHover};--a:${c.accent};--t:${c.text}">${s.showHotkeys !== false ? "<i>2</i>" : ""}Wait</button>
            </div>
            ${
              s.showHideImage !== false
                ? `<div class="uxp-utils"><button class="uxp-choice filled" style="--c:${c.choice};--ch:${c.choiceHover};--t:${c.text}">Hide Image</button></div>`
                : ""
            }
          </div>
        </div>
      </div>`;
  }

  root.querySelectorAll(".design-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".design-nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const name = btn.dataset.design;
      colorsEl.hidden = name !== "colors";
      sceneEl.hidden = name !== "scene";
      menuEl.hidden = name !== "menu";
      colorsEl.classList.toggle("active", name === "colors");
      sceneEl.classList.toggle("active", name === "scene");
      menuEl.classList.toggle("active", name === "menu");
    });
  });

  root.querySelectorAll("[data-prev]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-prev]").forEach((b) => b.classList.toggle("active", b === btn));
      previewMode = btn.dataset.prev;
      renderPreview();
    });
  });

  root.querySelector("#btn-reset-theme").addEventListener("click", () => {
    if (!confirm("Reset colors and templates to the default void-violet look?")) return;
    api.setTheme(mergeTheme(null), { dirty: true });
    api.onDirty();
    renderAll();
  });

  function renderAll() {
    renderColors();
    renderScene();
    renderMenu();
    renderPreview();
  }

  renderAll();

  return { refresh: renderAll };
}

function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = fn(v, k);
  return out;
}

/** Colors / font names bound for a style="" attribute: allow CSS-ish text only. */
const SAFE_CSS = /^[#\w\s.,%()/-]+$/;
function cssToken(value, fallback) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v || v.length > 80 || !SAFE_CSS.test(v) || /url\s*\(/i.test(v)) return fallback;
  return v;
}

/** Template ids bound for a class="" attribute. */
function cssClass(value, fallback) {
  const v = typeof value === "string" ? value.trim() : "";
  return /^[a-z][\w-]{0,40}$/i.test(v) ? v : fallback;
}

function cssNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHex(hex) {
  if (!hex) return "#000000";
  let h = String(hex).trim();
  if (/^#[0-9a-f]{3}$/i.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h;
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
