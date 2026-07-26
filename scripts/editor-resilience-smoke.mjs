/**
 * Smoke for editor/API resilience fixes:
 *  - oversized bodies return JSON 413 (not ECONNRESET)
 *  - empty POST /api/projects is rejected
 *  - failed import does not remember lastImportPath
 *  - Save network failure surfaces a dialog (not a silent dirty dot)
 *  - CLI `new --title` (no value) does not create a project named "true"
 *  - CLI `use` prompts before discarding dirty edits
 *
 * Leaves activeProjectId = sample-project. Does not touch finding-secrets.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("ok  ", m);

function req(method, urlPath, body, { contentLength } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE);
    const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    const headers = {};
    if (payload != null) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] =
        contentLength != null ? String(contentLength) : String(Buffer.byteLength(payload));
    }
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = { raw: text };
          }
          resolve({ status: res.statusCode, data, text });
        });
      }
    );
    r.on("error", reject);
    if (payload != null) r.write(payload);
    r.end();
  });
}

async function cleanupScratch() {
  for (const id of ["true", "zz-resilience-smoke", "zz-broken-switch"]) {
    fs.rmSync(path.join(root, "projects", id), { recursive: true, force: true });
  }
  await req("PUT", "/api/settings", { activeProjectId: "sample-project" });
}

async function main() {
  const health = await req("GET", "/api/health");
  if (health.status !== 200) throw new Error("Studio down — start node server/index.mjs");

  await cleanupScratch();

  // ── 413 JSON for oversized body ─────────────────────────────
  const huge = "x".repeat(9 * 1024 * 1024);
  try {
    const over = await req("PUT", "/api/scenes", `{ "start":"start", "scenes": { "start": { "text": ${JSON.stringify(huge)} } } }`);
    if (over.status !== 413) bug(`oversized scenes expected 413, got ${over.status}`);
    else if (!String(over.data?.error || "").toLowerCase().includes("too large")) {
      bug(`413 body missing too-large message: ${over.text?.slice(0, 120)}`);
    } else ok("oversized PUT /api/scenes → JSON 413");
  } catch (err) {
    bug(`oversized body threw instead of 413: ${err.message}`);
  }

  // ── empty create rejected ───────────────────────────────────
  const empty = await req("POST", "/api/projects", {});
  if (empty.status !== 400) bug(`empty create expected 400, got ${empty.status}`);
  else ok("empty POST /api/projects rejected");

  // ── failed import must not remember path ────────────────────
  const beforeSettings = await req("GET", "/api/settings");
  const prevImport = beforeSettings.data?.lastImportPath || "";
  const badImport = await req("POST", "/api/import", {
    kind: "folder",
    sourcePath: "D:\\definitely-not-a-real-import-path-zz",
    activate: false,
  });
  if (badImport.status === 200 && badImport.data?.ok) bug("bad import unexpectedly succeeded");
  const afterSettings = await req("GET", "/api/settings");
  if (afterSettings.data?.lastImportPath === "D:\\definitely-not-a-real-import-path-zz") {
    bug("failed import wrote lastImportPath");
  } else {
    ok(`failed import left lastImportPath alone (${afterSettings.data?.lastImportPath || "(empty)"} vs prev ${prevImport || "(empty)"})`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ── Save failure surfaces dialog ────────────────────────────
  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene-list li");
  await page.locator('#scene-list li[data-id="start"]').click();
  await page.click('[data-insp="story"]');
  await page.fill("#f-text", "RESILIENCE_SAVE_FAIL");
  await page.waitForTimeout(400);
  await page.route("**/api/scenes", async (route) => {
    await route.abort("failed");
  });
  await page.click("#btn-save");
  await page.waitForSelector("#log-dialog[open]", { timeout: 5000 }).catch(() => null);
  const saveDialog = await page.evaluate(() => ({
    open: Boolean(document.getElementById("log-dialog")?.open),
    title: document.getElementById("log-title")?.textContent || "",
    dirty: document.title.startsWith("•"),
  }));
  if (!saveDialog.open || !/save failed/i.test(saveDialog.title)) {
    bug(`save failure dialog missing: ${JSON.stringify(saveDialog)}`);
  } else ok("save network failure shows dialog");
  await page.evaluate(() => document.getElementById("log-dialog")?.close());
  await page.unroute("**/api/scenes");

  // ── CLI new --title (bare) must not create "true" ───────────
  page.on("dialog", async (d) => d.accept());
  await page.click("#mode-cli");
  await page.waitForSelector("#workspace-cli:not([hidden])");
  await page.fill("#cli-input", "new --title");
  await page.click('#cli-form button[type="submit"]');
  await page.waitForTimeout(800);
  const cliOut = await page.locator("#cli-out").innerText();
  if (fs.existsSync(path.join(root, "projects", "true"))) {
    bug('CLI `new --title` created projects/true');
  } else if (!/usage:/i.test(cliOut)) {
    bug(`CLI new --title output missing usage: ${cliOut.slice(-200)}`);
  } else ok("CLI new --title (no value) shows usage");

  // ── CLI use cancels when dirty + dialog dismissed ───────────
  await page.click("#mode-story");
  await page.waitForSelector("#workspace-story:not([hidden])");
  await page.locator('#scene-list li[data-id="start"]').click();
  const marker = `KEEP_DIRTY_${Date.now()}`;
  await page.fill("#f-text", marker);
  await page.waitForTimeout(900);

  // Create a second project to switch to
  await req("POST", "/api/projects", {
    title: "Resilience Smoke",
    projectId: "zz-resilience-smoke",
    activate: false,
    overwrite: true,
  });
  // Stay on sample in editor (server may have been left on sample)
  await req("PUT", "/api/settings", { activeProjectId: "sample-project" });

  page.removeAllListeners("dialog");
  let sawConfirm = false;
  page.on("dialog", async (d) => {
    sawConfirm = /unsaved/i.test(d.message());
    await d.dismiss();
  });
  await page.click("#mode-cli");
  await page.fill("#cli-input", "use zz-resilience-smoke");
  await page.click('#cli-form button[type="submit"]');
  await page.waitForTimeout(900);
  const afterCancel = await page.evaluate(() => ({
    text: document.getElementById("f-text")?.value || "",
    title: document.getElementById("project-title")?.textContent || "",
  }));
  const healthAfter = await req("GET", "/api/health");
  if (!sawConfirm) bug("CLI use dirty did not confirm discard");
  else if (!afterCancel.text.includes(marker)) bug("cancel discard lost editor text");
  else if (healthAfter.data?.activeProjectId !== "sample-project") {
    bug(`cancel discard still switched server to ${healthAfter.data?.activeProjectId}`);
  } else ok("CLI use cancels discard and keeps dirty edits");

  // ── Broken project switch reverts ───────────────────────────
  const brokenDir = path.join(root, "projects", "zz-broken-switch");
  fs.mkdirSync(path.join(brokenDir, "story"), { recursive: true });
  fs.writeFileSync(
    path.join(brokenDir, "project.json"),
    JSON.stringify(
      {
        formatVersion: 1,
        id: "zz-broken-switch",
        title: "Broken",
        start: "start",
        story: { scenes: "story/scenes.json" },
        theme: "theme/theme.json",
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(brokenDir, "story", "scenes.json"), "{ not-json");

  page.removeAllListeners("dialog");
  page.on("dialog", async (d) => d.accept());
  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene-list li");
  await page.click("#mode-projects");
  await page.waitForSelector("#workspace-projects:not([hidden])");
  await page.selectOption("#proj-active", "zz-broken-switch");
  await page.click("#btn-proj-open");
  await page.waitForSelector("#log-dialog[open]", { timeout: 8000 }).catch(() => null);
  const switchState = await page.evaluate(() => ({
    open: Boolean(document.getElementById("log-dialog")?.open),
    title: document.getElementById("log-title")?.textContent || "",
    projectTitle: document.getElementById("project-title")?.textContent || "",
    sceneCount: document.querySelectorAll("#scene-list li").length,
  }));
  const healthSwitch = await req("GET", "/api/health");
  if (!switchState.open) bug("broken switch did not show dialog");
  else if (healthSwitch.data?.activeProjectId !== "sample-project") {
    bug(`broken switch left active=${healthSwitch.data?.activeProjectId}`);
  } else if (!/sample/i.test(switchState.projectTitle) && switchState.sceneCount < 2) {
    bug(`broken switch left editor odd: ${JSON.stringify(switchState)}`);
  } else ok("broken project switch reverts to previous project");

  if (pageErrors.length) bug(`pageerrors: ${pageErrors.join(" | ")}`);

  await browser.close();
  await cleanupScratch();

  console.log("\nEditor resilience bugs:", bugs.length);
  if (bugs.length) process.exitCode = 1;
  else console.log("PASS: editor-resilience-smoke");
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    await cleanupScratch();
  } catch {
    /* ignore */
  }
});
