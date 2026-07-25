import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
function bug(m) {
  bugs.push(m);
  console.log("BUG:", m);
}

// Pin the sample project so the probe is game-agnostic.
await fetch(`${base}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
}).catch(() => {});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Ability-gated path via fixture steps
await page.goto(`${base}/engine-html/?preview=1&name=Parity&scene=start`, { waitUntil: "networkidle" });
await page.waitForSelector("#novel:not([hidden])");

async function clickByText(substr) {
  const buttons = page.locator("#choices button");
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const t = (await buttons.nth(i).innerText()).trim();
    if (t.toLowerCase().includes(substr.toLowerCase())) {
      await buttons.nth(i).click();
      await page.waitForTimeout(200);
      return t;
    }
  }
  throw new Error("No choice matching " + substr);
}

const steps = [
  "step into the workshop",
];
for (const s of steps) {
  const clicked = await clickByText(s);
  console.log("clicked", clicked);
}

const story = await page.locator("#story-text").innerText();
console.log("landed story", story.slice(0, 80).replace(/\s+/g, " "));
await page.click('.pane-tabs .tab[data-tab="settings"]');
await page.click("#btn-abilities");
await page.waitForSelector("#ability-menu:not([hidden])");
const abs = await page.locator("#ability-list").innerText();
console.log("abilities", abs);
if (!/curiosity/i.test(abs)) bug("Ability unlock missing after workshop path");

// Hotkey spacing regression
await page.goto(`${base}/engine-html/?preview=1&name=X&scene=start`, { waitUntil: "networkidle" });
await page.waitForSelector("#novel:not([hidden])");
const label = await page.locator("#choices button").first().innerText();
console.log("label", JSON.stringify(label));
if (/^\d[A-Za-z]/.test(label.replace(/\s/g, "")) && !/^\d\s/.test(label)) {
  // if no space: "1Explore"
}
if (!/^\d\s/.test(label.trim())) bug("Hotkey still lacks space: " + JSON.stringify(label));

// Keyboard hotkey 1
await page.keyboard.press("1");
await page.waitForTimeout(300);
const after = await page.locator("#story-text").innerText();
if (/tiny demo story/i.test(after)) bug("Number hotkey 1 did not advance scene");

// Dead-end soft message: jump to a known dead end if any
const scenes = await (await fetch(`${base}/projects/sample-project/story/scenes.json`)).json();
const map = scenes.scenes || scenes;
const dead = Object.keys(map).find((id) => !(map[id].choices || []).length);
if (dead) {
  await page.goto(`${base}/engine-html/?preview=1&name=X&scene=${encodeURIComponent(dead)}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("#novel:not([hidden])");
  const note = await page.locator("#choices .end-note").count();
  console.log("dead-end scene", dead, "end-note", note);
  if (!note) bug("Dead-end scene missing end note UI");
}

// Editor: add scene undo
await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle" });
await page.waitForSelector("#project-title");
const beforeCount = await page.locator("#scene-count").innerText();
await page.click("#btn-add");
await page.waitForTimeout(200);
const midCount = await page.locator("#scene-count").innerText();
if (!(Number(midCount) > Number(beforeCount))) bug("Add scene did not increase count");
await page.click("#btn-undo");
await page.waitForTimeout(200);
const afterUndo = await page.locator("#scene-count").innerText();
console.log("scene counts", { beforeCount, midCount, afterUndo });
if (afterUndo !== beforeCount) bug("Undo did not restore scene count");

await browser.close();
console.log("\nMore bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
