/**
 * Playtest smoke for the bundled sample project (no game-specific content).
 * Walks the demo story: unlock the ability, use the ability-gated choice, and
 * exercise the ability menu + hide-art toggle in the HTML player.
 *
 * Requires a studio server (default http://127.0.0.1:8787). Set STUDIO_URL to
 * point elsewhere. Pin the sample project so assertions are deterministic.
 */
import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
function bug(m) {
  bugs.push(m);
  console.log("BUG:", m);
}

// Pin the sample project (do not inherit whatever an earlier smoke selected).
await fetch(`${base}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
}).catch(() => {});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));

console.log("=== Sample project playtest ===");
await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.reload({ waitUntil: "networkidle" });

await page.waitForSelector("#gate:not([hidden])");
await page.fill("#player-name", "Tester");
await page.click('#gate-form button[type="submit"]');
await page.waitForSelector("#novel:not([hidden])");
const title = await page.locator("#game-title").innerText();
const start = await page.locator("#story-text").innerText();
console.log("Title:", title.trim());
console.log("Start:", start.slice(0, 90).replace(/\s+/g, " "));
if (!/Sample Project/i.test(title)) bug("Wrong title: " + title);
if (!/workshop|tiny demo story/i.test(start)) bug("Start scene text unexpected");

async function clickChoice(substr) {
  await page.locator("#novel:not([hidden])").waitFor({ timeout: 10000 });
  await page.evaluate(() => {
    const am = document.getElementById("ability-menu");
    if (am) am.hidden = true;
    document.querySelector('.pane-tabs .tab[data-tab="story"]')?.click();
  });
  const btns = page.locator("#choices button");
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const t = (await btns.nth(i).innerText()).trim();
    if (t.toLowerCase().includes(substr.toLowerCase())) {
      await btns.nth(i).click({ force: true });
      await page.waitForTimeout(220);
      return t;
    }
  }
  const all = [];
  for (let i = 0; i < n; i++) all.push((await btns.nth(i).innerText()).trim());
  throw new Error("Missing choice: " + substr + " | have: " + JSON.stringify(all));
}

// look_around branch → Guide speaker
console.log("->", await clickChoice("Look around"));
const speaker = await page.locator("#speaker").innerText().catch(() => "");
console.log("Speaker:", JSON.stringify(speaker));
if (!/Guide/i.test(speaker)) bug("look_around speaker not Guide: " + speaker);
console.log("->", await clickChoice("Back to the entrance"));

// Unlock the sample ability in the workshop
console.log("->", await clickChoice("Step into the workshop"));
await page.click('.pane-tabs .tab[data-tab="settings"]');
await page.click("#btn-abilities");
await page.waitForSelector("#ability-menu:not([hidden])");
const abs = await page.locator("#ability-list").innerText();
console.log("Abilities:", abs.replace(/\s+/g, " ").slice(0, 120));
if (!/curiosity/i.test(abs)) bug("Did not unlock Curiosity");
await page.click("#ability-close");

// Hide image toggle
await page.click('.pane-tabs .tab[data-tab="story"]');
await page.click("#btn-hide-art");
const artHidden = await page.locator("#novel").evaluate((el) => el.classList.contains("art-hidden"));
if (!artHidden) bug("Hide Image did not toggle art-hidden");
await page.click("#btn-hide-art");

// Ability-gated path: return, take garden, open gate with curiosity
console.log("->", await clickChoice("Take the key and return"));
console.log("->", await clickChoice("Follow the garden path"));
console.log("->", await clickChoice("Open the gate with your curiosity"));
const ending = await page.locator("#story-text").innerText();
console.log("Ending beat:", ending.slice(0, 80).replace(/\s+/g, " "));
if (!/horizon|end of the sample/i.test(ending)) bug("Gated path did not reach ending: " + ending);

await browser.close();
console.log("\nPlaytest bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
