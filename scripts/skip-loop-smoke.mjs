/**
 * Skip-read must terminate on a cyclic story.
 *
 * The sample story lets you bounce between two scenes forever. With "Skip read"
 * held on, an engine without a loop guard auto-advances until the tab dies, so
 * this asserts the run stops and says why.
 */
import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));

try {
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#gate:not([hidden])", { timeout: 20000 });
  await page.fill("#player-name", "Loop Tester");
  await page.click("#gate-form button[type=submit]");
  await page.waitForSelector("#novel:not([hidden])", { timeout: 20000 });

  // Walk a two-scene cycle so both ends are "seen" and each has a remembered choice.
  const cycle = await page.evaluate(async () => {
    const engine = window.__ifEngine;
    const scenes = engine.scenes;
    // Find a pair a -> b -> a reachable by single choices.
    for (const [a, sa] of Object.entries(scenes)) {
      for (const ca of sa.choices || []) {
        const b = ca.next;
        const sb = scenes[b];
        if (!sb) continue;
        for (const cb of sb.choices || []) {
          if (cb.next === a) return { a, b, aChoice: ca.text, bChoice: cb.text };
        }
      }
    }
    return null;
  });

  if (!cycle) {
    console.log("No 2-scene cycle in this project — nothing to assert.");
  } else {
    console.log(`Cycle: ${cycle.a} -> ${cycle.b} -> ${cycle.a}`);
    // Prime: visit both scenes and remember the looping choice at each.
    await page.evaluate(({ a, b, aChoice, bChoice }) => {
      const engine = window.__ifEngine;
      engine.showScene(a);
      engine.rememberChoice(a, aChoice);
      engine.showScene(b);
      engine.rememberChoice(b, bChoice);
      engine.showScene(a);
    }, cycle);

    // Turn skip on and let it run. A guarded engine stops; an unguarded one spins.
    const result = await page.evaluate(async () => {
      const engine = window.__ifEngine;
      let hops = 0;
      const origShow = engine.showScene.bind(engine);
      engine.showScene = (...args) => {
        hops += 1;
        return origShow(...args);
      };
      engine._skipMode = true;
      for (let i = 0; i < 50; i++) {
        const advanced = engine.trySkipAdvance();
        if (!advanced) break;
        if (hops > 40) break;
      }
      return { hops, skipMode: engine._skipMode };
    }, cycle);

    console.log("Skip hops:", result.hops, "skipMode still on:", result.skipMode);
    if (result.hops > 10) bug(`skip did not stop on a cycle (${result.hops} hops)`);
    if (result.skipMode) bug("skip mode stayed on after hitting the loop");
  }
} catch (err) {
  bug("uncaught: " + (err?.message || err));
} finally {
  await browser.close();
}

console.log("\nSkip-loop smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
