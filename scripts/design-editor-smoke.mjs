/**
 * Permanent smoke for Design/Story editor bugs fixed in stress pass:
 *  1. Dirty flag clears when undo restores last-saved content
 *  2. Async art upload assigns to the scene that started the upload,
 *     even if the user switches scenes mid-flight
 *
 * Does not touch finding-secrets. Restores sample-project as active.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const SCRATCH = "zz-design-editor-smoke";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

async function api(method, urlPath, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function cleanup() {
  await api("PUT", "/api/settings", { activeProjectId: "sample-project" });
  fs.rmSync(path.join(root, "projects", SCRATCH), { recursive: true, force: true });
  const sp = path.join(root, "studio-settings.json");
  if (fs.existsSync(sp)) {
    const s = JSON.parse(fs.readFileSync(sp, "utf8"));
    s.recentProjects = (s.recentProjects || []).filter((x) => x !== SCRATCH);
    if (s.activeProjectId === SCRATCH) s.activeProjectId = "sample-project";
    if (!s.recentProjects.includes("sample-project")) s.recentProjects.unshift("sample-project");
    fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  }
}

async function main() {
  const health = await api("GET", "/api/health");
  if (!health.ok) throw new Error("Studio down — start node server/index.mjs");

  await api("POST", "/api/projects", {
    title: "Design Editor Smoke",
    projectId: SCRATCH,
    activate: true,
    overwrite: true,
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("dialog", async (d) => d.accept());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene-list li");

  // ── Dirty clears after undo-to-saved ──────────────────────────
  await page.locator('#scene-list li[data-id="start"]').click();
  await page.click('[data-insp="story"]');
  await page.fill("#f-text", "SMOKE_SAVED_TEXT");
  await page.waitForTimeout(900);
  await page.click("#btn-save");
  await page.waitForTimeout(600);
  const dirtyAfterSave = await page.evaluate(() => document.title.startsWith("•"));
  if (dirtyAfterSave) fail("still dirty after save");

  await page.fill("#f-text", "SMOKE_DIRTY_EDIT");
  await page.waitForTimeout(900);
  await page.click("#btn-undo");
  await page.waitForTimeout(250);
  const afterUndo = await page.evaluate(() => ({
    dirty: document.title.startsWith("•"),
    text: document.getElementById("f-text")?.value || "",
  }));
  if (afterUndo.text !== "SMOKE_SAVED_TEXT") {
    fail(`undo text mismatch: ${JSON.stringify(afterUndo.text)}`);
  } else if (afterUndo.dirty) {
    fail("dirty still set after undo restored saved content");
  } else {
    console.log("OK: dirty clears after undo-to-saved");
  }

  // ── Art upload sticks to originating scene ────────────────────
  await page.evaluate(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      if (String(url).includes("/api/assets/upload")) {
        await new Promise((r) => setTimeout(r, 1800));
      }
      return orig(input, init);
    };
  });

  await page.locator('#scene-list li[data-id="start"]').click();
  await page.click('[data-insp="art"]');
  await page.fill("#f-bg", "");
  await page.locator("#f-bg").dispatchEvent("change");
  await page.waitForTimeout(200);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator("#asset-file-input").setInputFiles({
    name: "smoke-pixel.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#scene-list li[data-id="continue"]')?.click());
  await page.waitForTimeout(2500);

  await page.locator('#scene-list li[data-id="start"]').click();
  await page.click('[data-insp="art"]');
  const startBg = await page.inputValue("#f-bg");
  await page.locator('#scene-list li[data-id="continue"]').click();
  await page.click('[data-insp="art"]');
  const contBg = await page.inputValue("#f-bg");

  if (!/smoke-pixel\.(png|jpg|jpeg)/i.test(startBg)) {
    fail(`start should keep upload target, got startBg=${startBg} contBg=${contBg}`);
  } else if (/smoke-pixel/i.test(contBg)) {
    fail(`continue must not receive start's upload, contBg=${contBg}`);
  } else {
    console.log("OK: art upload pinned to originating scene", { startBg, contBg });
  }

  if (pageErrors.length) fail(`pageerrors: ${pageErrors.join(" | ")}`);

  await browser.close();
  await cleanup();

  const final = await api("GET", "/api/health");
  console.log("active:", final.data.activeProjectId);
  if (final.data.activeProjectId !== "sample-project") fail("did not restore sample-project");
  if (!process.exitCode) console.log("PASS: design-editor-smoke");
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
});
