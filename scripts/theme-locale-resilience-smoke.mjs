#!/usr/bin/env node
/**
 * Resilience smoke: broken theme / locale / audio data must degrade, not brick.
 *
 * Covers the failures found while stress-testing those three systems:
 *  - a corrupt or missing theme.json used to abort player boot (studio *and* export),
 *    leaving a perfectly good story stuck on "Loading…";
 *  - project.locales.available that is not a list threw "is not iterable" out of
 *    validateProject, so /api/validate returned 500 and every export was blocked;
 *  - out-of-range theme numbers (negative layout.gameHeight) collapsed the game frame
 *    to 0px — the player "worked" but nothing was on screen;
 *  - theme strings were interpolated raw into the editor Design preview's innerHTML,
 *    so an imported theme could run script in the editor origin.
 *
 * Runs against a throwaway project; sample-project is never touched.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateProject } from "../server/lib/validate.mjs";
import { exportHtml } from "../server/exporters/html.mjs";
import { removeDir } from "../server/lib/fs-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const projectId = "zz-resilience-smoke";
const projectDir = path.join(studioRoot, "projects", projectId);
const outRoot = path.join(studioRoot, "dist");
const port = Number(process.env.RESILIENCE_PORT) || 8811;
const pkgPort = Number(process.env.RESILIENCE_PKG_PORT) || 18811;
const base = `http://127.0.0.1:${port}`;

const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

const PROJECT = {
  formatVersion: 1,
  id: projectId,
  title: "Resilience Smoke",
  author: "Smoke",
  start: "start",
  story: { scenes: "story/scenes.json", scripts: "story/scripts.json" },
  theme: "theme/theme.json",
  locales: {
    default: "en",
    available: [
      { id: "en", label: "English" },
      { id: "es", label: "Espanol", file: "story/locales/es.json" },
    ],
  },
  meta: { artOptional: true },
};

const SCENES = {
  formatVersion: 1,
  start: "start",
  scenes: {
    start: {
      id: "start",
      text: "The lantern gutters. A corridor runs north.",
      bgm: "missing-track.mp3",
      sfx: "missing-cue.wav",
      choices: [{ text: "Go north", next: "north" }],
    },
    north: { id: "north", text: "A cold room, and the way back.", choices: [{ text: "Return", next: "start" }] },
  },
};

const THEME = {
  id: "smoke",
  fonts: { display: "MedievalSharp", ui: "Cinzel", body: "Literata" },
  colors: { bg: "#050208", accent: "#a855f7", text: "#f3e8ff" },
  layout: { mode: "illustrated-if", artRatio: 0.62, maxWidth: 1100, gameHeight: 620 },
  audio: { enabled: true, defaultBgm: null, channels: { bgm: { volume: 0.5 }, sfx: { volume: 0.5 } } },
  templates: { scene: {}, menu: {} },
};

const F = {
  project: path.join(projectDir, "project.json"),
  scenes: path.join(projectDir, "story", "scenes.json"),
  theme: path.join(projectDir, "theme", "theme.json"),
  es: path.join(projectDir, "story", "locales", "es.json"),
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/** Minimal valid silent WAV so the autoplay check exercises a real, loadable track. */
function writeSilentWav(dest) {
  const sampleRate = 8000;
  const samples = 8000;
  const buf = Buffer.alloc(44 + samples);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples, 40);
  buf.fill(128, 44);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

function buildProject() {
  removeDir(projectDir);
  writeJson(F.project, PROJECT);
  writeJson(F.scenes, SCENES);
  writeJson(F.theme, THEME);
  writeJson(F.es, { scenes: { start: { text: "El farol parpadea.", choices: ["Ir al norte"] } } });
  writeSilentWav(path.join(projectDir, "assets", "audio", "silence.wav"));
  fs.mkdirSync(path.join(projectDir, "assets", "scene_images"), { recursive: true });
}

function startStudio() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(studioRoot, "server", "index.mjs")], {
      cwd: studioRoot,
      env: { ...process.env, PORT: String(port), IF_PROJECT: projectDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (b) => {
      if (!ready && b.toString().includes("Player")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (c) => !ready && reject(new Error(`studio server exited early: ${c}`)));
    setTimeout(() => !ready && reject(new Error("studio server start timeout")), 15000);
  });
}

function startPackaged(webDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(webDir, "start-server.mjs")], {
      cwd: webDir,
      env: { ...process.env, PORT: String(pkgPort), NO_BROWSER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (b) => {
      if (!ready && b.toString().includes("Play at")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (c) => !ready && reject(new Error(`packaged server exited early: ${c}`)));
    setTimeout(() => !ready && reject(new Error("packaged server start timeout")), 12000);
  });
}

