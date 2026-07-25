import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];

function bug(msg) {
  bugs.push(msg);
  console.log("BUG:", msg);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGE: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) {
    errors.push("CON: " + m.text());
  }
});

await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector("#project-title");
const title = (await page.locator("#project-title").innerText()).trim();
const storyVisible = await page.locator("#workspace-story").isVisible();
const designHidden = await page.locator("#workspace-design").evaluate((el) => el.hidden);
console.log("EDITOR", { title, storyVisible, designHidden });
if (!storyVisible || !designHidden) bug("Design workspace not exclusive on Story load");

await page.click("#mode-design");
await page.waitForTimeout(350);
const storyHidden = await page.locator("#workspace-story").evaluate((el) => el.hidden);
const designVisible = await page.locator("#workspace-design").isVisible();
console.log("DESIGN mode", { storyHidden, designVisible });
if (!storyHidden || !designVisible) bug("Design mode does not swap workspaces");
if (!(await page.locator("#ux-preview").count())) bug("Design live preview missing");

await page.click('[data-design="menu"]');
await page.waitForTimeout(150);
await page.selectOption('select[data-menu="gateStyle"]', "minimal");
await page.waitForTimeout(100);
await page.click("#mode-story");
await page.waitForTimeout(200);
await page.click("#btn-save");
await page.waitForTimeout(800);
console.log("Saved after design tweak");

// restore default via API-ish: open design reset
await page.click("#mode-design");
await page.waitForTimeout(200);
page.once("dialog", (d) => d.accept());
await page.click("#btn-reset-theme");
await page.waitForTimeout(200);
await page.click("#mode-story");
await page.click("#btn-save");
await page.waitForTimeout(500);

await page.goto(`${base}/engine-html/?preview=1&name=BugHunter&scene=start`, {
  waitUntil: "networkidle",
});
await page.waitForSelector("#novel:not([hidden])");
const choiceHtml = await page.locator("#choices button").first().innerHTML();
const choiceText = await page.locator("#choices button").first().innerText();
console.log("CHOICE", { choiceHtml, choiceText });
if (/hotkey">\d<\/span>[A-Za-z]/.test(choiceHtml)) {
  bug("Missing space between hotkey number and choice label (reads as 1Explore)");
}

for (let i = 0; i < 3; i++) {
  const n = await page.locator("#choices button").count();
  if (!n) break;
  await page.locator("#choices button").first().click();
  await page.waitForTimeout(250);
}
console.log("AFTER3", (await page.locator("#story-text").innerText()).slice(0, 100).replace(/\s+/g, " "));

await page.click('.pane-tabs .tab[data-tab="settings"]');
await page.click("#btn-abilities");
await page.waitForSelector("#ability-menu:not([hidden])");
await page.click("#ability-close");
await page.click("#btn-restart");
await page.waitForTimeout(250);
if ((await page.locator("#story-text").innerText()).length < 20) bug("Restart left empty story");

// Preview pollution: open preview scene then full boot should use gate unless save exists
await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
const gateVisible = await page.locator("#gate").isVisible();
console.log("GATE on cold boot", gateVisible);
if (!gateVisible) {
  // may continue-saved — check continue button
  const cont = await page.locator("#continue-btn").isVisible();
  console.log("continue visible", cont);
}

if (errors.length) {
  console.log("JS_ERRORS", errors);
  for (const e of errors) bug(e);
}

await browser.close();
console.log("\nDeep probe bugs:", bugs.length);
for (const b of bugs) console.log("-", b);
process.exit(bugs.length ? 1 : 0);
