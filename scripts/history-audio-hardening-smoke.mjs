#!/usr/bin/env node
/**
 * Hardening smoke for history panel + audio volume edge cases fixed in the
 * history/locale/audio stress pass:
 *  - corrupt history entries (null / non-objects) used to throw out of
 *    showHistory (`entry.id`) and rollback (`prev.id`);
 *  - non-finite channel volumes (NaN / Infinity) used to throw when assigned
 *    to HTMLMediaElement.volume during playBgm / _applyVolumes.
 *
 * Owns a locked IF_PROJECT sample-project server. Does not write project files.
 */
import { chromium } from "playwright";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.HISTORY_AUDIO_PORT) || 8828;
const base = `http://127.0.0.1:${port}`;
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("OK:", m);

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(studioRoot, "server", "index.mjs")], {
      cwd: studioRoot,
      env: {
        ...process.env,
        PORT: String(port),
        IF_PROJECT: path.join(studioRoot, "projects", "sample-project"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf) => {
      if (!ready && buf.toString().includes("Player")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server exited early: ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("server start timeout"));
    }, 10000);
  });
}

const server = await startServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));

try {
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle", timeout: 20000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Hardening");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.waitForFunction(() => Boolean(window.__ifEngine));

  // Corrupt history must not crash History / Back
  const hist = await page.evaluate(() => {
    const eng = window.__ifEngine;
    const out = [];
    for (const bad of [[null, { id: "start", choice: null }], ["start"], "nope"]) {
      let threwShow = null;
      let threwRoll = null;
      eng.state.history = bad;
      eng._mode = "play";
      eng.root.novel.hidden = false;
      try {
        eng.showHistory();
      } catch (e) {
        threwShow = e.message;
      }
      eng.state.history = Array.isArray(bad) ? bad : [null, { id: "start" }];
      eng._mode = "play";
      try {
        eng.rollback();
      } catch (e) {
        threwRoll = e.message;
      }
      out.push({
        bad: JSON.stringify(bad).slice(0, 48),
        threwShow,
        threwRoll,
        histLen: Array.isArray(eng.state.history) ? eng.state.history.length : -1,
      });
    }
    // Boot-path: poison localStorage then reload sanitizes
    localStorage.setItem(
      "ifstudio:sample-project:history",
      JSON.stringify([null, { id: "start", choice: null }, { foo: 1 }])
    );
    return out;
  });
  for (const row of hist) {
    if (row.threwShow) bug(`showHistory threw on ${row.bad}: ${row.threwShow}`);
    if (row.threwRoll) bug(`rollback threw on ${row.bad}: ${row.threwRoll}`);
  }
  if (!hist.some((r) => r.threwShow || r.threwRoll)) ok("corrupt history shapes sanitized");

  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Hardening");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  const afterBoot = await page.evaluate(() => {
    const eng = window.__ifEngine;
    let threw = null;
    try {
      eng.showHistory();
    } catch (e) {
      threw = e.message;
    }
    return { threw, hist: eng.state.history, mode: eng._mode };
  });
  if (afterBoot.threw) bug(`boot with corrupt history crashed showHistory: ${afterBoot.threw}`);
  if (!Array.isArray(afterBoot.hist) || afterBoot.hist.some((h) => !h?.id)) {
    bug(`boot history not sanitized: ${JSON.stringify(afterBoot.hist)}`);
  } else ok(`boot sanitized history → ${JSON.stringify(afterBoot.hist)}`);

  // Happy path jump still works
  await page.evaluate(() => {
    const eng = window.__ifEngine;
    eng.showScene("start");
    eng.showScene("workshop", "Step into the workshop");
    eng.showScene("archive", "Read the notes on the wall");
  });
  await page.click("#btn-history");
  await page.locator("#choices button.utility", { hasText: "Return to this point" }).first().click();
  const jumped = await page.evaluate(() => ({
    scene: window.__ifEngine.state.currentScene,
    histLen: window.__ifEngine.state.history.length,
    mode: window.__ifEngine._mode,
  }));
  if (jumped.scene !== "start" || jumped.histLen !== 1 || jumped.mode !== "play") {
    bug(`history jump broken: ${JSON.stringify(jumped)}`);
  } else ok("history jump to start");

  // Non-finite volumes must not throw on apply / play
  const audio = await page.evaluate(async () => {
    const audio = window.__ifEngine.audio;
    let threw = null;
    try {
      audio.volumes.bgm = NaN;
      audio.volumes.sfx = Infinity;
      audio._applyVolumes();
      audio.playBgm("definitely-missing-track.mp3");
      await new Promise((r) => setTimeout(r, 80));
      audio.defaultBgm = "also-missing-default.mp3";
      audio._bgmFile = null;
      audio.applyScene({}, { useDefaultBgm: true });
      await new Promise((r) => setTimeout(r, 80));
    } catch (e) {
      threw = e.message;
    }
    return { threw, vols: { ...audio.volumes }, status: audio.status().bgmStatus };
  });
  if (audio.threw) bug(`non-finite volumes crashed: ${audio.threw}`);
  if (!Number.isFinite(audio.vols.bgm) || !Number.isFinite(audio.vols.sfx)) {
    bug(`volumes still non-finite: ${JSON.stringify(audio.vols)}`);
  } else ok(`volumes reclamped bgm=${audio.vols.bgm} sfx=${audio.vols.sfx}`);

  // Preview Loading regression check
  await page.goto(`${base}/engine-html/?preview=1&scene=start&name=Author`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => Boolean(window.__ifEngine));
  const preview = await page.evaluate(() => ({
    title: document.getElementById("game-title")?.textContent,
    body: document.getElementById("story-text")?.textContent?.slice(0, 30),
  }));
  if (/Loading/i.test(preview.title || "")) bug(`preview stuck Loading: ${preview.title}`);
  else ok(`preview title=${preview.title}`);
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

console.log("---");
if (bugs.length) {
  console.log(`FAILED (${bugs.length})`);
  for (const b of bugs) console.log(" -", b);
  process.exitCode = 1;
} else {
  console.log("PASS");
}
