/**
 * Launch Illustrated IF Studio under Electron and exercise the backend
 * through the desktop window (fetch + UI), catching shell/API breakage.
 */
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
// Dedicated port — do not inherit a leftover PORT from the shell (avoids colliding with npm start).
const port = Number(process.env.IF_ELECTRON_TEST_PORT) || 8791;
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

const electronCli = path.join(studioRoot, "node_modules", "electron", "cli.js");
if (!fs.existsSync(electronCli)) {
  console.error("electron is not installed. Run: npm install electron");
  console.error("Or: .\\RUN-EDITOR.ps1  (installs on first launch)");
  process.exit(2);
}

console.log("=== Electron backend smoke ===");
console.log("Studio:", studioRoot);
console.log("Port:  ", port);

const app = await electron.launch({
  args: [studioRoot, "--headless", "--allow-multi"],
  cwd: studioRoot,
  env: {
    ...process.env,
    PORT: String(port),
    IF_PROJECT: path.join(studioRoot, "projects", "sample-project"),
    IF_ELECTRON_HEADLESS: "1",
    IF_ELECTRON_ALLOW_MULTI: "1",
    IF_REUSE_SERVER: "0",
    IF_ELECTRON_QUIT_MS: "",
  },
  timeout: 60000,
});

let win;
try {
  win = await app.firstWindow({ timeout: 45000 });
  console.log("Window:", await win.title());

  // Wait until editor + Electron marker are present
  await win.waitForSelector("#mode-story, #project-title", { timeout: 30000 });
  await win.waitForFunction(() => window.__IF_STUDIO_ELECTRON__?.shell === true, null, {
    timeout: 15000,
  });
  const marker = await win.evaluate(() => window.__IF_STUDIO_ELECTRON__);
  console.log("Electron marker:", JSON.stringify(marker));
  if (!marker?.shell) bug("Missing __IF_STUDIO_ELECTRON__ marker");
  if (Number(marker?.port) !== port) bug(`Port mismatch marker=${marker?.port} expected=${port}`);

  const desktop = await win.evaluate(() => window.ifStudioDesktop);
  console.log("Preload bridge:", JSON.stringify(desktop));
  if (!desktop?.isElectron) bug("preload ifStudioDesktop missing");

  // —— Backend through the app (same-origin fetch from renderer) ——
  const health = await win.evaluate(async () => {
    const r = await fetch("/api/health");
    return { status: r.status, body: await r.json() };
  });
  console.log("Health:", health.status, health.body?.activeProjectId);
  if (health.status !== 200 || !health.body?.ok) bug("health failed via Electron");
  if (health.body?.name !== "illustrated-if-studio") bug("unexpected studio name");

  const settings = await win.evaluate(async () => {
    const r = await fetch("/api/settings");
    return { status: r.status, body: await r.json() };
  });
  if (settings.status !== 200) bug("settings GET failed");
  console.log("Settings project:", settings.body?.activeProjectId);

  const projects = await win.evaluate(async () => {
    const r = await fetch("/api/projects");
    return { status: r.status, body: await r.json() };
  });
  if (projects.status !== 200 || !projects.body?.projects?.length) bug("projects list empty/failed");
  console.log("Projects:", projects.body.projects.map((p) => p.id).join(", "));

  const project = await win.evaluate(async () => {
    const r = await fetch("/api/project");
    return { status: r.status, body: await r.json() };
  });
  if (project.status !== 200) bug("project GET failed");
  const sceneCount = Object.keys(project.body?.scenes?.scenes || {}).length;
  console.log("Scenes:", sceneCount, "start=", project.body?.scenes?.start);
  if (sceneCount < 1) bug("no scenes loaded");

  const validate = await win.evaluate(async () => {
    const r = await fetch("/api/validate", { method: "POST" });
    return { status: r.status, body: await r.json() };
  });
  console.log("Validate:", validate.body?.ok, "errors=", (validate.body?.errors || []).length);
  if (validate.status !== 200) bug("validate HTTP failed");
  if (validate.body?.ok === false && (validate.body?.errors || []).length) {
    bug("validate reported errors: " + (validate.body.errors || []).slice(0, 3).join("; "));
  }

  // Raw export through Electron → custom dest
  const dest = path.join(studioRoot, "dist", "electron-smoke-raw");
  const rawExport = await win.evaluate(async (destination) => {
    const r = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "raw", destination, saveDestination: false }),
    });
    return { status: r.status, body: await r.json() };
  }, dest);
  console.log("Export raw:", rawExport.body?.ok, rawExport.body?.folder);
  if (!rawExport.body?.ok) bug("raw export failed: " + (rawExport.body?.error || rawExport.body?.output || ""));
  if (!String(rawExport.body?.folder || "").includes("electron-smoke-raw")) {
    bug("raw export folder unexpected: " + rawExport.body?.folder);
  }

  // HTML export
  const htmlExport = await win.evaluate(async () => {
    const r = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "html" }),
    });
    return { status: r.status, body: await r.json() };
  });
  console.log("Export html:", htmlExport.body?.ok, htmlExport.body?.downloadUrl || htmlExport.body?.zip);
  if (!htmlExport.body?.ok) bug("html export failed");

  // —— UI surfaces still work in Electron ——
  await win.click("#mode-cli");
  await win.waitForSelector("#workspace-cli:not([hidden])");
  await win.fill("#cli-input", "status");
  await win.press("#cli-input", "Enter");
  await win.waitForTimeout(500);
  const cliOut = await win.locator("#cli-out").innerText();
  if (!/illustrated-if-studio/i.test(cliOut) && !/sample-project/i.test(cliOut)) {
    bug("CLI status output missing in Electron: " + cliOut.slice(0, 200));
  } else {
    console.log("CLI status OK");
  }

  await win.click("#mode-projects");
  await win.waitForSelector("#workspace-projects:not([hidden])");
  await win.waitForFunction(
    () => (document.getElementById("proj-active-path")?.textContent || "").trim().length > 0,
    null,
    { timeout: 8000 }
  );
  const projPath = await win.locator("#proj-active-path").innerText();
  console.log("Projects pane path:", projPath);
  if (!/sample-project/i.test(projPath) && !/projects/i.test(projPath)) {
    bug("Projects pane path unexpected: " + projPath);
  }

  await win.click("#mode-story");
  await win.waitForSelector("#workspace-story:not([hidden])");
  const title = await win.locator("#project-title").innerText();
  console.log("Editor title:", title.trim());
  if (!/Sample Project/i.test(title)) bug("Editor title wrong: " + title);

  // Player route reachable from Electron origin
  const playerProbe = await win.evaluate(async () => {
    const r = await fetch("/engine-html/");
    const text = await r.text();
    return { status: r.status, hasNovel: /id="novel"|NovelEngine|engine/i.test(text) };
  });
  console.log("Player HTML:", playerProbe.status, "hasEngine=", playerProbe.hasNovel);
  if (playerProbe.status !== 200 || !playerProbe.hasNovel) bug("player route broken in Electron");
} catch (err) {
  bug("uncaught: " + (err?.message || err));
  console.error(err);
} finally {
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  // clean smoke export folder
  try {
    fs.rmSync(path.join(studioRoot, "dist", "electron-smoke-raw"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log("\nElectron smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
