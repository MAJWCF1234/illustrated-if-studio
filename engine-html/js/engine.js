import { evalWhen } from "./conditions.js";
import {
  loadState,
  saveLeaf,
  clearPlaythrough,
  loadSeenScenes,
  saveSeenScenes,
  loadLastChoices,
  saveLastChoices,
} from "./state.js";
import { createHookTable } from "./hooks.js";
import { listSlots, loadSlot, saveSlot, clearSlot, snapshotFromState, applySnapshot } from "./saves.js";
import { AudioChannels } from "./audio.js";
import { LocaleTables } from "./locale.js";
import { LayoutMode } from "./layout-mode.js";

export class NovelEngine {
  constructor({ project, scenes, theme, assetBase, root, previewMode = false, localeTables = null, layoutMode = null }) {
    this.project = project;
    this.scenes = scenes.scenes || scenes;
    this.startId = project.start || scenes.start || "start";
    this.theme = theme;
    this.assetBase = assetBase.replace(/\/?$/, "/");
    this.root = root;
    this.previewMode = Boolean(previewMode);
    this.state = this.previewMode
      ? {
          playerName: "",
          abilities: [],
          vars: {},
          history: [],
          currentScene: this.startId,
        }
      : loadState(project.id, { start: this.startId });
    this.seenScenes = this.previewMode ? new Set() : loadSeenScenes(project.id);
    this.lastChoiceByScene = this.previewMode ? {} : loadLastChoices(project.id);
    this.hooks = createHookTable({
      getCurrentSceneId: () => this.state.currentScene,
      setSpeaker: (name) => {
        const el = root.speaker;
        el.hidden = false;
        el.textContent = name;
      },
    });
    this.audio = new AudioChannels({
      projectId: project.id,
      assetBase: this.assetBase,
      themeAudio: theme?.audio || project.audio || {},
      previewMode: this.previewMode,
    });
    this.locale =
      localeTables ||
      new LocaleTables({
        projectId: project.id,
        localesConfig: project.locales || {},
        tables: {},
        previewMode: this.previewMode,
      });
    this.layout =
      layoutMode ||
      new LayoutMode({
        projectId: project.id,
        themeMode: theme?.layout?.mode,
        projectMode: project?.meta?.layout,
        previewMode: this.previewMode,
      });
    this._toastTimer = null;
    this._skipTimer = null;
    this._mode = "play"; // play | history
    this._skipMode = false;
    this._ctrlSkip = false;
    this.applyTheme();
    this.bindUi();
    this.syncAudioControls();
    this.syncLocaleControls();
    this.syncLayoutControls();
  }

  persist(leaf, value) {
    if (this.previewMode) return;
    saveLeaf(this.project.id, leaf, value);
  }

