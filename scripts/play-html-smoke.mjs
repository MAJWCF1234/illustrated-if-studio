/**
 * Headed/headless Playwright smoke: gate → start scene → click first choice.
 * Usage: node scripts/play-html-smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8787/engine-html/";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    // Missing optional scene art is expected for art-optional projects
    if (/Failed to load resource|404|net::ERR_/i.test(t)) return;
    errors.push(t);
  });

  console.log("Opening", base);
  await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });

  const boot = page.locator("#boot-error");
  if (await boot.isVisible().catch(() => false)) {
    throw new Error("Boot error: " + (await boot.textContent()));
  }

  // Name gate
  const gate = page.locator("#gate");
  if (await gate.isVisible()) {
    await page.fill("#player-name", "TestPlayer");
    await page.click('#gate-form button[type="submit"]');
  }

  await page.waitForSelector("#novel:not([hidden])", { timeout: 10000 });
  const title = await page.locator("#game-title").innerText();
  const story = await page.locator("#story-text").innerText();
  console.log("Title:", title.trim());
  console.log("Story:", story.trim().slice(0, 120).replace(/\s+/g, " "));

  const choiceBtns = page.locator("#choices button");
  const n = await choiceBtns.count();
  if (n < 1) throw new Error("No choices on start scene");
  const firstLabel = await choiceBtns.first().innerText();
  console.log("Clicking choice:", firstLabel.trim());
  await choiceBtns.first().click();
  await page.waitForTimeout(400);
  const after = await page.locator("#story-text").innerText();
  if (!after.trim()) throw new Error("Empty story after choice");
  console.log("After choice:", after.trim().slice(0, 120).replace(/\s+/g, " "));

  // Hide image toggle
  const hide = page.locator("#btn-hide-art");
  if (await hide.count()) {
    await hide.click();
    await page.waitForTimeout(200);
    console.log("Hide Image toggled");
  }

  if (errors.length) {
    console.error("Page errors:", errors);
    throw new Error("Console/page errors during play");
  }

  await browser.close();
  console.log("HTML PLAY SMOKE OK");
}

main().catch(async (err) => {
  console.error("FAILED:", err.message || err);
  process.exit(1);
});
