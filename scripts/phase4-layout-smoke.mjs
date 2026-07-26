/**
 * Phase 4 smoke: Classic ADV / NVL layout modes + Settings presentation picker.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PHASE4_LAYOUT_PORT) || 8799;
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
  await page.fill("#player-name", "LayoutTester");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.waitForFunction(() => Boolean(window.__ifEngine?.layout));

  const initial = await page.evaluate(() => {
    const engine = window.__ifEngine;
    const novel = document.getElementById("novel");
    return {
      mode: engine.layout.getMode(),
      defaultMode: engine.layout.getDefaultMode(),
      bodyClass: document.body.className,
      bodyData: document.body.dataset.layoutMode,
      novelHasIf: novel?.classList.contains("illustrated-if"),
      novelHasAdv: novel?.classList.contains("classic-adv"),
      status: engine.layout.status(),
    };
  });
  if (initial.mode !== "illustrated-if") bug(`default mode should be illustrated-if, got ${initial.mode}`);
  if (initial.defaultMode !== "illustrated-if") bug(`theme default should be illustrated-if, got ${initial.defaultMode}`);
  if (!initial.novelHasIf) bug("novel missing illustrated-if class");
  if (initial.novelHasAdv) bug("novel unexpectedly has classic-adv");
  if (initial.bodyData !== "illustrated-if") bug(`body data-layout-mode wrong: ${initial.bodyData}`);
  if (!/\blayout-illustrated-if\b/.test(initial.bodyClass)) bug(`body missing layout-illustrated-if: ${initial.bodyClass}`);
  console.log("Default illustrated-if OK");

  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.waitForSelector("#layout-panel:not([hidden])");
  await page.selectOption("#layout-select", "classic-adv");
  await page.waitForFunction(() => window.__ifEngine.layout.getMode() === "classic-adv");

  const adv = await page.evaluate(() => {
    const novel = document.getElementById("novel");
    const story = novel?.querySelector(".story-pane");
    const art = novel?.querySelector(".art-pane");
    const csStory = story ? getComputedStyle(story) : null;
    const csArt = art ? getComputedStyle(art) : null;
    return {
      mode: window.__ifEngine.layout.getMode(),
      novelHasAdv: novel?.classList.contains("classic-adv"),
      bodyData: document.body.dataset.layoutMode,
      prefs: JSON.parse(localStorage.getItem("ifstudio:sample-project:layoutPrefs") || "null"),
      storyPos: csStory?.position,
      artPos: csArt?.position,
      scene: window.__ifEngine.state.currentScene,
    };
  });
  if (adv.mode !== "classic-adv") bug(`ADV mode not applied: ${adv.mode}`);
  if (!adv.novelHasAdv) bug("novel missing classic-adv class");
  if (adv.bodyData !== "classic-adv") bug(`body data-layout-mode not classic-adv: ${adv.bodyData}`);
  if (adv.prefs?.mode !== "classic-adv") bug(`layoutPrefs not persisted: ${JSON.stringify(adv.prefs)}`);
  if (adv.storyPos !== "absolute") bug(`ADV story-pane should be absolute, got ${adv.storyPos}`);
  if (adv.artPos !== "absolute") bug(`ADV art-pane should be absolute, got ${adv.artPos}`);
  if (adv.scene !== "start") bug(`layout switch advanced scene to ${adv.scene}`);
  console.log("Classic ADV OK");

  await page.selectOption("#layout-select", "classic-nvl");
  await page.waitForFunction(() => window.__ifEngine.layout.getMode() === "classic-nvl");

  const nvl = await page.evaluate(() => {
    const novel = document.getElementById("novel");
    const story = novel?.querySelector(".story-pane");
    const csStory = story ? getComputedStyle(story) : null;
    return {
      mode: window.__ifEngine.layout.getMode(),
      novelHasNvl: novel?.classList.contains("classic-nvl"),
      bodyData: document.body.dataset.layoutMode,
      prefs: JSON.parse(localStorage.getItem("ifstudio:sample-project:layoutPrefs") || "null"),
      storyPos: csStory?.position,
      storyInset: csStory ? `${csStory.top}/${csStory.right}/${csStory.bottom}/${csStory.left}` : null,
    };
  });
  if (nvl.mode !== "classic-nvl") bug(`NVL mode not applied: ${nvl.mode}`);
  if (!nvl.novelHasNvl) bug("novel missing classic-nvl class");
  if (nvl.bodyData !== "classic-nvl") bug(`body data-layout-mode not classic-nvl: ${nvl.bodyData}`);
  if (nvl.prefs?.mode !== "classic-nvl") bug(`layoutPrefs NVL not persisted: ${JSON.stringify(nvl.prefs)}`);
  if (nvl.storyPos !== "absolute") bug(`NVL story-pane should be absolute, got ${nvl.storyPos}`);
  console.log("Classic NVL OK");

  // Story + choices still render under NVL
  await page.click('.pane-tabs .tab[data-tab="story"]');
  const playable = await page.evaluate(() => {
    const body = document.getElementById("story-text")?.textContent || "";
    const choices = document.querySelectorAll("#choices .choice").length;
    return { body: body.slice(0, 40), choices };
  });
  if (!/sample project|tiny demo/i.test(playable.body)) bug(`NVL story text missing: ${playable.body}`);
  if (playable.choices < 1) bug("NVL choices missing");
  console.log("NVL playable OK:", playable.body);

  // Restore default
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.selectOption("#layout-select", "illustrated-if");
  await page.waitForFunction(() => window.__ifEngine.layout.getMode() === "illustrated-if");
  const restored = await page.evaluate(() => {
    const novel = document.getElementById("novel");
    const story = novel?.querySelector(".story-pane");
    return {
      mode: window.__ifEngine.layout.getMode(),
      novelHasIf: novel?.classList.contains("illustrated-if"),
      storyPos: story ? getComputedStyle(story).position : null,
      prefs: JSON.parse(localStorage.getItem("ifstudio:sample-project:layoutPrefs") || "null"),
    };
  });
  if (!restored.novelHasIf) bug("restore failed — missing illustrated-if");
  if (restored.prefs?.mode !== "illustrated-if") bug(`restore prefs wrong: ${JSON.stringify(restored.prefs)}`);
  if (restored.storyPos === "absolute") bug("illustrated-if story-pane should not stay absolute");
  console.log("Restore illustrated-if OK");

  // Preference survives reload
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "LayoutTester");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.waitForFunction(() => Boolean(window.__ifEngine?.layout));
  // After restore we saved illustrated-if — flip to ADV then reload to prove persistence
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.selectOption("#layout-select", "classic-adv");
  await page.waitForFunction(() => window.__ifEngine.layout.getMode() === "classic-adv");
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#continue-btn");
  await page.waitForSelector("#novel:not([hidden])");
  await page.waitForFunction(() => Boolean(window.__ifEngine?.layout));
  const afterReload = await page.evaluate(() => ({
    mode: window.__ifEngine.layout.getMode(),
    novelHasAdv: document.getElementById("novel")?.classList.contains("classic-adv"),
  }));
  if (afterReload.mode !== "classic-adv" || !afterReload.novelHasAdv) {
    bug(`layout pref did not survive reload: ${JSON.stringify(afterReload)}`);
  }
  console.log("Layout pref survives reload OK");

  console.log("Phase4 layout smoke OK");
} catch (err) {
  bug(String(err.message || err));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

console.log("\nPhase4 layout smoke bugs:", bugs.length);
for (const b of bugs) console.log("-", b);
process.exit(bugs.length ? 1 : 0);