/** Boot the player at `url`, walk past the gate, and report what the player made of it. */
async function playThrough(browser, url, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction(() => Boolean(window.__ifEngine), { timeout: 15000 }).catch(() => {});
    const boot = await page.evaluate(() => {
      const el = document.getElementById("boot-error");
      return {
        engine: Boolean(window.__ifEngine),
        bootError: el && !el.hidden ? el.textContent.slice(0, 160) : null,
      };
    });
    if (!boot.engine) {
      bug(`${label}: player never booted (boot-error: ${boot.bootError})`);
      return { pageErrors, ...boot };
    }
    await page.fill("#player-name", "Smoke");
    await page.click('#gate-form button[type="submit"]');
    await page.waitForSelector("#novel:not([hidden])", { timeout: 8000 });
    await page.waitForTimeout(500);
    const play = await page.evaluate(() => {
      const novel = document.getElementById("novel");
      const rect = novel.getBoundingClientRect();
      return {
        scene: window.__ifEngine.state.currentScene,
        storyLen: (document.getElementById("story-text")?.textContent || "").length,
        choices: document.querySelectorAll("#choices .choice").length,
        frame: { w: Math.round(rect.width), h: Math.round(rect.height) },
        audio: window.__ifEngine.audio.status(),
        locale: window.__ifEngine.locale.status(),
      };
    });
    if (pageErrors.length) bug(`${label}: pageerror ${pageErrors.join(" | ").slice(0, 200)}`);
    if (!play.storyLen) bug(`${label}: story text is empty`);
    if (!play.choices) bug(`${label}: no choices rendered`);
    if (play.frame.h < 200 || play.frame.w < 200) {
      bug(`${label}: game frame collapsed to ${play.frame.w}x${play.frame.h}`);
    }
    return { pageErrors, ...boot, ...play };
  } finally {
    await ctx.close();
  }
}

