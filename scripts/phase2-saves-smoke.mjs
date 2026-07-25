/**
 * Phase 2 smoke: disk save slots API + player Settings UI.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

// Pin the sample project so saves land in a deterministic, game-agnostic folder.
await fetch(`${base}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
}).catch(() => {});

const savesPath = path.join(studioRoot, "projects", "sample-project", "saves");
fs.rmSync(savesPath, { recursive: true, force: true });

const list0 = await fetch(`${base}/api/saves`);
const list0j = await list0.json();
console.log("List empty-ish:", list0.status, list0j.slots?.filter((s) => !s.empty).length);
if (!list0.ok) bug("GET /api/saves failed");

const put = await fetch(`${base}/api/saves/2`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    save: {
      playerName: "SlotTester",
      currentScene: "look_around",
      abilities: ["curiosity"],
      vars: {},
      history: [],
      label: "Smoke",
    },
  }),
});
const putj = await put.json();
console.log("PUT slot 2:", put.status, putj.ok, putj.save?.currentScene);
if (!put.ok) bug("PUT save failed");

const get = await fetch(`${base}/api/saves/2`);
const getj = await get.json();
if (getj.save?.playerName !== "SlotTester") bug("GET save mismatch");

const onDisk = path.join(savesPath, "slot-2.json");
if (!fs.existsSync(onDisk)) bug("slot-2.json not written to disk");
else console.log("Disk file OK:", onDisk);

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
  await page.fill("#player-name", "UI Tester");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.waitForSelector("#save-slots .save-slot");
  const note = await page.locator("#save-backend-note").innerText();
  console.log("Backend note:", note);
  if (!/disk/i.test(note)) bug("Expected disk backend note: " + note);

  await page.locator('.save-slot[data-slot="1"] [data-act="save"]').click();
  await page.waitForTimeout(400);
  if (!fs.existsSync(path.join(savesPath, "slot-1.json"))) bug("UI save did not write slot-1.json");

  await page.locator('.save-slot[data-slot="2"] [data-act="load"]').click();
  await page.waitForTimeout(500);
  const speakerOrText = await page.locator("#story-text").innerText();
  console.log("After load slot 2:", speakerOrText.slice(0, 80).replace(/\s+/g, " "));
  if (!/voice|friendly|editable/i.test(speakerOrText)) {
    bug("Load slot 2 did not land on look_around content");
  }
} finally {
  await browser.close();
  fs.rmSync(savesPath, { recursive: true, force: true });
}

console.log("\nPhase2 saves smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
