/**
 * Phase 4 smoke: HTML audio channels (BGM + SFX) with missing-file no-op + mute prefs.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PHASE4_AUDIO_PORT) || 8797;
const base = `http://127.0.0.1:${port}`;
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

/** Minimal valid silent WAV (mono 8-bit, ~0.1s). */
function writeSilentWav(dest) {
  const sampleRate = 8000;
  const samples = 800;
  const dataSize = samples;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(128, 44);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}

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

const audioDir = path.join(studioRoot, "projects", "sample-project", "assets", "audio");
const silencePath = path.join(audioDir, "smoke-silence.wav");
writeSilentWav(silencePath);

const server = await startServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));

try {
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Listener");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.waitForFunction(() => Boolean(window.__ifEngine?.audio));

  // Missing file must not throw; status becomes missing / idle
  const missing = await page.evaluate(async () => {
    const audio = window.__ifEngine.audio;
    audio.playBgm("definitely-missing-track.mp3");
    await new Promise((r) => setTimeout(r, 200));
    return audio.status();
  });
  if (missing.bgmStatus !== "missing" && missing.bgmFile) {
    bug(`missing BGM should clear file; status=${missing.bgmStatus} file=${missing.bgmFile}`);
  }
  if (missing.bgmStatus !== "missing" && missing.bgmStatus !== "idle" && missing.bgmStatus !== "stopped") {
    // After error handler, status is missing and file cleared — accept missing or stopped
    if (missing.bgmStatus === "loading") bug("missing BGM stuck in loading");
  }
  console.log("Missing BGM status:", missing.bgmStatus, "file:", missing.bgmFile);

  // Real silence file should load (may be blocked in headless — still not a crash)
  const played = await page.evaluate(async () => {
    const audio = window.__ifEngine.audio;
    audio.unlock();
    audio.playBgm("smoke-silence.wav");
    await new Promise((r) => setTimeout(r, 350));
    const before = audio.status();
    audio.playSfx("smoke-silence.wav");
    await new Promise((r) => setTimeout(r, 200));
    return { before, after: audio.status() };
  });
  const okBgm =
    played.before.bgmFile === "smoke-silence.wav" ||
    ["playing", "loading", "blocked"].includes(played.before.bgmStatus);
  if (!okBgm && played.before.bgmStatus === "missing") {
    bug("smoke-silence.wav reported missing — is assets/audio served?");
  }
  console.log("BGM after silence:", played.before.bgmStatus, played.before.bgmFile);
  console.log("SFX status:", played.after.sfxStatus);

  // Same file should not clear status
  const same = await page.evaluate(() => {
    const audio = window.__ifEngine.audio;
    audio.playBgm("smoke-silence.wav");
    return audio.status().bgmFile;
  });
  if (same !== "smoke-silence.wav" && played.before.bgmFile === "smoke-silence.wav") {
    bug("re-play same BGM cleared file");
  }

  // Stop token
  const stopped = await page.evaluate(() => {
    window.__ifEngine.audio.playBgm("none");
    return window.__ifEngine.audio.status();
  });
  if (stopped.bgmFile != null) bug("playBgm('none') should clear bgmFile");
  if (stopped.bgmStatus !== "stopped") bug(`expected stopped, got ${stopped.bgmStatus}`);

  // Settings UI mute + volume
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.waitForSelector("#audio-panel");
  await page.check("#audio-mute");
  const muted = await page.evaluate(() => window.__ifEngine.audio.status().muted);
  if (!muted) bug("Mute checkbox did not mute audio channel");

  await page.uncheck("#audio-mute");
  await page.fill("#audio-bgm", "40");
  await page.dispatchEvent("#audio-bgm", "input");
  const vol = await page.evaluate(() => window.__ifEngine.audio.status().volumes.bgm);
  if (Math.abs(vol - 0.4) > 0.02) bug(`BGM volume expected ~0.4, got ${vol}`);

  const prefs = await page.evaluate(() => {
    const raw = localStorage.getItem("ifstudio:sample-project:audioPrefs");
    return raw ? JSON.parse(raw) : null;
  });
  if (!prefs || Math.abs(prefs.bgm - 0.4) > 0.02) bug(`audioPrefs not persisted: ${JSON.stringify(prefs)}`);

  // applyScene omit keeps BGM; explicit null stops
  const sceneLogic = await page.evaluate(() => {
    const audio = window.__ifEngine.audio;
    audio.playBgm("smoke-silence.wav");
    audio.applyScene({}); // omit
    const kept = audio.status().bgmFile;
    audio.applyScene({ bgm: null });
    const afterNull = audio.status();
    return { kept, afterNull };
  });
  if (sceneLogic.kept !== "smoke-silence.wav") bug("omit bgm should keep current track");
  if (sceneLogic.afterNull.bgmFile != null) bug("bgm:null should stop");

  console.log("Phase4 audio smoke OK");
} catch (err) {
  bug(String(err.message || err));
} finally {
  await browser.close();
  server.kill("SIGTERM");
  try {
    fs.unlinkSync(silencePath);
  } catch {
    /* leave fixture if locked */
  }
}

console.log("\nPhase4 audio smoke bugs:", bugs.length);
for (const b of bugs) console.log("-", b);
process.exit(bugs.length ? 1 : 0);
