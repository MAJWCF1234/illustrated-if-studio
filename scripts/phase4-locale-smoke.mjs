/**
 * Phase 4 smoke: locale JSON overlays + Settings language picker + fallback.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PHASE4_LOCALE_PORT) || 8798;
const base = `http://127.0.0.1:${port}`;
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

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
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Viajero");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.waitForFunction(() => Boolean(window.__ifEngine?.locale));

  const enStart = await page.evaluate(() => {
    const engine = window.__ifEngine;
    const scene = engine.scenes.start;
    const disp = engine.locale.resolveDisplay(scene);
    return {
      localeId: engine.locale.getLocaleId(),
      textStart: (disp.text || "").slice(0, 24),
      choice0: disp.choiceTexts[0],
      status: engine.locale.status(),
      body: document.getElementById("story-text")?.textContent?.slice(0, 24) || "",
      btn0: document.querySelector("#choices .choice")?.textContent?.replace(/^\d+\s*/, "").trim() || "",
    };
  });
  if (enStart.localeId !== "en") bug(`expected default locale en, got ${enStart.localeId}`);
  if (!/Welcome|Sample Project/i.test(enStart.body)) bug(`English start body missing: ${enStart.body}`);
  if (!/Step into the workshop/i.test(enStart.btn0)) bug(`English choice missing: ${enStart.btn0}`);
  if (!enStart.status.loadedOverlays.includes("es")) bug("es overlay not loaded");
  console.log("EN start OK:", enStart.body);

  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.waitForSelector("#locale-panel:not([hidden])");
  await page.selectOption("#locale-select", "es");
  await page.waitForFunction(() => window.__ifEngine.locale.getLocaleId() === "es");

  // Language change should land back on story text without advancing
  const esStart = await page.evaluate(() => {
    const engine = window.__ifEngine;
    const scene = engine.scenes.start;
    const disp = engine.locale.resolveDisplay(scene);
    // ensure story tab visible for DOM check
    document.querySelector('.pane-tabs .tab[data-tab="story"]')?.click();
    return {
      localeId: engine.locale.getLocaleId(),
      currentScene: engine.state.currentScene,
      text: disp.text.slice(0, 40),
      choice0: disp.choiceTexts[0],
      body: document.getElementById("story-text")?.textContent?.slice(0, 40) || "",
      btn0: document.querySelector("#choices .choice")?.textContent?.replace(/^\d+\s*/, "").trim() || "",
      lang: document.documentElement.lang,
      prefs: JSON.parse(localStorage.getItem("ifstudio:sample-project:localePrefs") || "null"),
    };
  });
  if (esStart.localeId !== "es") bug(`locale not es after picker: ${esStart.localeId}`);
  if (esStart.currentScene !== "start") bug(`locale switch advanced scene to ${esStart.currentScene}`);
  if (!/Bienvenido/i.test(esStart.body)) bug(`Spanish body not shown: ${esStart.body}`);
  if (!/Entrar al taller/i.test(esStart.btn0)) bug(`Spanish choice not shown: ${esStart.btn0}`);
  if (esStart.lang !== "es") bug(`html lang not es: ${esStart.lang}`);
  if (esStart.prefs?.locale !== "es") bug(`localePrefs not persisted: ${JSON.stringify(esStart.prefs)}`);
  console.log("ES start OK:", esStart.body);

  // Fallback: scene without overlay stays English
  const fallback = await page.evaluate(() => {
    const engine = window.__ifEngine;
    const scene = engine.scenes.archive;
    if (!scene) return { missing: true };
    const disp = engine.locale.resolveDisplay(scene);
    return {
      missing: false,
      overlayed: disp.overlayed,
      textStart: (disp.text || "").slice(0, 30),
    };
  });
  if (fallback.missing) bug("archive scene missing from project");
  else if (fallback.overlayed) bug("archive should fall back (no es overlay)");
  else if (!fallback.textStart) bug("archive fallback text empty");
  console.log("Fallback OK:", fallback.textStart);

  // Choosing a Spanish-labeled button still uses English choice key for logic
  await page.click('.pane-tabs .tab[data-tab="story"]');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("#choices .choice")].find((b) =>
      /Mirar a tu alrededor/i.test(b.textContent || "")
    );
    if (btn) btn.click();
  });
  await page.waitForFunction(() => window.__ifEngine.state.currentScene === "look_around");
  const afterChoice = await page.evaluate(() => {
    const engine = window.__ifEngine;
    const last = engine.lastChoiceByScene?.start;
    const disp = engine.locale.resolveDisplay(engine.scenes.look_around);
    return {
      last,
      speaker: document.getElementById("speaker")?.textContent || "",
      body: document.getElementById("story-text")?.textContent?.slice(0, 30) || "",
      choiceKeyOk: last === "Look around",
      overlayed: disp.overlayed,
    };
  });
  if (!afterChoice.choiceKeyOk) {
    bug(`expected remembered choice "Look around", got ${JSON.stringify(afterChoice.last)}`);
  }
  if (!/Una voz amable/i.test(afterChoice.body)) bug(`look_around ES body missing: ${afterChoice.body}`);
  if (!/Guía/i.test(afterChoice.speaker)) bug(`look_around ES speaker missing: ${afterChoice.speaker}`);
  console.log("Choice key + look_around ES OK");

  // Switch back to English
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.selectOption("#locale-select", "en");
  await page.waitForFunction(() => window.__ifEngine.locale.getLocaleId() === "en");
  const backEn = await page.evaluate(() => {
    document.querySelector('.pane-tabs .tab[data-tab="story"]')?.click();
    return {
      body: document.getElementById("story-text")?.textContent?.slice(0, 30) || "",
      speaker: document.getElementById("speaker")?.textContent || "",
    };
  });
  if (!/friendly voice/i.test(backEn.body)) bug(`EN restore failed: ${backEn.body}`);
  if (!/Guide/i.test(backEn.speaker)) bug(`EN speaker restore failed: ${backEn.speaker}`);

  console.log("Phase4 locale smoke OK");
} catch (err) {
  bug(String(err.message || err));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

console.log("\nPhase4 locale smoke bugs:", bugs.length);
for (const b of bugs) console.log("-", b);
process.exit(bugs.length ? 1 : 0);
