/**
 * Locale overlay tables for the HTML player.
 * Display-only: choice next/when/save keys stay on the default-language text.
 */

import { saveLeaf, storageKey } from "./state.js";

function readPrefs(projectId) {
  try {
    const raw = localStorage.getItem(storageKey(projectId, "localePrefs"));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

export class LocaleTables {
  /**
   * @param {{
   *   projectId: string,
   *   localesConfig?: object,
   *   tables?: Record<string, object>,
   *   previewMode?: boolean,
   * }} opts
   */
  constructor({ projectId, localesConfig = {}, tables = {}, previewMode = false }) {
    this.projectId = projectId;
    this.previewMode = Boolean(previewMode);
    this.defaultId = String(localesConfig.default || "en");
    this.available = Array.isArray(localesConfig.available)
      ? localesConfig.available
          .filter((e) => e && e.id && e.label)
          .map((e) => ({
            id: String(e.id),
            label: String(e.label),
            file: e.file ? String(e.file) : null,
          }))
      : [];
    this.tables = tables && typeof tables === "object" ? { ...tables } : {};

    const prefs = this.previewMode ? null : readPrefs(projectId);
    const preferred = prefs?.locale ? String(prefs.locale) : null;
    this.localeId = this._resolveInitial(preferred);
  }

  _resolveInitial(preferred) {
    if (preferred && this._isKnown(preferred)) return preferred;
    if (this._isKnown(this.defaultId)) return this.defaultId;
    if (this.available.length) return this.available[0].id;
    return this.defaultId;
  }

  _isKnown(id) {
    if (!id) return false;
    if (id === this.defaultId) return true;
    return this.available.some((e) => e.id === id);
  }

  enabled() {
    return this.available.length > 0;
  }

  listAvailable() {
    return this.available.map((e) => ({ id: e.id, label: e.label }));
  }

  getLocaleId() {
    return this.localeId;
  }

  persistPrefs() {
    if (this.previewMode) return;
    saveLeaf(this.projectId, "localePrefs", { locale: this.localeId });
  }

  /**
   * @param {string} id
   * @returns {boolean} true if locale changed
   */
  setLocale(id) {
    const next = String(id || "").trim();
    if (!next || !this._isKnown(next) || next === this.localeId) return false;
    this.localeId = next;
    this.persistPrefs();
    return true;
  }

  overlayFor(localeId = this.localeId) {
    if (!localeId || localeId === this.defaultId) return null;
    const table = this.tables[localeId];
    if (!table || typeof table !== "object" || Array.isArray(table)) return null;
    return table;
  }

  /**
   * Resolve display strings for a scene. Logic fields stay on the base scene.
   * @param {object} scene
   * @returns {{ text: string, speaker: string|null|undefined, choiceTexts: string[], localeId: string, overlayed: boolean }}
   */
  resolveDisplay(scene) {
    const baseText = scene?.text ?? "";
    const baseSpeaker = scene?.speaker;
    const baseChoices = scene?.choices || [];
    const choiceTexts = baseChoices.map((c) => c?.text || "");
    const overlay = this.overlayFor();
    const entry = overlay?.scenes?.[scene?.id];
    if (!entry) {
      return {
        text: baseText,
        speaker: baseSpeaker,
        choiceTexts,
        localeId: this.localeId,
        overlayed: false,
      };
    }

    let text = baseText;
    if (typeof entry.text === "string" && entry.text.length) text = entry.text;

    let speaker = baseSpeaker;
    if (Object.prototype.hasOwnProperty.call(entry, "speaker")) {
      speaker = entry.speaker;
    }

    if (Array.isArray(entry.choices)) {
      entry.choices.forEach((label, i) => {
        if (i < choiceTexts.length && typeof label === "string" && label.length) {
          choiceTexts[i] = label;
        }
      });
    }

    return {
      text,
      speaker,
      choiceTexts,
      localeId: this.localeId,
      overlayed: true,
    };
  }

  status() {
    return {
      enabled: this.enabled(),
      localeId: this.localeId,
      defaultId: this.defaultId,
      available: this.listAvailable(),
      loadedOverlays: Object.keys(this.tables),
    };
  }
}
