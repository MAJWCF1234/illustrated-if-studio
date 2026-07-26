/**
 * Smoke for gate Begin reset, inspector click-after-type, and upload rename.
 * Leaves activeProjectId = sample-project. Does not touch finding-secrets.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uniqueFilenameInDir } from "../server/lib/fs-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("ok  ", m);

const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const tinyPng2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error("Studio down");

  // Unit: uniqueFilenameInDir
  const tmp = path.join(root, "dist", "zz-unique-name");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "art.png"), "a");
  const u1 = uniqueFilenameInDir(tmp, "art.png");
  if (!u1.ok || u1.filename !== "art-2.png" || !u1.renamed) bug(`unique rename got ${JSON.stringify(u1)}`);
  else ok("unit uniqueFilenameInDir → art-2.png");
  fs.rmSync(tmp, { recursive: true, force: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => bug("pageerror: " + e.message));

  // ── Gate Begin clears prior abilities ───────────────────────
  await page.goto(`${BASE}/engine-html/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Alice");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.click('#choices button.choice:has-text("Step into the workshop")');
  await page.click('#choices button.choice:has-text("Take the key and return")');
  await page.click('#choices button.choice:has-text("Follow the garden path")');
  const alice = await page.evaluate(() => ({
    abilities: [...(window.__ifEngine?.state?.abilities || [])],
  }));
  if (!alice.abilities.includes("curiosity")) bug("Alice did not earn curiosity: " + JSON.stringify(alice));
  else ok("Alice earned curiosity");

  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Bob");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  const bob = await page.evaluate(() => ({
    name: window.__ifEngine?.state?.playerName,
    abilities: [...(window.__ifEngine?.state?.abilities || [])],
    historyLen: window.__ifEngine?.state?.history?.length || 0,
  }));
  if (bob.name !== "Bob") bug("Bob name missing");
  if (bob.abilities.includes("curiosity")) bug("Bob inherited Alice curiosity: " + JSON.stringify(bob));
  else if (bob.historyLen > 1) bug("Bob inherited long history: " + JSON.stringify(bob));
  else ok("Gate Begin starts Bob fresh");

  // ── Inspector: type then one-click switch scene ─────────────
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeProjectId: "sample-project" }),
  });
  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene-list li");
  await page.locator('#scene-list li[data-id="look_around"]').dispatchEvent("pointerdown");
  await page.click('[data-insp="story"]');
  await page.click("#f-text");
  await page.keyboard.press("End");
  await page.keyboard.type(" EXTRA");
  await page.locator('#scene-list li[data-id="garden"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(200);
  const switched = await page.inputValue("#f-id");
  if (switched !== "garden") bug(`scene switch after type stayed on ${switched}`);
  else ok("one pointerdown switches scene after typing");

  // Choice delete after typing
  await page.locator('#scene-list li[data-id="workshop"]').dispatchEvent("pointerdown");
  await page.click('[data-insp="actions"]');
  await page.waitForSelector("#choices-editor .action-card");
  const before = await page.locator("#choices-editor .action-card").count();
  await page.locator('#choices-editor .action-card').nth(0).locator('[data-k="text"]').click();
  await page.keyboard.type(" X");
  await page.locator('#choices-editor .action-card').nth(1).locator('[data-act="del"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(150);
  const after = await page.locator("#choices-editor .action-card").count();
  if (after !== before - 1) bug(`choice delete after type: before=${before} after=${after}`);
  else ok("choice delete works after typing another card");

  // ── Upload does not overwrite ───────────────────────────────
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeProjectId: "sample-project" }),
  });
  const up1 = await (
    await fetch(`${BASE}/api/assets/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: "scene_images",
        filename: "zz-dup-probe.png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      }),
    })
  ).json();
  const up2 = await (
    await fetch(`${BASE}/api/assets/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: "scene_images",
        filename: "zz-dup-probe.png",
        dataUrl: `data:image/png;base64,${tinyPng2}`,
      }),
    })
  ).json();
  if (!up1.ok || up1.filename !== "zz-dup-probe.png") bug("first upload failed: " + JSON.stringify(up1));
  else if (!up2.ok || up2.filename === "zz-dup-probe.png") bug("second upload overwrote: " + JSON.stringify(up2));
  else if (!up2.renamed) bug("second upload missing renamed flag");
  else ok(`upload renamed collision → ${up2.filename}`);

  // cleanup uploaded probes
  for (const name of [up1.filename, up2.filename].filter(Boolean)) {
    const p = path.join(root, "projects", "sample-project", "assets", "scene_images", name);
    fs.rmSync(p, { force: true });
  }

  // Restore sample scene text if dirtied (don't save)
  await fetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeProjectId: "sample-project" }),
  });

  await browser.close();
  console.log("\nPlaythrough UX bugs:", bugs.length);
  if (bugs.length) process.exitCode = 1;
  else console.log("PASS: playthrough-ux-smoke");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