  applyTheme() {
    const c = this.theme?.colors || {};
    const f = this.theme?.fonts || {};
    const l = this.theme?.layout || {};
    const sceneT = this.theme?.templates?.scene || {};
    const menuT = this.theme?.templates?.menu || {};
    const r = document.documentElement.style;
    if (c.bg) r.setProperty("--bg", c.bg);
    if (c.stage) r.setProperty("--stage", c.stage);
    if (c.panel) r.setProperty("--panel", c.panel);
    if (c.accent) r.setProperty("--accent", c.accent);
    if (c.accentSoft) r.setProperty("--accent-soft", c.accentSoft);
    if (c.text) r.setProperty("--text", c.text);
    if (c.muted) r.setProperty("--muted", c.muted);
    if (c.border) r.setProperty("--border", c.border);
    if (c.speaker) r.setProperty("--speaker", c.speaker);
    if (c.speakerBg) r.setProperty("--speaker-bg", c.speakerBg);
    if (c.panelInner) r.setProperty("--panel-inner", c.panelInner);
    if (c.textOnLight) r.setProperty("--text-on-light", c.textOnLight);
    if (c.frame) r.setProperty("--frame", c.frame);
    if (c.choice) r.setProperty("--choice", c.choice);
    if (c.choiceHover) r.setProperty("--choice-hover", c.choiceHover);
    if (f.display) r.setProperty("--font-display", `"${f.display}", Georgia, serif`);
    if (f.ui) r.setProperty("--font-ui", `"${f.ui}", Georgia, serif`);
    if (f.body) r.setProperty("--font-body", `"${f.body}", Georgia, serif`);
    if (l.maxWidth) r.setProperty("--max-width", `${l.maxWidth}px`);
    if (l.gameHeight) r.setProperty("--game-height", `${l.gameHeight}px`);
    if (l.stageRatio) r.setProperty("--stage-ratio", String(l.stageRatio));

    const artRatio = sceneT.artRatio ?? l.artRatio;
    if (artRatio != null) r.setProperty("--art-ratio", String(artRatio));
    if (sceneT.frameBorderPx != null) r.setProperty("--frame-border", `${sceneT.frameBorderPx}px`);
    if (sceneT.storyRadiusPx != null) r.setProperty("--story-radius", `${sceneT.storyRadiusPx}px`);
    if (sceneT.choiceColumns) r.setProperty("--choice-cols", String(sceneT.choiceColumns));

    document.body.dataset.sceneArt = sceneT.artPosition || "left";
    document.body.dataset.choiceStyle = sceneT.choiceStyle || "filled";
    document.body.dataset.gateStyle = menuT.gateStyle || "centered-card";
    document.body.dataset.menuButtons = menuT.buttonStyle || "filled";
    document.body.dataset.titleAlign = menuT.titleAlign || "center";
    document.body.dataset.settingsLayout = menuT.settingsLayout || "stack";
    document.body.dataset.showHotkeys = sceneT.showHotkeys === false ? "0" : "1";
    document.body.dataset.showSpeaker = sceneT.showSpeaker === false ? "0" : "1";
    document.body.dataset.showHideImage = sceneT.showHideImage === false ? "0" : "1";
    document.body.dataset.showBrand = menuT.showBrandMark === false ? "0" : "1";
    document.body.dataset.showByline = menuT.showByline === false ? "0" : "1";

    if (this.root.btnHideArt) {
      this.root.btnHideArt.hidden = sceneT.showHideImage === false;
    }

    this.layout?.apply(this.root);
  }