buildProject();
let studio;
let browser;
try {
  studio = await startStudio();
  browser = await chromium.launch({ headless: true });

  // 1. Corrupt theme.json — decoration is broken, the story is not.
  writeJson(F.theme, '{ "colors": { "bg": "#111", } not json');
  let r = await playThrough(browser, `${base}/engine-html/`, "corrupt theme");
  console.log(`corrupt theme      -> scene=${r.scene} story=${r.storyLen} frame=${r.frame?.h}px`);

  // 2. Missing theme.json entirely.
  fs.rmSync(F.theme);
  r = await playThrough(browser, `${base}/engine-html/`, "missing theme");
  console.log(`missing theme      -> scene=${r.scene} story=${r.storyLen} frame=${r.frame?.h}px`);
  writeJson(F.theme, THEME);

  // 3. Out-of-range theme numbers must not collapse the frame.
  writeJson(F.theme, { ...THEME, layout: { ...THEME.layout, gameHeight: -5, maxWidth: -1, artRatio: 1e10 } });
  r = await playThrough(browser, `${base}/engine-html/`, "negative layout numbers");
  console.log(`negative layout    -> frame=${r.frame?.w}x${r.frame?.h}`);
  writeJson(F.theme, THEME);

  // 4. locales.available that is not a list: validate + export + player must survive.
  writeJson(F.project, { ...PROJECT, locales: { default: "en", available: { es: { id: "es", label: "E" } } } });
  let report;
  try {
    report = validateProject(projectDir);
  } catch (err) {
    bug(`validateProject threw on non-array locales.available: ${err.message || err}`);
    report = { ok: false, warnings: [] };
  }
  if (report && !report.ok) bug(`validate should still pass: ${(report.errors || []).join("; ")}`);
  if (report?.ok && !(report.warnings || []).some((w) => /locales\.available/.test(w))) {
    bug("non-array locales.available should produce a warning");
  }
  const validateRes = await fetch(`${base}/api/validate`, { method: "POST" });
  if (validateRes.status !== 200) bug(`/api/validate returned ${validateRes.status} for non-array locales.available`);
  r = await playThrough(browser, `${base}/engine-html/`, "non-array locales.available");
  console.log(`bad locales list   -> scene=${r.scene} locales=${JSON.stringify(r.locale?.available)}`);

  // 5. That same project must still export, and the package must still boot.
  let exported;
  try {
    exported = exportHtml({ studioRoot, projectDir, outRoot });
  } catch (err) {
    bug(`exportHtml threw on non-array locales.available: ${err.message || err}`);
  }
  if (exported && !exported.ok) bug(`html export failed: ${(exported.errors || []).join("; ")}`);
  if (exported?.ok) {
    // Corrupt the theme inside the package too — the shipped game must still play.
    writeJson(path.join(exported.folder, "project", "theme", "theme.json"), "{{{ broken");
    const pkg = await startPackaged(exported.folder);
    try {
      r = await playThrough(browser, `http://127.0.0.1:${pkgPort}/`, "packaged + corrupt theme");
      console.log(`packaged package   -> scene=${r.scene} story=${r.storyLen} frame=${r.frame?.h}px`);
    } finally {
      pkg.kill();
    }
  }
  writeJson(F.project, PROJECT);

  // 6. Missing audio files must settle, not hang, and must not stop the story.
  r = await playThrough(browser, `${base}/engine-html/`, "missing audio");
  if (r.audio?.bgmStatus === "loading") bug("missing BGM stuck in loading");
  if (r.audio?.bgmFile) bug(`missing BGM should clear bgmFile, got ${r.audio.bgmFile}`);
  console.log(`missing audio      -> bgm=${r.audio?.bgmStatus} sfx=${r.audio?.sfxStatus}`);

  // 7. Autoplay refusal must land on "blocked" and recover on the next user gesture.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const real = HTMLMediaElement.prototype.play;
      window.__allowPlay = false;
      HTMLMediaElement.prototype.play = function () {
        if (!window.__allowPlay) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
        return real.call(this);
      };
    });
    await page.goto(`${base}/engine-html/?preview=1&name=Smoke`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__ifEngine?.audio), { timeout: 15000 });
    const blocked = await page.evaluate(async () => {
      const audio = window.__ifEngine.audio;
      audio.playBgm("silence.wav");
      await new Promise((r) => setTimeout(r, 500));
      return { ...audio.status(), paused: audio._bgm ? audio._bgm.paused : null };
    });
    if (blocked.bgmStatus === "loading") bug("autoplay-blocked BGM stuck in loading");
    if (blocked.bgmStatus !== "blocked" && blocked.bgmStatus !== "playing") {
      bug(`autoplay-blocked BGM should report blocked, got ${blocked.bgmStatus}`);
    }
    if (blocked.paused === false) bug("BGM reported as playing while the browser refused play()");
    const recovered = await page.evaluate(async () => {
      window.__allowPlay = true;
      window.__ifEngine.audio.unlock();
      await new Promise((r) => setTimeout(r, 500));
      const audio = window.__ifEngine.audio;
      return { ...audio.status(), paused: audio._bgm ? audio._bgm.paused : null };
    });
    if (recovered.bgmStatus === "blocked") bug("BGM did not recover after unlock() on a user gesture");
    if (recovered.paused !== false) bug(`BGM element still paused after unlock(), paused=${recovered.paused}`);
    console.log(`autoplay blocked   -> ${blocked.bgmStatus} then ${recovered.bgmStatus}`);
    const storyAlive = await page.evaluate(
      () => (document.getElementById("story-text")?.textContent || "").length
    );
    if (!storyAlive) bug("story text lost while audio was blocked");
    await ctx.close();
  }

  // 8. Editor Design preview must not execute markup carried in theme values.
  writeJson(F.theme, {
    ...THEME,
    colors: { ...THEME.colors, bg: '#000"><img src=x onerror="window.__xssFired=1">', accent: '#111" onmouseover="window.__xssFired=1' },
    fonts: { ...THEME.fonts, ui: 'serif"><img src=y onerror="window.__xssFired=1">' },
    templates: {
      scene: { artPosition: 'left"><img src=z onerror="window.__xssFired=1">' },
      menu: { gateStyle: 'centered-card"><img src=q onerror="window.__xssFired=1">' },
    },
  });
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const editorErrors = [];
    page.on("pageerror", (e) => editorErrors.push(String(e.message || e)));
    await page.goto(`${base}/editor-web/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#mode-design", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click("#mode-design");
    await page.waitForTimeout(600);
    await page.click('[data-prev="menu"]').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('[data-prev="scene"]').catch(() => {});
    await page.waitForTimeout(300);
    const editor = await page.evaluate(() => ({
      xss: window.__xssFired === 1,
      injected: document.querySelectorAll('#ux-preview img, #ux-preview script').length,
      previewRendered: (document.getElementById("ux-preview")?.children.length || 0) > 0,
      colorFields: document.querySelectorAll("#design-colors [data-color]").length,
    }));
    if (editor.xss) bug("editor Design preview executed markup from theme values (XSS)");
    if (editor.injected) bug(`editor Design preview injected ${editor.injected} element(s) from theme values`);
    if (!editor.previewRendered) bug("editor Design preview failed to render with hostile theme values");
    if (!editor.colorFields) bug("editor Design color fields failed to render with hostile theme values");
    if (editorErrors.length) bug(`editor pageerror: ${editorErrors.join(" | ").slice(0, 200)}`);
    console.log(`editor preview     -> xss=${editor.xss} injected=${editor.injected} fields=${editor.colorFields}`);
    await ctx.close();
  }
  writeJson(F.theme, THEME);
} catch (err) {
  bug(String(err.stack || err.message || err));
} finally {
  if (browser) await browser.close();
  if (studio) studio.kill("SIGTERM");
  removeDir(projectDir);
  removeDir(path.join(outRoot, `${projectId}-web`));
  try {
    fs.rmSync(path.join(outRoot, `${projectId}-web.zip`), { force: true });
  } catch {
    /* nothing to clean */
  }
}

console.log("\nResilience smoke bugs:", bugs.length);
for (const b of bugs) console.log("-", b);
process.exit(bugs.length ? 1 : 0);
