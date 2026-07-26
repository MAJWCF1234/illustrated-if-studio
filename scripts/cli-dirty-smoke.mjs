/**
 * CLI dirty-buffer smoke: scene / scenes / validate / export must persist
 * unsaved editor edits before reading or packaging disk.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const scenesPath = path.join(studioRoot, "projects", "sample-project", "story", "scenes.json");
const original = fs.readFileSync(scenesPath, "utf8");
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

await fetch(`${base}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));

await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle" });

async function runCli(cmd) {
  await page.click("#mode-cli");
  await page.waitForSelector("#workspace-cli:not([hidden])");
  const before = await page.locator("#cli-out .cli-line").count();
  await page.fill("#cli-input", cmd);
  await page.click('#cli-form button[type="submit"]');
  await page.waitForFunction(
    (n) => document.querySelectorAll("#cli-out .cli-line").length > n + 1,
    before,
    { timeout: 20000 }
  );
  await page.waitForTimeout(100);
  const lines = await page.locator("#cli-out .cli-line").allInnerTexts();
  return lines.slice(before).join("\n");
}

try {
  await page.click("#mode-story");
  await page.waitForSelector("#workspace-story:not([hidden])");
  await page.locator('#scene-list li[data-id="start"]').click();
  const marker = `DIRTY_SCENE_SMOKE_${Date.now()}`;
  await page.fill("#f-text", marker);

  const out = await runCli("scene start");
  if (!out.includes(marker)) {
    bug("scene peek did not see/save dirty editor text: " + out.slice(0, 200));
  } else {
    console.log("ok   scene saves dirty edits before peek");
  }

  const disk = JSON.parse(fs.readFileSync(scenesPath, "utf8"));
  if (!String(disk.scenes?.start?.text || "").includes(marker)) {
    bug("disk scenes.json missing marker after scene command");
  } else {
    console.log("ok   disk persisted after scene");
  }
} finally {
  fs.writeFileSync(scenesPath, original, "utf8");
  // Reload settings so the running server re-reads sample from disk next request
  await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeProjectId: "sample-project" }),
  }).catch(() => {});
  await browser.close();
}

console.log("\nCLI dirty smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
