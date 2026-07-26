#!/usr/bin/env node
/**
 * Adversarial HTML player paths: XSS must not execute; huge stories must boot;
 * empty/missing/self choice targets must recover; malformed when must not crash.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { evalWhen } from "../engine-html/js/conditions.js";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("OK:", m);

// Unit: malformed when never throws
{
  const state = { abilities: ["fly"], vars: { nullVar: null }, history: [] };
  const cases = [
    ["all string", { all: "x" }, true],
    ["any string", { any: "x" }, false],
    ["all object", { all: { hasAbility: "fly" } }, true],
    ["null gte 0", { var: "nullVar", gte: 0 }, true],
    ["unset gte 0", { var: "missing", gte: 0 }, false],
  ];
  for (const [label, when, want] of cases) {
    try {
      const got = evalWhen(when, state);
      if (got !== want) bug(`evalWhen ${label}: got ${got} want ${want}`);
      else ok(`evalWhen ${label}`);
    } catch (e) {
      bug(`evalWhen threw on ${label}: ${e.message}`);
    }
  }
}

const browser = await chromium.launch({ headless: true });

// XSS + choice next recovery on live sample
{
  const page = await browser.newPage();
  page.on("pageerror", (e) => bug("pageerror: " + e.message));
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForSelector("#gate:not([hidden])", { timeout: 20000 });
  await page.fill("#player-name", "Adv Tester");
  await page.click("#gate-form button[type=submit]");
  await page.waitForSelector("#novel:not([hidden])", { timeout: 20000 });

  const xss = await page.evaluate(() => {
    const eng = window.__ifEngine;
    const key = eng.state.currentScene;
    const orig = eng.scenes[key];
    eng.scenes[key] = {
      ...orig,
      text: '<img src=x onerror="window.__xssT=1">',
      speaker: '<svg onload="window.__xssS=1">',
      choices: [{ text: '<img src=x onerror="window.__xssC=1">', next: key }],
    };
    eng.showScene(key);
    return {
      t: Boolean(window.__xssT),
      s: Boolean(window.__xssS),
      c: Boolean(window.__xssC),
      textHasImg: eng.root.storyText.innerHTML.includes("<img"),
    };
  });
  if (xss.t || xss.s || xss.c || xss.textHasImg) bug("XSS executed or leaked as HTML: " + JSON.stringify(xss));
  else ok("XSS in text/speaker/choice did not execute");

  const nextProbe = await page.evaluate(() => {
    const eng = window.__ifEngine;
    const out = [];
    for (const next of ["", "no-such-zzz", eng.startId]) {
      eng.showScene(eng.startId);
      const scene = eng.scenes[eng.startId];
      const saved = scene.choices;
      scene.choices = [{ text: "go", next }];
      eng.showScene(eng.startId);
      eng.root.choices.querySelector("button.choice")?.click();
      out.push({
        next,
        choices: eng.root.choices.querySelectorAll("button").length,
        dead: /isn't there anymore/i.test(eng.root.storyText.textContent || "") &&
          eng.root.choices.querySelectorAll("button").length === 0,
      });
      scene.choices = saved;
    }
    // Malformed when on a live filter
    eng.showScene(eng.startId);
    const scene = eng.scenes[eng.startId];
    const saved = scene.choices;
    scene.choices = [
      { text: "good", next: eng.startId, when: { hasAbility: "nope" } },
      { text: "bad-when", next: eng.startId, when: { all: "broken" } },
      { text: "always", next: eng.startId },
    ];
    let threw = null;
    try {
      eng.showScene(eng.startId);
    } catch (e) {
      threw = e.message;
    }
    out.push({
      malformedWhen: true,
      threw,
      labels: [...eng.root.choices.querySelectorAll("button.choice")].map((b) => b.textContent.trim()),
    });
    scene.choices = saved;
    return out;
  });
  for (const r of nextProbe) {
    if (r.malformedWhen) {
      if (r.threw) bug("malformed when crashed showScene: " + r.threw);
      else if (!r.labels.some((t) => /always/i.test(t))) bug("malformed when hid valid choices: " + JSON.stringify(r.labels));
      else ok("malformed when did not crash showScene");
    } else if (r.dead) bug(`dead end for next=${JSON.stringify(r.next)}`);
    else ok(`choice next=${JSON.stringify(r.next)} recoverable (choices=${r.choices})`);
  }
  await page.close();
}

// 200+ scene story served from a temp static project via packaged-style fetch
{
  const tmp = path.join(studioRoot, "dist", "zz-stress-big");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(path.join(studioRoot, "engine-html"), tmp, { recursive: true });
  const proj = path.join(tmp, "project");
  fs.mkdirSync(path.join(proj, "story"), { recursive: true });
  fs.mkdirSync(path.join(proj, "theme"), { recursive: true });
  fs.mkdirSync(path.join(proj, "assets", "scene_images"), { recursive: true });
  const scenes = {};
  const N = 220;
  for (let i = 0; i < N; i++) {
    const id = i === 0 ? "start" : `s${i}`;
    const next = i === N - 1 ? null : i + 1 === 0 ? "start" : `s${i + 1}`;
    scenes[id] = {
      id,
      text: `Scene ${i} — unicode café 日本語 emoji 🎮`,
      speaker: i % 2 ? "Narrator" : "Guide",
      choices: next
        ? [{ text: `Continue to ${next}`, next }]
        : [{ text: "Loop to start", next: "start" }],
    };
  }
  // Self / empty / missing edges on a side branch
  scenes.branch = {
    id: "branch",
    text: "Branch",
    choices: [
      { text: "self", next: "branch" },
      { text: "empty", next: "" },
      { text: "missing", next: "gone-forever" },
      { text: "back", next: "start" },
    ],
  };
  scenes.start.choices.push({ text: "Side branch", next: "branch" });

  fs.writeFileSync(
    path.join(proj, "project.json"),
    JSON.stringify({
      formatVersion: 1,
      id: "zz-stress-big",
      title: "Big Stress",
      author: "Stress",
      start: "start",
      story: { scenes: "story/scenes.json", characters: "story/characters.json", abilities: "story/abilities.json" },
      theme: "theme/theme.json",
      meta: { keepAbilitiesOnRestart: true },
    }),
    "utf8"
  );
  fs.writeFileSync(path.join(proj, "story", "scenes.json"), JSON.stringify({ start: "start", scenes }, null, 2), "utf8");
  fs.writeFileSync(path.join(proj, "story", "characters.json"), JSON.stringify({ characters: [] }), "utf8");
  fs.writeFileSync(path.join(proj, "story", "abilities.json"), JSON.stringify({ abilities: [] }), "utf8");
  fs.copyFileSync(
    path.join(studioRoot, "projects", "sample-project", "theme", "theme.json"),
    path.join(proj, "theme", "theme.json")
  );
  // Minimal default bg
  const defSvg = path.join(studioRoot, "projects", "sample-project", "assets", "scene_images", "default.svg");
  if (fs.existsSync(defSvg)) fs.copyFileSync(defSvg, path.join(proj, "assets", "scene_images", "default.svg"));

  fs.writeFileSync(
    path.join(tmp, "js", "config.js"),
    `/** Packaged stress build */\nexport let PROJECT_BASE = new URL("../project/", import.meta.url);\nexport async function initProjectBase() { return PROJECT_BASE; }\n`,
    "utf8"
  );

  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.join(tmp, urlPath.replace(/^\//, ""));
    if (!file.startsWith(tmp) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    const ext = path.extname(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const page = await browser.newPage();
  page.on("pageerror", (e) => bug("big-story pageerror: " + e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector("#gate:not([hidden])", { timeout: 20000 });
    await page.fill("#player-name", "Big");
    await page.click("#gate-form button[type=submit]");
    await page.waitForSelector("#novel:not([hidden])", { timeout: 20000 });
    const info = await page.evaluate(() => ({
      count: Object.keys(window.__ifEngine.scenes).length,
      text: document.getElementById("story-text")?.textContent || "",
      choices: document.querySelectorAll("#choices button").length,
    }));
    if (info.count < 200) bug(`big story loaded only ${info.count} scenes`);
    else ok(`big story booted with ${info.count} scenes`);
    if (!info.choices) bug("big story start has 0 choices");
    // Walk a few scenes quickly
    for (let i = 0; i < 15; i++) {
      await page.locator("#choices button.choice").first().click();
    }
    const mid = await page.evaluate(() => window.__ifEngine.state.currentScene);
    ok(`big story advanced to ${mid}`);
  } catch (e) {
    bug("big story failed: " + (e.message || e));
  } finally {
    await page.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await browser.close();
console.log("\nHTML adversarial smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
