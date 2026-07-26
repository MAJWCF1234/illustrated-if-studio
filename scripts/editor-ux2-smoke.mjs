/**
 * Smoke for rename-on-switch, filtered +Scene, preview toggle unload,
 * save-slot overwrite confirm, and CLI export all --dest.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const SCRATCH = "zz-editor-ux2";
const DEST = path.join(root, "dist", "zz-cli-export-all-dest");
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("ok  ", m);

async function api(method, urlPath, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function cleanup() {
  await api("PUT", "/api/settings", { activeProjectId: "sample-project" });
  fs.rmSync(path.join(root, "projects", SCRATCH), { recursive: true, force: true });
  fs.rmSync(DEST, { recursive: true, force: true });
  const saves = path.join(root, "projects", "sample-project", "saves");
  fs.rmSync(saves, { recursive: true, force: true });
}

async function main() {
  const health = await api("GET", "/api/health");
  if (!health.ok) throw new Error("Studio down");
  await cleanup();

  await api("POST", "/api/projects", {
    title: "Editor UX2",
    projectId: SCRATCH,
    activate: true,
    overwrite: true,
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => bug("pageerror: " + e.message));
  page.on("dialog", async (d) => d.accept());

  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene-list li");

  // ── Rename survives click-away ──────────────────────────────
  await page.locator('#scene-list li[data-id="start"]').dispatchEvent("pointerdown");
  await page.click('[data-insp="story"]');
  await page.fill("#f-id", "opening_beat");
  await page.locator('#scene-list li[data-id="look_around"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(300);
  await page.click("#btn-save");
  await page.waitForTimeout(500);
  const proj = await api("GET", "/api/project");
  const sceneIds = Object.keys(proj.data.scenes?.scenes || proj.data.scenes || {});
  if (!sceneIds.includes("opening_beat")) bug(`rename lost on switch; ids=${sceneIds.join(",")}`);
  else if (sceneIds.includes("start")) bug("old start id still present after rename");
  else ok("rename commits when switching scenes");

  // Ctrl+S without blur
  await page.locator('#scene-list li[data-id="opening_beat"]').dispatchEvent("pointerdown");
  await page.fill("#f-id", "intro");
  await page.click("#btn-save");
  await page.waitForTimeout(500);
  const proj2 = await api("GET", "/api/project");
  const ids2 = Object.keys(proj2.data.scenes?.scenes || proj2.data.scenes || {});
  if (!ids2.includes("intro")) bug(`rename lost on save-without-blur; ids=${ids2.join(",")}`);
  else ok("rename commits on Save without leaving the field");

  // ── + Scene clears filter ───────────────────────────────────
  await page.fill("#scene-filter", "intro");
  await page.waitForTimeout(100);
  await page.click("#btn-add");
  await page.waitForTimeout(200);
  const filterVal = await page.inputValue("#scene-filter");
  const listIds = await page.evaluate(() =>
    [...document.querySelectorAll("#scene-list li")].map((li) => li.dataset.id)
  );
  const selected = await page.inputValue("#f-id");
  if (filterVal !== "") bug(`filter not cleared after + Scene: "${filterVal}"`);
  else if (!listIds.includes(selected)) bug(`new scene ${selected} not visible in list`);
  else ok(`+ Scene cleared filter and shows ${selected}`);

  // ── Preview toggle unloads iframe ───────────────────────────
  await page.click("#btn-preview-toggle");
  await page.waitForSelector("#preview-dock:not([hidden])");
  await page.waitForTimeout(800);
  const srcOpen = await page.getAttribute("#preview-frame", "src");
  await page.click("#btn-preview-toggle");
  await page.waitForTimeout(200);
  const afterToggle = await page.evaluate(() => ({
    hidden: document.getElementById("preview-dock")?.hidden,
    src: document.getElementById("preview-frame")?.getAttribute("src") || "",
  }));
  if (!afterToggle.hidden) bug("preview dock still visible after toggle");
  else if (!/about:blank/i.test(afterToggle.src) && afterToggle.src === srcOpen) {
    bug(`preview iframe still loaded after toggle: ${afterToggle.src}`);
  } else ok("preview toggle unloads iframe");

  // ── Save slot overwrite confirms ────────────────────────────
  await api("PUT", "/api/settings", { activeProjectId: "sample-project" });
  await api("PUT", "/api/saves/1", {
    save: {
      playerName: "Alice",
      currentScene: "archive",
      abilities: [],
      vars: {},
      history: [],
      label: "Alice 3-hour run",
    },
  });
  page.removeAllListeners("dialog");
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    await d.dismiss();
  });
  await page.goto(`${BASE}/engine-html/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Bob");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.waitForSelector("#save-slots .save-slot");
  await page.locator('.save-slot[data-slot="1"] [data-act="save"]').click();
  await page.waitForTimeout(400);
  const overwriteAsk = dialogs.find((d) => /overwrite/i.test(d.message));
  if (!overwriteAsk) bug(`no overwrite confirm; dialogs=${JSON.stringify(dialogs)}`);
  else ok("occupied save slot asks before overwrite");
  const stillAlice = await api("GET", "/api/saves/1");
  if (stillAlice.data?.save?.label !== "Alice 3-hour run") {
    bug("dismissed overwrite still replaced Alice save");
  } else ok("dismissing overwrite leaves prior save intact");

  // ── CLI export all --dest ───────────────────────────────────
  fs.mkdirSync(DEST, { recursive: true });
  await api("PUT", "/api/settings", { activeProjectId: "sample-project", exportDestination: "" });
  page.removeAllListeners("dialog");
  page.on("dialog", async (d) => d.accept());
  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.click("#mode-cli");
  await page.waitForSelector("#workspace-cli:not([hidden])");
  await page.fill("#cli-input", `export all --dest ${DEST}`);
  await page.click('#cli-form button[type="submit"]');
  await page.waitForTimeout(8000);
  const cliText = await page.locator("#cli-out").innerText();
  const kids = fs.existsSync(DEST) ? fs.readdirSync(DEST) : [];
  const hitDest = kids.some((k) => /sample-project/i.test(k));
  if (!hitDest) {
    bug(`export all --dest ignored; dest kids=${kids.join(",")} cli=${cliText.slice(-300)}`);
  } else ok(`export all --dest wrote under ${path.basename(DEST)} (${kids.join(", ")})`);

  await browser.close();
  await cleanup();
  console.log("\nEditor UX2 bugs:", bugs.length);
  if (bugs.length) process.exitCode = 1;
  else console.log("PASS: editor-ux2-smoke");
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
});
