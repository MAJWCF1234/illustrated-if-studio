/**
 * BGM (looping) + SFX (one-shot) channels for the HTML player.
 * Missing files and autoplay blocks are soft no-ops — story still plays.
 */

import { saveLeaf, storageKey } from "./state.js";

const STOP_TOKENS = new Set(["", "none", "stop", "off", "null"]);

function clamp01(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function isStopToken(value) {
  if (value === false || value == null) return true;
  return STOP_TOKENS.has(String(value).trim().toLowerCase());
}

function readPrefs(projectId) {
  try {
    const raw = localStorage.getItem(storageKey(projectId, "audioPrefs"));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

export class AudioChannels {
  /**
   * @param {{ projectId: string, assetBase: string, themeAudio?: object, previewMode?: boolean }} opts
   */
  constructor({ projectId, assetBase, themeAudio = {}, previewMode = false }) {
    this.projectId = projectId;
    this.assetBase = assetBase.replace(/\/?$/, "/");
    this.previewMode = Boolean(previewMode);
    this.enabled = themeAudio.enabled !== false;

    const ch = themeAudio.channels || {};
    const prefs = this.previewMode ? null : readPrefs(projectId);

    this.volumes = {
      bgm: clamp01(prefs?.bgm ?? ch.bgm?.volume, 0.55),
      sfx: clamp01(prefs?.sfx ?? ch.sfx?.volume, 0.75),
    };
    this.muted = Boolean(prefs?.muted);
    this.defaultBgm = themeAudio.defaultBgm || null;

    this._bgm = null;
    this._bgmFile = null;
    this._bgmStatus = "idle"; // idle | loading | playing | missing | blocked | stopped
    this._sfxStatus = "idle";
    this._unlocked = false;
  }

  assetUrl(file) {
    if (!file) return null;
    return `${this.assetBase}audio/${encodeURIComponent(file)}`;
  }

  persistPrefs() {
    if (this.previewMode) return;
    saveLeaf(this.projectId, "audioPrefs", {
      bgm: this.volumes.bgm,
      sfx: this.volumes.sfx,
      muted: this.muted,
    });
  }

  /** Call from a user gesture so browsers allow playback. */
  unlock() {
    this._unlocked = true;
    if (this._bgm && this._bgm.paused && this._bgmFile && !this.muted && this.enabled) {
      this._bgm.play().catch(() => {
        this._bgmStatus = "blocked";
      });
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.persistPrefs();
    this._applyVolumes();
    if (this.muted) {
      if (this._bgm) this._bgm.pause();
    } else if (this._bgm && this._bgmFile && this.enabled) {
      this._bgm.play().catch(() => {
        this._bgmStatus = "blocked";
      });
    }
  }

  setVolume(channel, value) {
    if (channel !== "bgm" && channel !== "sfx") return;
    this.volumes[channel] = clamp01(value, this.volumes[channel]);
    this.persistPrefs();
    this._applyVolumes();
  }

  _applyVolumes() {
    // HTMLMediaElement.volume throws if the value is non-finite — keep channels
    // clamped even if prefs/theme were poisoned after construction.
    this.volumes.bgm = clamp01(this.volumes.bgm, 0.55);
    this.volumes.sfx = clamp01(this.volumes.sfx, 0.75);
    const master = this.muted || !this.enabled ? 0 : 1;
    if (this._bgm) {
      try {
        this._bgm.volume = this.volumes.bgm * master;
      } catch {
        /* ignore */
      }
    }
  }

  _effectiveVolume(channel) {
    if (this.muted || !this.enabled) return 0;
    const fallback = channel === "sfx" ? 0.75 : 0.55;
    return clamp01(this.volumes[channel], fallback);
  }

  status() {
    return {
      enabled: this.enabled,
      muted: this.muted,
      volumes: { ...this.volumes },
      bgmFile: this._bgmFile,
      bgmStatus: this._bgmStatus,
      sfxStatus: this._sfxStatus,
      unlocked: this._unlocked,
    };
  }

  stopBgm() {
    if (this._bgm) {
      try {
        this._bgm.pause();
        this._bgm.removeAttribute("src");
        this._bgm.load();
      } catch {
        /* ignore */
      }
      this._bgm = null;
    }
    this._bgmFile = null;
    this._bgmStatus = "stopped";
  }

  /**
   * Play or keep looping BGM. Same file → no restart.
   * Pass null / "" / "none" / false to stop.
   * @param {string|null|false|undefined} file
   */
  playBgm(file) {
    if (!this.enabled) {
      this._bgmStatus = "idle";
      return;
    }
    if (file === undefined) return;
    if (isStopToken(file)) {
      this.stopBgm();
      return;
    }
    const name = String(file).trim();
    if (!name) {
      this.stopBgm();
      return;
    }
    if (this._bgmFile === name && this._bgm) {
      this._applyVolumes();
      if (!this.muted && this._bgm.paused) {
        this._bgm.play().catch(() => {
          this._bgmStatus = "blocked";
        });
      }
      return;
    }

    this.stopBgm();
    this._bgmFile = name;
    this._bgmStatus = "loading";

    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.volume = this._effectiveVolume("bgm");
    this._bgm = el;

    const url = this.assetUrl(name);
    el.addEventListener(
      "error",
      () => {
        if (this._bgm === el) {
          this._bgmStatus = "missing";
          this._bgm = null;
          this._bgmFile = null;
        }
      },
      { once: true }
    );
    el.addEventListener(
      "canplay",
      () => {
        if (this._bgm === el) this._bgmStatus = "playing";
      },
      { once: true }
    );

    el.src = url;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        if (this._bgm === el) this._bgmStatus = "blocked";
      });
    }
  }

  /**
   * One-shot SFX. Missing file → no-op.
   * @param {string|null|undefined} file
   */
  playSfx(file) {
    if (!this.enabled || this.muted) {
      this._sfxStatus = "idle";
      return;
    }
    if (file == null || isStopToken(file)) {
      this._sfxStatus = "idle";
      return;
    }
    const name = String(file).trim();
    if (!name) {
      this._sfxStatus = "idle";
      return;
    }

    this._sfxStatus = "loading";
    const el = new Audio();
    el.preload = "auto";
    el.volume = this._effectiveVolume("sfx");
    el.addEventListener(
      "error",
      () => {
        this._sfxStatus = "missing";
      },
      { once: true }
    );
    el.addEventListener(
      "play",
      () => {
        this._sfxStatus = "playing";
      },
      { once: true }
    );
    el.src = this.assetUrl(name);
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        this._sfxStatus = "blocked";
      });
    }
  }

  /**
   * Apply scene audio cues. Omitted bgm keeps current track.
   * @param {{ bgm?: string|null|false, sfx?: string|null }} scene
   * @param {{ useDefaultBgm?: boolean }} [opts]
   */
  applyScene(scene, opts = {}) {
    if (!scene) return;
    if (Object.prototype.hasOwnProperty.call(scene, "bgm")) {
      this.playBgm(scene.bgm);
    } else if (opts.useDefaultBgm && this.defaultBgm && !this._bgmFile) {
      this.playBgm(this.defaultBgm);
    }
    if (scene.sfx) this.playSfx(scene.sfx);
  }

  dispose() {
    this.stopBgm();
    this._sfxStatus = "idle";
  }
}
