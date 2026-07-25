/**
 * Verify project switch updates editor asset URLs (no hardcoded project id).
 * Needs a second project folder — creates a temporary clone if needed.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importProjectFolder } from "../server/exporters/raw.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

const tempId = "switch-art-probe";
const src = path.join(studioRoot, "projects", "sample-project");
const imported = importProjectFolder({
  studioRoot,
  sourcePath: src,
  projectId: tempId,
  overwrite: true,
});
if (!imported.ok) {
  console.error(imported.errors);
  process.exit(1);
}

let browser = null;

// The probe project exists from here on, so the try must cover the browser
// launch too — otherwise a launch failure strands switch-art-probe on disk.
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => bug("pageerror: " + e.message));

  await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#project-title");

  // Ensure we start on the sample project
  await page.evaluate(async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeProjectId: "sample-project" }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#art-preview-bg, #project-title");

  const artBefore = await page.locator("#art-preview-bg").getAttribute("src");
  console.log("Art before:", artBefore);
  if (artBefore && !/\/projects\/sample-project\//.test(artBefore)) {
    bug("Expected sample-project art URL before switch: " + artBefore);
  }

  // Switch via API + reload like Projects tab
  await page.evaluate(async (id) => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeProjectId: id }),
    });
  }, tempId);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#art-preview-bg", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(300);

  const title = await page.locator("#project-title").innerText();
  const artAfter = await page.locator("#art-preview-bg").getAttribute("src");
  console.log("Title after:", title.trim());
  console.log("Art after:", artAfter);

  if (artAfter && /\/projects\/sample-project\//.test(artAfter)) {
    bug("Art URL still on sample-project after switch: " + artAfter);
  }
  if (artAfter && !new RegExp(`/projects/${tempId}/`).test(artAfter)) {
    bug("Art URL missing new project id: " + artAfter);
  }
  if (!artAfter) bug("Art preview src empty after switch");

  // Switch back
  await page.evaluate(async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeProjectId: "sample-project" }),
    });
  });
} finally {
  await browser?.close().catch(() => {});
  fs.rmSync(path.join(studioRoot, "projects", tempId), { recursive: true, force: true });
  // restore active project
  try {
    await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeProjectId: "sample-project" }),
    });
  } catch {
    /* ignore */
  }
}

console.log("\nProject-switch art bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
