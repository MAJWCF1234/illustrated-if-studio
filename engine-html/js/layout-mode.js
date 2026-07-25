/**
 * Player layout presentation modes for the HTML engine.
 * Project/theme default stays illustrated-if; Settings can override (persisted).
 */

import { saveLeaf, storageKey } from "./state.js";

export const LAYOUT_MODES = [
  {
    id: "illustrated-if",
    label: "Illustrated IF (default)",
    note: "Art panel beside story and actions",
  },
  {
    id: "classic-adv",
    label: "Classic ADV",
    note: "Full-bleed art with a bottom dialogue box",
  },
  {
    id: "classic-nvl",
    label: "Classic NVL",
    note: "Full-bleed art with a large text overlay",
  },
];

const MODE_IDS = new Set(LAYOUT_MODES.map((m) => m.id));

const ALIASES = {
  adv: "classic-adv",
  "classic_adv": "classic-adv",
  nvl: "classic-nvl",
  "classic_nvl": "classic-nvl",
  "sectioned-novel": "illustrated-if",
  sectioned: "illustrated-if",
};

function readPrefs(projectId) {
  try {
    const raw = localStorage.getItem(storageKey(projectId, "layoutPrefs"));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

export function normalizeLayoutMode(value, fallback = "illustrated-if") {
  if (value == null || value === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  const mapped = ALIASES[raw] || raw;
  return MODE_IDS.has(mapped) ? mapped : fallback;
}

export class LayoutMode {
  /**
   * @param {{
   *   projectId: string,
   *   themeMode?: string,
   *   projectMode?: string,
   *   previewMode?: boolean,
   * }} opts
   */
  constructor({ projectId, themeMode, projectMode, previewMode = false }) {
    this.projectId = projectId;
    this.previewMode = Boolean(previewMode);
    this.defaultMode = normalizeLayoutMode(
      themeMode || projectMode || "illustrated-if",
      "illustrated-if"
    );
    const prefs = this.previewMode ? null : readPrefs(projectId);
    const preferred = prefs?.mode != null ? normalizeLayoutMode(prefs.mode, null) : null;
    this.mode = preferred && MODE_IDS.has(preferred) ? preferred : this.defaultMode;
  }

  listModes() {
    return LAYOUT_MODES.map((m) => ({ ...m }));
  }

  getMode() {
    return this.mode;
  }

  getDefaultMode() {
    return this.defaultMode;
  }

  persistPrefs() {
    if (this.previewMode) return;
    saveLeaf(this.projectId, "layoutPrefs", { mode: this.mode });
  }

  /**
   * @param {string} id
   * @returns {boolean} true if mode changed
   */
  setMode(id) {
    const next = normalizeLayoutMode(id, null);
    if (!next || !MODE_IDS.has(next) || next === this.mode) return false;
    this.mode = next;
    this.persistPrefs();
    return true;
  }

  /**
   * Apply CSS classes / data attributes to the live DOM.
   * @param {{ novel?: HTMLElement|null }} root
   */
  apply(root = {}) {
    const mode = this.mode;
    const body = document.body;
    body.classList.remove("layout-illustrated-if", "layout-classic-adv", "layout-classic-nvl");
    body.classList.add(`layout-${mode}`);
    body.dataset.layoutMode = mode;

    const novel = root.novel || document.getElementById("novel");
    if (novel) {
      novel.classList.remove("illustrated-if", "classic-adv", "classic-nvl");
      novel.classList.add(mode);
    }
  }

  status() {
    return {
      mode: this.mode,
      defaultMode: this.defaultMode,
      overridden: this.mode !== this.defaultMode,
    };
  }
}
