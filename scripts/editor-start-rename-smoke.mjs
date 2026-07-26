/**
 * Permanent smoke: start-scene rename syncs project.json.start,
 * and export pins projectId so a mid-export project switch cannot retarget.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const SCRATCH = "zz-start-rename-smoke";

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

async function main() {
  const health = await api("GET", "/api/health");
  if (!health.ok) throw new Error("Studio down");

  await api("POST", "/api/projects", {
    title: "Start Rename Smoke",
    projectId: SCRATCH,
    activate: true,
    overwrite: true,
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("dialog", async (d) => d.accept());

  await page.goto(`${BASE}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene-list li");

  // Rename start → opening and save
  await page.locator('#scene-list li[data-id="start"]').click();
  await page.fill("#f-id", "opening");
  await page.locator("#f-id").press("Enter");
  await page.click("#btn-save");
  await page.waitForTimeout(600);

  const proj = JSON.parse(fs.readFileSync(path.join(root, "projects", SCRATCH, "project.json"), "utf8"));
  const scenes = JSON.parse(
    fs.readFileSync(path.join(root, "projects", SCRATCH, "story", "scenes.json"), "utf8")
  );
  if (proj.start !== "opening" || scenes.start !== "opening" || !scenes.scenes.opening) {
    fail(`start rename desync: project.start=${proj.start} scenes.start=${scenes.start}`);
  } else {
    console.log("OK: start rename syncs project.json + scenes.json");
  }

  // Export pin: start export with delayed route, try switch, ensure body carries projectId
  let sawPinned = false;
  await page.route("**/api/export", async (route) => {
    const post = route.request().postDataJSON() || {};
    sawPinned = post.projectId === SCRATCH;
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.click("#btn-export");
  await page.click('[data-export="raw"]');
  await page.click("#mode-projects");
  await page.selectOption("#proj-active", "sample-project");
  await page.click("#btn-proj-open");
  await page.waitForTimeout(1500);
  const toast = await page.evaluate(() => document.getElementById("toast")?.textContent || "");
  if (!sawPinned && !/Wait for the current export/i.test(toast)) {
    fail(`export not pinned and switch not blocked (toast=${toast})`);
  } else {
    console.log("OK: export pin/block mid-switch", { sawPinned, toast });
  }
  await page.unroute("**/api/export");

  await browser.close();

  await api("PUT", "/api/settings", { activeProjectId: "sample-project" });
  fs.rmSync(path.join(root, "projects", SCRATCH), { recursive: true, force: true });

  // prune recent
  const sp = path.join(root, "studio-settings.json");
  if (fs.existsSync(sp)) {
    const s = JSON.parse(fs.readFileSync(sp, "utf8"));
    s.recentProjects = (s.recentProjects || []).filter((x) => x !== SCRATCH);
    if (s.activeProjectId === SCRATCH) s.activeProjectId = "sample-project";
    fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  }

  const final = await api("GET", "/api/health");
  console.log("active:", final.data.activeProjectId);
  if (final.data.activeProjectId !== "sample-project") fail("did not restore sample-project");
  if (!process.exitCode) console.log("PASS: editor-start-rename-smoke");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
