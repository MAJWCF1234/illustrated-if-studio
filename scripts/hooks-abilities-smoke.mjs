#!/usr/bin/env node
/**
 * onEnter hooks must not brick the player; unlockAbility / hasAbility must trim
 * whitespace and still grant unicode / spaced ids without XSS via toast HTML.
 */
import { chromium } from "playwright";
import { evalWhen } from "../engine-html/js/conditions.js";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("OK:", m);

{
  const state = { abilities: ["spa ce", "café"], vars: {} };
  const cases = [
    ["space id", { hasAbility: "spa ce" }, true],
    ["padded want", { hasAbility: "  spa ce  " }, true],
    ["whitespace-only when", { hasAbility: "   " }, true],
    ["unicode", { hasAbility: "café" }, true],
    ["nested any", { any: [{ hasAbility: "nope" }, { hasAbility: "café" }] }, true],
  ];
  for (const [label, when, want] of cases) {
    try {
      const got = evalWhen(when, state);
      if (got !== want) bug(`evalWhen ${label}: got ${got} want ${want}`);
      else ok(`evalWhen ${label}`);
    } catch (e) {
      bug(`evalWhen threw ${label}: ${e.message}`);
    }
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForSelector("#gate:not([hidden])", { timeout: 20000 });
await page.fill("#player-name", "Hooks Abilities");
await page.click("#gate-form button[type=submit]");
await page.waitForSelector("#novel:not([hidden])", { timeout: 20000 });

const result = await page.evaluate(() => {
  const eng = window.__ifEngine;
  const key = eng.startId;
  const scene = eng.scenes[key];
  const saved = {
    choices: scene.choices,
    unlock: scene.unlockAbility,
    hooks: scene.hooks,
  };
  const out = {};

  // Whitespace unlock rejected
  const before = [...eng.state.abilities];
  eng.unlockAbility("   ");
  eng.unlockAbility("");
  out.whitespaceRejected = eng.state.abilities.length === before.length;

  // Space + unicode + XSS payload
  eng.state.abilities = [];
  eng.unlockAbility("spa ce");
  eng.unlockAbility("café_日本語");
  eng.unlockAbility('<img src=x onerror=window.__xssH=1>');
  out.granted = [...eng.state.abilities];
  out.xss = Boolean(window.__xssH);
  out.toastHasRawTag = (eng.root.toast.innerHTML || "").includes("<img");

  // Throwing onEnter must still render choices
  eng.hooks.__throw_smoke = () => {
    throw new Error("smoke hook boom");
  };
  scene.hooks = { onEnter: "__throw_smoke" };
  scene.choices = [
    { text: "after-throw", next: key },
    { text: "gated", next: key, when: { hasAbility: "spa ce" } },
  ];
  eng.state.abilities = ["spa ce"];
  try {
    eng.showScene(key);
    out.throwHook = {
      ok: true,
      labels: [...eng.root.choices.querySelectorAll("button.choice")].map((b) =>
        b.textContent.replace(/^\d+\s*/, "").trim()
      ),
    };
  } catch (e) {
    out.throwHook = {
      ok: false,
      err: e.message,
      labels: [...eng.root.choices.querySelectorAll("button.choice")].map((b) =>
        b.textContent.replace(/^\d+\s*/, "").trim()
      ),
    };
  }

  // Missing hook
  scene.hooks = { onEnter: "missing_forever" };
  try {
    eng.showScene(key);
    out.missingHook = { ok: true, n: eng.root.choices.querySelectorAll("button.choice").length };
  } catch (e) {
    out.missingHook = { ok: false, err: e.message };
  }

  // onEnter unlock whitespace scene field
  scene.unlockAbility = "   ";
  scene.hooks = null;
  eng.state.abilities = [];
  eng.showScene(key);
  out.sceneWhitespaceUnlock = [...eng.state.abilities];

  // onEnter unlock space id + gate
  scene.unlockAbility = "spa ce";
  scene.choices = [
    { text: "needs-space", next: key, when: { hasAbility: "spa ce" } },
    { text: "always", next: key },
  ];
  eng.state.abilities = [];
  eng.showScene(key);
  out.onEnterGate = {
    abilities: [...eng.state.abilities],
    labels: [...eng.root.choices.querySelectorAll("button.choice")].map((b) =>
      b.textContent.replace(/^\d+\s*/, "").trim()
    ),
  };

  scene.choices = saved.choices;
  scene.unlockAbility = saved.unlock;
  scene.hooks = saved.hooks;
  return out;
});

console.log(JSON.stringify(result, null, 2));

if (!result.whitespaceRejected) bug("whitespace unlockAbility should be rejected");
else ok("whitespace unlock rejected");
if (!result.granted.includes("spa ce") || !result.granted.includes("café_日本語")) {
  bug(`expected weird ids granted: ${JSON.stringify(result.granted)}`);
} else ok("space/unicode unlock granted");
if (result.xss || result.toastHasRawTag) bug("XSS via unlock toast");
else ok("unlock toast XSS-safe");
if (!result.throwHook?.ok || !result.throwHook.labels.includes("after-throw")) {
  bug(`throwing onEnter bricked player: ${JSON.stringify(result.throwHook)}`);
} else ok("throwing onEnter recovered");
if (!result.missingHook?.ok) bug(`missing hook bricked: ${JSON.stringify(result.missingHook)}`);
else ok("missing hook ok");
if (result.sceneWhitespaceUnlock?.length) {
  bug(`scene whitespace unlockAbility granted: ${JSON.stringify(result.sceneWhitespaceUnlock)}`);
} else ok("scene whitespace unlockAbility ignored");
if (
  !result.onEnterGate?.abilities?.includes("spa ce") ||
  !result.onEnterGate.labels.some((t) => /needs-space/.test(t))
) {
  bug(`onEnter gate failed: ${JSON.stringify(result.onEnterGate)}`);
} else ok("onEnter unlock + when gate");
if (pageErrors.length) bug(`pageerrors: ${pageErrors.join(" | ")}`);

await browser.close();
console.log("\nHooks/abilities smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
