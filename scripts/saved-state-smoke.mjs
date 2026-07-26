/**
 * Saved progress must never brick the player.
 *
 * Browser storage can hold the wrong shape (older builds, hand-edited data) and
 * a saved position can point at a scene the creator has since renamed or
 * deleted. In every case the player must still boot and offer a way onward.
 */
import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const cases = [
  { name: "abilities = object", leaf: "abilities", value: '{"fly":true}' },
  { name: "abilities = string", leaf: "abilities", value: '"fly"' },
  { name: "history = object", leaf: "history", value: '{"0":{"id":"start"}}' },
  { name: "history = number", leaf: "history", value: "7" },
  { name: "vars = array", leaf: "vars", value: "[1,2,3]" },
  { name: "seenScenes = object", leaf: "seenScenes", value: '{"start":1}' },
  { name: "lastChoices = array", leaf: "lastChoices", value: "[1,2]" },
  { name: "currentScene = deleted scene", leaf: "currentScene", value: "no-such-scene-xyz" },
];

const browser = await chromium.launch({ headless: true });
const bugs = [];

for (const c of cases) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  // Seed the corrupt value before any app script runs.
  await page.addInitScript(
    ({ leaf, value }) => {
      try {
        localStorage.setItem(`ifstudio:sample-project:${leaf}`, value);
        localStorage.setItem("ifstudio:sample-project:playerName", "Corrupt Tester");
      } catch {
        /* ignore */
      }
    },
    { leaf: c.leaf, value: c.value }
  );

  let booted = false;
  let stuck = false;
  try {
    await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle", timeout: 20000 });
    // Booted = title resolved and either gate or novel is showing.
    await page.waitForFunction(
      () => {
        const t = document.getElementById("game-title")?.textContent?.trim() || "";
        const gate = document.getElementById("gate");
        const novel = document.getElementById("novel");
        return t && !/^Loading/i.test(t) && ((gate && !gate.hidden) || (novel && !novel.hidden));
      },
      { timeout: 12000 }
    );
    booted = true;

    // If a Continue button exists, press it: that is the resume path a player uses.
    const cont = page.locator("#continue-btn");
    if (await cont.isVisible().catch(() => false)) {
      await cont.click();
    } else {
      await page.fill("#player-name", "Corrupt Tester").catch(() => {});
      await page.click("#gate-form button[type=submit]").catch(() => {});
    }
    await page.waitForSelector("#novel:not([hidden])", { timeout: 10000 });

    // Stuck = story showing an error with no way onward.
    const info = await page.evaluate(() => ({
      text: document.getElementById("story-text")?.textContent || "",
      choices: document.querySelectorAll("#choices button").length,
    }));
    stuck = /is missing or incomplete/i.test(info.text) && info.choices === 0;
    if (stuck) bugs.push(`${c.name}: dead end — error text and 0 choices`);
  } catch (err) {
    bugs.push(`${c.name}: did not reach playable state — ${String(err.message || err).split("\n")[0]}`);
  }

  const real = errors.filter((e) => !/favicon|net::ERR_/i.test(e));
  if (real.length) bugs.push(`${c.name}: JS errors — ${real.slice(0, 2).join(" | ")}`);
  console.log(
    `${booted ? "boot-ok " : "BOOT-FAIL"} ${stuck ? "STUCK" : "     "} ${c.name}${real.length ? "  errs:" + real.length : ""}`
  );
  await ctx.close();
}

await browser.close();
console.log("\nSaved-state resilience findings:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
