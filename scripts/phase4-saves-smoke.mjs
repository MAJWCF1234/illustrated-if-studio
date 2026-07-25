/**
 * Phase 4 smoke: save labels + export/import save JSON in the HTML player.
 * Spawns its own studio server on a test port so it can run standalone.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PHASE4_PORT) || 8795;
const base = `http://127.0.0.1:${port}`;
const savesPath = path.join(studioRoot, "projects", "sample-project", "saves");
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(studioRoot, "server", "index.mjs")], {
      cwd: studioRoot,
      env: {
        ...process.env,
        PORT: String(port),
        IF_PROJECT: path.join(studioRoot, "projects", "sample-project"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf) => {
      if (!ready && buf.toString().includes("Player")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server exited early: ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("server start timeout"));
    }, 10000);
  });
}

fs.rmSync(savesPath, { recursive: true, force: true });
const server = await startServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ acceptDownloads: true });
page.on("pageerror", (e) => bug("pageerror: " + e.message));

// Prompt answers are consumed in order.
let promptQueue = [];
page.on("dialog", async (d) => {
  if (d.type() === "prompt") {
    const next = promptQueue.length ? promptQueue.shift() : d.defaultValue();
    await d.accept(next);
  } else {
    await d.accept();
  }
});

try {
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Labeler");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");
  await page.click('.pane-tabs .tab[data-tab="settings"]');
  await page.waitForSelector("#save-slots .save-slot");

  // 1) Save slot 1 with a custom label
  promptQueue = ["My Big Save"];
  await page.locator('.save-slot[data-slot="1"] [data-act="save"]').click();
  await page.waitForTimeout(400);
  const slot1File = path.join(savesPath, "slot-1.json");
  if (!fs.existsSync(slot1File)) bug("save did not write slot-1.json");
  else {
    const saved = JSON.parse(fs.readFileSync(slot1File, "utf8"));
    if (saved.label !== "My Big Save") bug(`label not persisted, got ${JSON.stringify(saved.label)}`);
  }
  let title1 = await page.locator('.save-slot[data-slot="1"] .save-slot-meta strong').innerText();
  if (title1 !== "My Big Save") bug(`slot title not shown, got "${title1}"`);

  // 2) Rename slot 1
  promptQueue = ["Renamed Save"];
  await page.locator('.save-slot[data-slot="1"] [data-act="rename"]').click();
  await page.waitForTimeout(400);
  title1 = await page.locator('.save-slot[data-slot="1"] .save-slot-meta strong').innerText();
  if (title1 !== "Renamed Save") bug(`rename not reflected, got "${title1}"`);

  // 3) Export slot 1 → capture download, verify JSON
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.save-slot[data-slot="1"] [data-act="export"]').click(),
  ]);
  const exportedPath = path.join(os.tmpdir(), `phase4-${Date.now()}.json`);
  await download.saveAs(exportedPath);
  const exported = JSON.parse(fs.readFileSync(exportedPath, "utf8"));
  if (exported.label !== "Renamed Save") bug("exported JSON missing renamed label");
  if (!exported.currentScene) bug("exported JSON missing currentScene");

  // 4) Clear slot 1, then import the exported file back into slot 1
  await page.locator('.save-slot[data-slot="1"] [data-act="clear"]').click();
  await page.waitForTimeout(300);
  if (fs.existsSync(slot1File)) bug("clear did not remove slot-1.json");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('.save-slot[data-slot="1"] [data-act="import"]').click(),
  ]);
  await chooser.setFiles(exportedPath);
  await page.waitForTimeout(500);
  if (!fs.existsSync(slot1File)) bug("import did not write slot-1.json");
  else {
    const reimported = JSON.parse(fs.readFileSync(slot1File, "utf8"));
    if (reimported.label !== "Renamed Save") bug("imported save lost label");
    if (reimported.currentScene !== exported.currentScene) bug("imported save scene mismatch");
  }
  title1 = await page.locator('.save-slot[data-slot="1"] .save-slot-meta strong').innerText();
  if (title1 !== "Renamed Save") bug(`imported slot title wrong, got "${title1}"`);

  fs.rmSync(exportedPath, { force: true });
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(savesPath, { recursive: true, force: true });
}

console.log("\nPhase4 saves smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
