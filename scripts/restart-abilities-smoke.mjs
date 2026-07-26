#!/usr/bin/env node
/**
 * Restart must not brick the player when abilities storage is the wrong shape.
 *
 * sample-project keeps abilities on restart; clearPlaythrough used to re-read
 * localStorage without an Array.isArray guard, leaving a plain object that
 * later crashed unlockAbility / hasAbility via .includes().
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
  await page.addInitScript(() => {
    localStorage.setItem("ifstudio:sample-project:abilities", JSON.stringify({ fly: true }));
    localStorage.setItem("ifstudio:sample-project:playerName", "Restart Tester");
    localStorage.setItem("ifstudio:sample-project:currentScene", "start");
    localStorage.setItem("ifstudio:sample-project:history", JSON.stringify([{ id: "start", choice: null }]));
    localStorage.setItem("ifstudio:sample-project:vars", "{}");
  });

  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("game-title")?.textContent?.trim() || "";
    return t && !/^Loading/i.test(t);
  }, { timeout: 15000 });

  // Re-seed corrupt abilities after boot sanitization, then restart.
  const result = await page.evaluate(() => {
    localStorage.setItem("ifstudio:sample-project:abilities", JSON.stringify({ fly: true }));
    const eng = window.__ifEngine;
    eng.restart();
    const after = {
      isArray: Array.isArray(eng.state.abilities),
      abilities: eng.state.abilities,
    };
    let includesOk = false;
    let unlockOk = false;
    try {
      includesOk = eng.state.abilities.includes("fly") === false;
    } catch (e) {
      return { after, crash: "includes:" + e.message };
    }
    try {
      eng.unlockAbility("swim");
      unlockOk = eng.state.abilities.includes("swim");
    } catch (e) {
      return { after, crash: "unlock:" + e.message };
    }
    return { after, includesOk, unlockOk };
  });

  console.log(JSON.stringify(result));
  if (result.crash) bug(result.crash);
  if (!result.after?.isArray) bug("abilities not an array after restart");
  if (result.unlockOk !== true) bug("unlockAbility failed after restart with corrupt storage");
} catch (err) {
  bug("uncaught: " + (err?.message || err));
} finally {
  await browser.close();
}

console.log("\nRestart-abilities smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
