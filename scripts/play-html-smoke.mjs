/**
 * Headed/headless Playwright smoke: gate → start scene → click first choice.
 * Usage: node scripts/play-html-smoke.mjs [baseUrl]
 *
 * Fails hard on:
 * - pageerror / unexpected console errors
 * - 4xx responses for JS modules or project JSON
 * - title stuck on "Loading…" (overlay never dismissed)
 * - missing name gate / story UI
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8787/engine-html/";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const badHttp = [];

  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    // Missing optional scene art is expected for art-optional projects
    if (/Failed to load resource|404|net::ERR_/i.test(t)) return;
    errors.push(t);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    // Optional art / audio may 404; critical boot assets must not.
    if (/\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav)(\?|$)/i.test(url)) return;
    if (/\/(assets|art)\//i.test(url)) return;
    // Packaged HTML has no disk saves API; engine probes then falls back to localStorage.
    if (/\/api\/saves(\/|$|\?)/i.test(url) && status === 404) return;
    badHttp.push(`${status} ${url}`);
  });

  console.log("Opening", base);
  await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });

  const boot = page.locator("#boot-error");
  if (await boot.isVisible().catch(() => false)) {
    throw new Error("Boot error: " + (await boot.textContent()));
  }

  // Must leave the static "Loading…" placeholder — forever-loading is a hard fail.
  await page.waitForFunction(
    () => {
      const title = document.getElementById("game-title")?.textContent?.trim() || "";
      const gate = document.getElementById("gate");
      const novel = document.getElementById("novel");
      const gateOpen = gate && !gate.hidden;
      const novelOpen = novel && !novel.hidden;
      return title.length > 0 && !/^Loading/i.test(title) && (gateOpen || novelOpen);
    },
    { timeout: 15000 }
  );

  const title = await page.locator("#game-title").innerText();
  if (/^Loading/i.test(title.trim())) {
    throw new Error("Stuck on Loading… screen");
  }
  console.log("Title:", title.trim());

  // Name gate
  const gate = page.locator("#gate");
  if (await gate.isVisible()) {
    await page.fill("#player-name", "TestPlayer");
    await page.click('#gate-form button[type="submit"]');
  }

  await page.waitForSelector("#novel:not([hidden])", { timeout: 10000 });
  const story = await page.locator("#story-text").innerText();
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

  if (badHttp.length) {
    console.error("HTTP errors:", badHttp);
    throw new Error("4xx/5xx on critical assets during play");
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
