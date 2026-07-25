/**
 * Phase 1 roadmap smoke: new project + asset upload + art assign in editor.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

const projectId = "roadmap-mvp-demo";
// tiny 1x1 PNG
const pngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// cleanup leftover
fs.rmSync(path.join(studioRoot, "projects", projectId), { recursive: true, force: true });

let browser = null;

// Everything after the project is created lives in this try, so a failure
// anywhere — including launching the browser — still restores sample-project
// as the active project instead of leaving the demo active for later smokes.
try {
  const create = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, title: "Roadmap MVP Demo", author: "Studio", activate: true }),
  });
  const created = await create.json();
  console.log("Create:", create.status, created.ok, created.projectId);
  if (!created.ok) bug("create project failed: " + JSON.stringify(created));

  const upload = await fetch(`${base}/api/assets/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder: "scene_images",
      filename: "probe.png",
      dataUrl: `data:image/png;base64,${pngB64}`,
    }),
  });
  const uploaded = await upload.json();
  console.log("Upload:", upload.status, uploaded.ok, uploaded.filename);
  if (!uploaded.ok) bug("upload failed: " + JSON.stringify(uploaded));

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => bug("pageerror: " + e.message));

  await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#project-title");
  const title = await page.locator("#project-title").innerText();
  console.log("Editor title:", title.trim());
  if (!/Roadmap MVP Demo/i.test(title)) bug("editor did not open new project: " + title);

  await page.click('.insp-tab[data-insp="art"]');
  await page.waitForSelector("#asset-grid");
  await page.waitForTimeout(200);
  const tiles = await page.locator(".asset-tile").count();
  console.log("Asset tiles:", tiles);
  if (tiles < 1) bug("asset browser empty after upload");

  // click probe.png if present
  const probe = page.locator('.asset-tile[data-file="probe.png"]');
  if ((await probe.count()) > 0) {
    await probe.click();
    await page.waitForTimeout(150);
    const bg = await page.locator("#f-bg").inputValue();
    console.log("Assigned bg:", bg);
    if (bg !== "probe.png") bug("click assign failed: " + bg);
  } else {
    bug("probe.png tile missing");
  }

  // Projects recent / list
  await page.click("#mode-projects");
  await page.waitForSelector("#workspace-projects:not([hidden])");
  await page.waitForTimeout(300);
  const options = await page.locator("#proj-active option").allTextContents();
  if (!options.some((t) => t.includes(projectId))) bug("new project missing from dropdown");
} finally {
  await browser?.close().catch(() => {});
  // restore sample-project + delete demo
  await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeProjectId: "sample-project" }),
  }).catch(() => {});
  fs.rmSync(path.join(studioRoot, "projects", projectId), { recursive: true, force: true });
}

console.log("\nPhase1 roadmap smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