  bindUi() {
    const {
      gateForm,
      continueBtn,
      textSize,
      btnHistory,
      btnRollback,
      btnSkip,
      btnAbilities,
      btnRestart,
      abilityClose,
    } = this.root;

    gateForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = this.root.playerNameInput.value.trim();
      if (!name) return;
      this.state.playerName = name;
      this.persist( "playerName", name);
      this.audio.unlock();
      this.enterNovel(this.startId);
    });

    continueBtn.addEventListener("click", () => {
      this.audio.unlock();
      this.enterNovel(this.state.currentScene || this.startId);
    });

    textSize.addEventListener("change", () => {
      this.root.storyText.classList.remove("size-sm", "size-md", "size-lg");
      this.root.storyText.classList.add(`size-${textSize.value}`);
    });

    if (this.root.audioMute) {
      this.root.audioMute.addEventListener("change", () => {
        this.audio.setMuted(this.root.audioMute.checked);
        this.syncAudioControls();
      });
    }
    if (this.root.audioBgm) {
      this.root.audioBgm.addEventListener("input", () => {
        this.audio.setVolume("bgm", Number(this.root.audioBgm.value) / 100);
        this.syncAudioControls();
      });
    }
    if (this.root.audioSfx) {
      this.root.audioSfx.addEventListener("input", () => {
        this.audio.setVolume("sfx", Number(this.root.audioSfx.value) / 100);
        this.syncAudioControls();
      });
    }

    if (this.root.localeSelect) {
      this.root.localeSelect.addEventListener("change", () => {
        const changed = this.locale.setLocale(this.root.localeSelect.value);
        this.syncLocaleControls();
        if (changed && this._mode === "play" && this.state.currentScene && !this.root.novel.hidden) {
          this._suppressSkipOnce = true;
          this.showScene(this.state.currentScene, null, { recordHistory: false });
        }
      });
    }

    if (this.root.layoutSelect) {
      this.root.layoutSelect.addEventListener("change", () => {
        const changed = this.layout.setMode(this.root.layoutSelect.value);
        this.syncLayoutControls();
        if (changed) this.toast(`Layout: ${this.layout.getMode()}`);
      });
    }

    btnHistory.addEventListener("click", () => this.showHistory());
    if (btnRollback) btnRollback.addEventListener("click", () => this.rollback());
    if (btnSkip) {
      btnSkip.addEventListener("click", () => {
        this._skipMode = !this._skipMode;
        btnSkip.setAttribute("aria-pressed", this._skipMode ? "true" : "false");
        btnSkip.textContent = this._skipMode ? "Skip read ✓" : "Skip read";
        if (this._skipMode) this.scheduleSkipAdvance();
        else this.clearSkipTimer();
      });
    }
    btnAbilities.addEventListener("click", () => this.openAbilities(true));
    abilityClose.addEventListener("click", () => this.openAbilities(false));
    btnRestart.addEventListener("click", () => this.restart());

    document.querySelectorAll(".pane-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab;
        document.querySelectorAll(".pane-tabs .tab").forEach((t) => {
          t.classList.toggle("active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        document.querySelectorAll(".tab-panel").forEach((panel) => {
          const on = panel.id === `tab-${name}`;
          panel.hidden = !on;
          panel.classList.toggle("active", on);
        });
        if (name === "settings") this.refreshSaveSlots();
      });
    });

    this.refreshSaveSlots();

    if (this.root.btnHideArt) {
      this.root.btnHideArt.addEventListener("click", () => {
        const hidden = this.root.novel.classList.toggle("art-hidden");
        this.root.btnHideArt.textContent = hidden ? "Show Image" : "Hide Image";
        try {
          sessionStorage.setItem(`ifstudio:${this.project.id}:hideArt`, hidden ? "1" : "0");
        } catch { /* ignore */ }
      });
      try {
        const hide =
          sessionStorage.getItem(`ifstudio:${this.project.id}:hideArt`) === "1" ||
          sessionStorage.getItem(`vnstudio:${this.project.id}:hideArt`) === "1";
        if (hide) {
          this.root.novel.classList.add("art-hidden");
          this.root.btnHideArt.textContent = "Show Image";
        }
      } catch { /* ignore */ }
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Control" || e.key === "Meta") {
        this._ctrlSkip = true;
        if (!this.root.novel.hidden && this._mode === "play") this.scheduleSkipAdvance();
        return;
      }
      if (this.root.novel.hidden || this._mode !== "play") return;
      if (e.target.matches("input, textarea, select")) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        this.rollback();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const btn = this.root.choices.querySelector(`[data-hotkey="${n}"]`);
        if (btn) btn.click();
      }
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta") {
        this._ctrlSkip = false;
        if (!this._skipMode) this.clearSkipTimer();
      }
    });
    window.addEventListener("blur", () => {
      this._ctrlSkip = false;
      if (!this._skipMode) this.clearSkipTimer();
    });
  }

  isSkipActive() {
    return Boolean(this._skipMode || this._ctrlSkip);
  }

  clearSkipTimer() {
    if (this._skipTimer != null) {
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
    }
  }

  scheduleSkipAdvance() {
    this.clearSkipTimer();
    if (!this.isSkipActive() || this._mode !== "play" || this.root.novel.hidden) return;
    this._skipTimer = setTimeout(() => this.trySkipAdvance(), 120);
  }

  updateNavButtons() {
    if (this.root.btnRollback) {
      this.root.btnRollback.disabled = !this.canRollback();
    }
  }

  canRollback() {
    return Array.isArray(this.state.history) && this.state.history.length > 1;
  }

  rememberChoice(sceneId, choiceText) {
    if (!sceneId || !choiceText) return;
    this.lastChoiceByScene[sceneId] = choiceText;
    if (!this.previewMode) saveLastChoices(this.project.id, this.lastChoiceByScene);
  }

  markSeen(sceneId) {
    if (!sceneId || this.seenScenes.has(sceneId)) return;
    this.seenScenes.add(sceneId);
    if (!this.previewMode) saveSeenScenes(this.project.id, this.seenScenes);
  }

  /**
   * Soft rewind one beat: truncate history and re-show the previous scene
   * without appending a duplicate history entry (abilities/vars are not undone).
   */
  rollback() {
    if (this.root.novel.hidden || this._mode === "history") return false;
    if (!this.canRollback()) {
      this.toast("Nothing to roll back");
      return false;
    }
    this.clearSkipTimer();
    this.state.history.pop();
    const prev = this.state.history[this.state.history.length - 1];
    this.persist("history", this.state.history);
    this._suppressSkipOnce = true;
    this.showScene(prev.id, prev.choice || null, { recordHistory: false });
    this.toast("Rolled back");
    return true;
  }

  /** Auto-take a preferred or sole choice on an already-read scene. */
  trySkipAdvance() {
    this._skipTimer = null;
    if (!this.isSkipActive() || this._mode !== "play" || this.root.novel.hidden) return false;
    if (!this._lastShowWasSeen) return false;
    const sceneId = this.state.currentScene;
    const choices = (this.scenes[sceneId]?.choices || []).filter((c) => evalWhen(c.when, this.state));
    if (!choices.length) return false;
    const preferred = this.lastChoiceByScene[sceneId];
    let pick = preferred ? choices.find((c) => c.text === preferred) : null;
    if (!pick && choices.length === 1) pick = choices[0];
    if (!pick) {
      if (this._skipMode) {
        this._skipMode = false;
        if (this.root.btnSkip) {
          this.root.btnSkip.setAttribute("aria-pressed", "false");
          this.root.btnSkip.textContent = "Skip read";
        }
        this.toast("Skip stopped — choose a branch");
      }
      return false;
    }
    if (pick.set) {
      Object.assign(this.state.vars, pick.set);
      this.persist("vars", this.state.vars);
    }
    this.rememberChoice(sceneId, pick.text);
    this.showScene(pick.next, pick.text);
    return true;
  }

  async refreshSaveSlots() {
    const host = this.root.saveSlots || document.getElementById("save-slots");
    const note = this.root.saveBackendNote || document.getElementById("save-backend-note");
    if (!host || this.previewMode) {
      if (host) host.innerHTML = `<p class="settings-note">Saves disabled in preview.</p>`;
      return;
    }
    try {
      const { backend, slots } = await listSlots(this.project.id);
      if (note) {
        note.textContent =
          backend === "disk"
            ? "Slots write to the project’s saves/ folder on disk (studio server)."
            : "Slots stored in this browser (localStorage). Start the studio server for disk saves.";
      }
      const esc = (v) =>
        String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      host.innerHTML = slots
        .map((s) => {
          const title = s.empty || s.corrupt ? `Slot ${s.slot}` : s.label || `Slot ${s.slot}`;
          const summary = s.empty
            ? "Empty"
            : s.corrupt
              ? "Corrupt"
              : `${s.playerName || "—"} · ${s.currentScene || "?"}${s.updatedAt ? " · " + String(s.updatedAt).slice(0, 16).replace("T", " ") : ""}`;
          return `<div class="save-slot" data-slot="${s.slot}">
            <div class="save-slot-meta"><strong>${esc(title)}</strong><span>${esc(summary)}</span></div>
            <div class="save-slot-actions">
              <button type="button" class="btn tiny" data-act="save">Save</button>
              <button type="button" class="btn tiny" data-act="load" ${s.empty || s.corrupt ? "disabled" : ""}>Load</button>
              <button type="button" class="btn tiny" data-act="rename" ${s.empty || s.corrupt ? "disabled" : ""}>Rename</button>
              <button type="button" class="btn tiny" data-act="export" ${s.empty || s.corrupt ? "disabled" : ""}>Export</button>
              <button type="button" class="btn tiny" data-act="import">Import</button>
              <button type="button" class="btn tiny danger" data-act="clear" ${s.empty ? "disabled" : ""}>Clear</button>
            </div>
          </div>`;
        })
        .join("");
      host.querySelectorAll(".save-slot").forEach((row) => {
        const slot = Number(row.dataset.slot);
        row.querySelector('[data-act="save"]')?.addEventListener("click", () => this.writeSaveSlot(slot));
        row.querySelector('[data-act="load"]')?.addEventListener("click", () => this.readSaveSlot(slot));
        row.querySelector('[data-act="rename"]')?.addEventListener("click", () => this.renameSaveSlot(slot));
        row.querySelector('[data-act="export"]')?.addEventListener("click", () => this.exportSaveSlot(slot));
        row.querySelector('[data-act="import"]')?.addEventListener("click", () => this.importSaveSlot(slot));
        row.querySelector('[data-act="clear"]')?.addEventListener("click", () => this.eraseSaveSlot(slot));
      });
    } catch (err) {
      host.innerHTML = `<p class="settings-note">Could not load slots: ${String(err.message || err)}</p>`;
    }
  }

  async writeSaveSlot(slot) {
    if (this.previewMode) return;
    if (this.root.novel.hidden) {
      this.toast("Start playing before saving a slot.");
      return;
    }
    try {
      const suggested = (this.state.playerName ? `${this.state.playerName} — ` : "") + (this.state.currentScene || `Slot ${slot}`);
      const label = (window.prompt(`Label for slot ${slot}:`, suggested) || `Slot ${slot}`).trim() || `Slot ${slot}`;
      const snap = snapshotFromState(this.state, { label });
      const { backend } = await saveSlot(this.project.id, slot, snap);
      this.toast(`Saved slot ${slot} (${backend})`);
      await this.refreshSaveSlots();
    } catch (err) {
      this.toast(String(err.message || err));
    }
  }

  async renameSaveSlot(slot) {
    if (this.previewMode) return;
    try {
      const result = await loadSlot(this.project.id, slot);
      if (result.empty || !result.save) {
        this.toast("That slot is empty");
        return;
      }
      const next = window.prompt(`Rename slot ${slot}:`, result.save.label || `Slot ${slot}`);
      if (next == null) return;
      const label = next.trim() || `Slot ${slot}`;
      await saveSlot(this.project.id, slot, { ...result.save, label });
      this.toast(`Renamed slot ${slot}`);
      await this.refreshSaveSlots();
    } catch (err) {
      this.toast(String(err.message || err));
    }
  }

  async exportSaveSlot(slot) {
    if (this.previewMode) return;
    try {
      const result = await loadSlot(this.project.id, slot);
      if (result.empty || !result.save) {
        this.toast("That slot is empty");
        return;
      }
      const json = JSON.stringify(result.save, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (this.project.id || "save").replace(/[^a-z0-9._-]+/gi, "-");
      a.href = url;
      a.download = `${safe}-slot-${slot}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast(`Exported slot ${slot}`);
    } catch (err) {
      this.toast(String(err.message || err));
    }
  }

  async importSaveSlot(slot) {
    if (this.previewMode) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || !parsed.currentScene) {
          throw new Error("Not a valid save file");
        }
        if (!this.scenes[parsed.currentScene]) {
          throw new Error(`Save references unknown scene "${parsed.currentScene}"`);
        }
        const snap = {
          ...snapshotFromState(this.state),
          ...parsed,
          label: parsed.label || `Imported ${slot}`,
        };
        await saveSlot(this.project.id, slot, snap);
        this.toast(`Imported into slot ${slot}`);
        await this.refreshSaveSlots();
      } catch (err) {
        this.toast(`Import failed: ${String(err.message || err)}`);
      }
    });
    input.click();
  }

  async readSaveSlot(slot) {
    if (this.previewMode) return;
    try {
      const result = await loadSlot(this.project.id, slot);
      if (result.empty) {
        this.toast("That slot is empty");
        return;
      }
      applySnapshot(this.state, result.save);
      // Mirror into autosave leaves so Continue works
      this.persist("playerName", this.state.playerName);
      this.persist("currentScene", this.state.currentScene);
      this.persist("abilities", this.state.abilities);
      this.persist("vars", this.state.vars);
      this.persist("history", this.state.history);
      this.enterNovel(this.state.currentScene || this.startId);
      this.toast(`Loaded slot ${slot}`);
      await this.refreshSaveSlots();
    } catch (err) {
      this.toast(String(err.message || err));
    }
  }

  async eraseSaveSlot(slot) {
    if (this.previewMode) return;
    if (!confirm(`Clear save slot ${slot}?`)) return;
    try {
      await clearSlot(this.project.id, slot);
      this.toast(`Cleared slot ${slot}`);
      await this.refreshSaveSlots();
    } catch (err) {
      this.toast(String(err.message || err));
    }
  }

  bootGate() {
    this.root.gameTitle.textContent = this.project.title || "Untitled";
    this.root.gameAuthor.textContent = this.project.author ? `Game by ${this.project.author}` : "";
    if (this.root.brandMark) {
      this.root.brandMark.hidden = document.body.dataset.showBrand === "0";
    }
    if (this.root.gameAuthor) {
      this.root.gameAuthor.hidden = document.body.dataset.showByline === "0" || !this.project.author;
    }
    this.root.gate.hidden = false;
    this.root.novel.hidden = true;
    if (this.state.playerName) {
      this.root.playerNameInput.value = this.state.playerName;
      this.root.continueBtn.hidden = false;
    }
  }

  syncAudioControls() {
    const st = this.audio.status();
    if (this.root.audioMute) this.root.audioMute.checked = st.muted;
    if (this.root.audioBgm) this.root.audioBgm.value = String(Math.round(st.volumes.bgm * 100));
    if (this.root.audioSfx) this.root.audioSfx.value = String(Math.round(st.volumes.sfx * 100));
    if (this.root.audioBgmVal) this.root.audioBgmVal.textContent = `${Math.round(st.volumes.bgm * 100)}%`;
    if (this.root.audioSfxVal) this.root.audioSfxVal.textContent = `${Math.round(st.volumes.sfx * 100)}%`;
  }

  syncLocaleControls() {
    const panel = this.root.localePanel;
    const select = this.root.localeSelect;
    if (!panel || !select) return;
    const enabled = this.locale.enabled();
    panel.hidden = !enabled;
    if (!enabled) return;
    const current = this.locale.getLocaleId();
    select.innerHTML = "";
    for (const entry of this.locale.listAvailable()) {
      const opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = entry.label;
      if (entry.id === current) opt.selected = true;
      select.appendChild(opt);
    }
    document.documentElement.lang = current || "en";
  }

  syncLayoutControls() {
    this.layout.apply(this.root);
    const select = this.root.layoutSelect;
    const note = this.root.layoutNote;
    if (select) {
      const current = this.layout.getMode();
      select.innerHTML = "";
      for (const entry of this.layout.listModes()) {
        const opt = document.createElement("option");
        opt.value = entry.id;
        opt.textContent = entry.label;
        if (entry.id === current) opt.selected = true;
        select.appendChild(opt);
      }
    }
    if (note) {
      const entry = this.layout.listModes().find((m) => m.id === this.layout.getMode());
      const def = this.layout.getDefaultMode();
      note.textContent = entry
        ? `${entry.note}. Theme default: ${def}.`
        : `Theme default: ${def}.`;
    }
  }

  enterNovel(sceneId) {
    this.root.gate.hidden = true;
    this.root.novel.hidden = false;
    this.showScene(sceneId);
  }

  interpolate(text) {
    return String(text || "").replace(/\[NAME\]/g, this.state.playerName || "Traveler");
  }

  assetUrl(folder, file) {
    if (!file) return null;
    return `${this.assetBase}${folder}/${file}`;
  }

  setSprite(el, file) {
    if (!file) {
      el.hidden = true;
      el.classList.remove("active");
      el.removeAttribute("src");
      return;
    }
    el.hidden = false;
    el.classList.remove("active");
    el.onload = () => {
      void el.offsetWidth;
      el.classList.add("active");
    };
    el.onerror = () => {
      el.hidden = true;
      el.classList.remove("active");
    };
    el.src = this.assetUrl("characters", file);
  }

  setBackground(file) {
    const img = this.root.stageBg;
    img.classList.remove("visible");
    const fallback = this.assetUrl("scene_images", "default.svg");
    const target = this.assetUrl("scene_images", file || "default.svg") || fallback;
    img.onerror = () => {
      if (img.src !== fallback) {
        img.src = fallback;
      } else {
        img.classList.add("visible");
      }
    };
    img.onload = () => img.classList.add("visible");
    img.src = target;
  }

  unlockAbility(name) {
    if (!name || this.state.abilities.includes(name)) return;
    this.state.abilities.push(name);
    this.persist( "abilities", this.state.abilities);
    this.toast(`Ability unlocked: ${name}`);
    if (!this.root.abilityMenu.hidden) this.renderAbilityList();
  }

  toast(msg) {
    const el = this.root.toast;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  pushHistory(id, choice) {
    const last = this.state.history[this.state.history.length - 1];
    if (!last || last.id !== id || last.choice !== choice) {
      this.state.history.push({ id, choice: choice || null });
      this.persist( "history", this.state.history);
    }
  }

  showScene(key, selectedChoice = null, opts = {}) {
    const recordHistory = opts.recordHistory !== false;
    this._mode = "play";
    this._lastShowWasSeen = this.seenScenes.has(key);
    this.state.currentScene = key;
    this.persist( "currentScene", key);
    if (recordHistory) this.pushHistory(key, selectedChoice);

    const scene = this.scenes[key];
    const box = this.root.choices;
    box.innerHTML = "";

    if (!scene || !scene.text) {
      this.root.speaker.hidden = true;
      this.root.storyText.textContent = `Error: Scene "${key}" is missing or incomplete.`;
      this.setSprite(this.root.spriteLeft, null);
      this.setSprite(this.root.spriteRight, null);
      this.setBackground("default.svg");
      this.markSeen(key);
      this.updateNavButtons();
      return;
    }

    if (scene.unlockAbility) this.unlockAbility(scene.unlockAbility);
    if (scene.set) {
      Object.assign(this.state.vars, scene.set);
      this.persist( "vars", this.state.vars);
    }

    this.setBackground(scene.sceneImage);
    this.setSprite(this.root.spriteLeft, scene.characterLeft);
    this.setSprite(this.root.spriteRight, scene.characterRight);
    this.audio.applyScene(scene, { useDefaultBgm: true });

    const display = this.locale.resolveDisplay(scene);
    const showSpeaker = document.body.dataset.showSpeaker !== "0";
    if (showSpeaker && display.speaker) {
      this.root.speaker.hidden = false;
      this.root.speaker.textContent = this.interpolate(display.speaker);
    } else {
      this.root.speaker.hidden = true;
    }

    this.root.storyText.textContent = this.interpolate(display.text);
    this.root.storyText.scrollTop = 0;

    const hookName = scene.hooks?.onEnter;
    if (hookName && typeof this.hooks[hookName] === "function") {
      this.hooks[hookName]();
    }

    const showHotkeys = document.body.dataset.showHotkeys !== "0";
    const cols = Math.max(1, Number(getComputedStyle(document.documentElement).getPropertyValue("--choice-cols")) || 2);
    const choices = (scene.choices || []).filter((c) => evalWhen(c.when, this.state));
    if (choices.length) {
      choices.forEach((choice, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "choice";
        btn.dataset.hotkey = String(i + 1);
        const baseIndex = (scene.choices || []).indexOf(choice);
        const label =
          (baseIndex >= 0 ? display.choiceTexts[baseIndex] : null) || choice.text || "";
        if (showHotkeys) {
          const hot = document.createElement("span");
          hot.className = "hotkey";
          hot.textContent = `${i + 1}`;
          btn.appendChild(hot);
          btn.appendChild(document.createTextNode(" "));
        }
        btn.appendChild(document.createTextNode(label));
        btn.addEventListener("click", () => {
          this.clearSkipTimer();
          if (choice.set) {
            Object.assign(this.state.vars, choice.set);
            this.persist( "vars", this.state.vars);
          }
          this.rememberChoice(key, choice.text);
          this.showScene(choice.next, choice.text);
        });
        box.appendChild(btn);
      });
      while (box.children.length % cols !== 0) {
        const slot = document.createElement("div");
        slot.className = "choice-slot";
        slot.setAttribute("aria-hidden", "true");
        box.appendChild(slot);
      }
    } else {
      const note = document.createElement("p");
      note.className = "end-note";
      note.textContent = "The story path ends here for now.";
      box.appendChild(note);
    }

    this.markSeen(key);
    this.updateNavButtons();
    if (this._suppressSkipOnce) {
      this._suppressSkipOnce = false;
    } else if (this._lastShowWasSeen && this.isSkipActive()) {
      this.scheduleSkipAdvance();
    }
  }

  showHistory() {
    this._mode = "history";
    this.root.speaker.hidden = true;
    this.setSprite(this.root.spriteLeft, null);
    this.setSprite(this.root.spriteRight, null);
    this.setBackground("default.svg");
    this.root.storyText.textContent = "Your path so far:";
    const box = this.root.choices;
    box.innerHTML = "";

    this.state.history.forEach((entry, index) => {
      const scene = this.scenes[entry.id];
      if (!scene) return;
      const item = document.createElement("div");
      item.className = "history-item";
      const title = document.createElement("strong");
      title.textContent = `Scene: ${entry.id}`;
      item.appendChild(title);
      const snippet = document.createElement("p");
      const histDisp = this.locale.resolveDisplay(scene);
      snippet.textContent = `${(histDisp.text || "").slice(0, 80).replace(/\s+/g, " ")}…`;
      item.appendChild(snippet);
      if (entry.choice) {
        const ch = document.createElement("p");
        let choiceLabel = entry.choice;
        const idx = (scene.choices || []).findIndex((c) => c.text === entry.choice);
        if (idx >= 0 && histDisp.choiceTexts[idx]) choiceLabel = histDisp.choiceTexts[idx];
        ch.textContent = `Your choice: “${choiceLabel}”`;
        item.appendChild(ch);
      }
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "btn utility";
      jump.textContent = "Return to this point";
      jump.addEventListener("click", () => {
        this.state.history = this.state.history.slice(0, index + 1);
        this.persist( "history", this.state.history);
        this._suppressSkipOnce = true;
        this.showScene(entry.id, entry.choice || null, { recordHistory: false });
      });
      item.appendChild(jump);
      box.appendChild(item);
    });

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn utility";
    back.textContent = "Back to current scene";
    back.addEventListener("click", () =>
      this.showScene(this.state.currentScene, null, { recordHistory: false })
    );
    box.appendChild(back);
    this.updateNavButtons();
  }

  renderAbilityList() {
    const catalog = this._abilityCatalog || {};
    const ul = this.root.abilityList;
    ul.innerHTML = "";
    if (!this.state.abilities.length) {
      ul.innerHTML = "<li>No abilities learned yet.</li>";
      return;
    }
    this.state.abilities.forEach((id) => {
      const li = document.createElement("li");
      const meta = catalog[id];
      li.textContent = meta?.name || id;
      if (meta?.description) {
        const tip = document.createElement("div");
        tip.style.color = "var(--muted)";
        tip.style.fontSize = "0.8em";
        tip.textContent = meta.description;
        li.appendChild(tip);
      }
      ul.appendChild(li);
    });
  }

  setAbilityCatalog(list) {
    this._abilityCatalog = Object.fromEntries((list || []).map((a) => [a.id, a]));
  }

  openAbilities(open) {
    this.root.abilityMenu.hidden = !open;
    if (open) this.renderAbilityList();
  }

  restart() {
    const keep = Boolean(this.project.meta?.keepAbilitiesOnRestart);
    this.audio.stopBgm();
    if (this.previewMode) {
      this.state = {
        playerName: this.state.playerName || "",
        abilities: keep ? [...(this.state.abilities || [])] : [],
        vars: {},
        history: [],
        currentScene: this.startId,
      };
      this.root.abilityMenu.hidden = true;
      this.root.novel.hidden = false;
      this.root.gate.hidden = true;
      this.showScene(this.startId);
      return;
    }
    this.state = clearPlaythrough(this.project.id, { keepAbilities: keep });
    this.root.playerNameInput.value = "";
    this.root.continueBtn.hidden = true;
    this.root.abilityMenu.hidden = true;
    this.root.novel.hidden = true;
    this.root.gate.hidden = false;
  }
}
