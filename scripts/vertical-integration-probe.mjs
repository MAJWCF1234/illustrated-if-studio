/**
 * Cold-handoff vertical integration probe.
 * Usage: node scripts/vertical-integration-probe.mjs "<handoff-root>"
 */
import { _electron as electron, chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");
const handoffRoot = path.resolve(process.argv[2] || defaultRoot);
const port = Number(process.env.IF_VERTICAL_PORT) || 8793;
const shots = path.join(handoffRoot, "_vertical-shots");
const exportDest = path.join(handoffRoot, "_vertical-exports");
const report = [];
const fail = (m) => {
  report.push({ ok: false, m });
  console.log("FAIL:", m);
};
const pass = (m) => {
  report.push({ ok: true, m });
  console.log("PASS:", m);
};

function must(cond, msg) {
  if (!cond) fail(msg);
  else pass(msg);
}

function startPackagedServer(webDir, p) {
  return new Promise((resolve, reject) => {
    const nodeBin = process.execPath;
    const script = path.join(webDir, "start-server.mjs");
    if (!fs.existsSync(script)) {
      reject(new Error(`missing start-server.mjs in ${webDir}`));
      return;
    }
    const child = spawn(nodeBin, [script], {
      cwd: webDir,
      env: { ...process.env, PORT: String(p) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let ready = false;
    let errBuf = "";
    const onData = (buf) => {
      const s = buf.toString();
      errBuf += s;
      if (!ready && s.includes("Play at")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => reject(new Error(`spawn failed (${nodeBin}): ${err.message}`)));
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`packaged server exited early: ${code}; ${errBuf.slice(0, 300)}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error(`packaged server timeout; ${errBuf.slice(0, 300)}`));
    }, 12000);
  });
}

async function assertPlayerBoots(baseUrl, label) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 25000 });
  await page.waitForFunction(
    () => {
      const title = document.getElementById("game-title")?.textContent?.trim() || "";
      const gate = document.getElementById("gate");
      const novel = document.getElementById("novel");
      const gateOpen = gate && !gate.hidden;
      const novelOpen = novel && !novel.hidden;
      return title.length > 0 && !/^Loading/i.test(title) && (gateOpen || novelOpen);
    },
    null,
    { timeout: 20000 }
  );
  const title = (await page.locator("#game-title").innerText()).trim();
  if (/^Loading/i.test(title)) throw new Error(`${label}: stuck Loading`);
  const shot = path.join(shots, `${label}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  await browser.close();
  if (errors.length) throw new Error(`${label} page errors: ${errors.join("; ")}`);
  return title;
}

function assertExportPackage(folder, target) {
  const need = [
    "Play the Game.vbs",
    "play-quiet.ps1",
    "PLAY.bat",
    "_emergency/SETUP-ADMIN.bat",
    "_emergency/SETUP-ADMIN.ps1",
    "_emergency/_common.ps1",
    "_emergency/README.txt",
  ];
  if (target === "html") need.push("index.html", "start-server.mjs", "project/project.json");
  if (target === "python") need.push("app.py", "if_engine/runtime.py", "project/project.json");
  if (target === "cpp") need.push("CMakeLists.txt", "src/main.cpp", "project/project.json");
  for (const f of need) {
    if (!fs.existsSync(path.join(folder, f))) fail(`${target} missing ${f}`);
  }
  // No root SETUP* — setup lives under _emergency only
  const rootFiles = fs.readdirSync(folder);
  const rootSetup = rootFiles.filter((n) => /^SETUP/i.test(n));
  must(rootSetup.length === 0, `${target}: no root SETUP (found ${rootSetup.join(",") || "none"})`);
  must(fs.existsSync(path.join(folder, "Play the Game.vbs")), `${target}: Play the Game.vbs present`);
}

console.log("=== Vertical integration probe ===");
console.log("Handoff:", handoffRoot);
console.log("Port:   ", port);
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(exportDest, { recursive: true });

must(fs.existsSync(path.join(handoffRoot, "Illustrated IF Studio.exe")), "launcher exe present");
must(fs.existsSync(path.join(handoffRoot, "projects", "sample-project")), "sample-project present");
const shippedProjects = fs
  .readdirSync(path.join(handoffRoot, "projects"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
must(
  shippedProjects.every((name) => name === "sample-project"),
  `handoff ships only the sample project (found: ${shippedProjects.join(", ")})`
);
must(/\s/.test(handoffRoot), "handoff path contains a space");

const electronCli = path.join(handoffRoot, "node_modules", "electron", "cli.js");
must(fs.existsSync(electronCli), "bundled electron present");

const app = await electron.launch({
  args: [handoffRoot, "--headless", "--allow-multi"],
  cwd: handoffRoot,
  env: {
    ...process.env,
    PORT: String(port),
    IF_PROJECT: path.join(handoffRoot, "projects", "sample-project"),
    IF_ELECTRON_HEADLESS: "1",
    IF_ELECTRON_ALLOW_MULTI: "1",
    IF_REUSE_SERVER: "0",
    IF_ELECTRON_QUIT_MS: "",
  },
  timeout: 90000,
});

let win;
try {
  win = await app.firstWindow({ timeout: 60000 });
  pass(`studio window: ${await win.title()}`);

  await win.waitForSelector("#mode-story, #project-title", { timeout: 45000 });
  await win.waitForFunction(() => window.__IF_STUDIO_ELECTRON__?.shell === true, null, {
    timeout: 20000,
  });
  pass("electron shell marker ready");

  // Wait until Loading… is gone from editor chrome
  await win.waitForFunction(
    () => {
      const t = (document.getElementById("project-title")?.textContent || "").trim();
      return t.length > 0 && !/^Loading/i.test(t);
    },
    null,
    { timeout: 30000 }
  );
  const editorTitle = (await win.locator("#project-title").innerText()).trim();
  must(/Sample Project/i.test(editorTitle), `editor title is Sample Project (${editorTitle})`);
  await win.screenshot({ path: path.join(shots, "studio-story.png") });

  // Design tab
  await win.click("#mode-design");
  await win.waitForSelector("#workspace-design:not([hidden])", { timeout: 10000 });
  pass("Design tab fills pane");
  await win.screenshot({ path: path.join(shots, "studio-design.png") });

  // Projects tab
  await win.click("#mode-projects");
  await win.waitForSelector("#workspace-projects:not([hidden])", { timeout: 10000 });
  await win.waitForFunction(
    () => (document.getElementById("proj-active-path")?.textContent || "").trim().length > 0,
    null,
    { timeout: 10000 }
  );
  const projPath = (await win.locator("#proj-active-path").innerText()).trim();
  must(/sample-project/i.test(projPath), `Projects pane path (${projPath})`);
  await win.screenshot({ path: path.join(shots, "studio-projects.png") });

  // CLI tab
  await win.click("#mode-cli");
  await win.waitForSelector("#workspace-cli:not([hidden])", { timeout: 10000 });
  await win.fill("#cli-input", "status");
  await win.press("#cli-input", "Enter");
  await win.waitForTimeout(800);
  const cliOut = await win.locator("#cli-out").innerText();
  must(
    /illustrated-if-studio|sample-project/i.test(cliOut),
    `CLI status usable (${cliOut.slice(0, 120).replace(/\s+/g, " ")})`
  );
  await win.screenshot({ path: path.join(shots, "studio-cli.png") });

  // Back to Story + open in-studio preview (toggle opens dock; start/here live inside toolbar)
  await win.click("#mode-story");
  await win.waitForSelector("#workspace-story:not([hidden])");
  const toggle = win.locator("#btn-preview-toggle");
  if (await toggle.count()) {
    await toggle.click();
  } else {
    await win.evaluate(() => {
      const btn = document.getElementById("btn-preview-toggle") || document.getElementById("btn-preview-here");
      if (btn) btn.click();
    });
  }
  await win.waitForSelector("#preview-dock:not([hidden])", { timeout: 15000 });
  const fromStart = win.locator("#btn-preview-start");
  if (await fromStart.isVisible().catch(() => false)) {
    await fromStart.click();
  }
  const frame = win.frameLocator("#preview-frame");
  await frame.locator("#game-title").waitFor({ timeout: 30000 });
  await win.waitForFunction(
    () => {
      const fr = document.getElementById("preview-frame");
      try {
        const doc = fr?.contentDocument;
        const title = doc?.getElementById("game-title")?.textContent?.trim() || "";
        const novel = doc?.getElementById("novel");
        const novelOpen = novel && !novel.hidden;
        const story = (doc?.getElementById("story-text")?.textContent || "").trim();
        return title.length > 0 && !/^Loading/i.test(title) && novelOpen && story.length > 0;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 25000 }
  );
  const previewTitle = (await frame.locator("#game-title").innerText()).trim();
  const storyLen = (await frame.locator("#story-text").innerText()).trim().length;
  must(
    previewTitle.length > 0 && !/^Loading/i.test(previewTitle) && storyLen > 0,
    `in-studio preview past Loading (title="${previewTitle}", storyChars=${storyLen})`
  );
  await win.screenshot({ path: path.join(shots, "studio-preview.png") });

  // Play ▶ should open an in-app player window at the name gate
  const playWait = app.waitForEvent("window", { timeout: 20000 });
  await win.click('a.btn.link[href="/engine-html/"]');
  const playWin = await playWait;
  await playWin.waitForFunction(
    () => {
      const title = document.getElementById("game-title")?.textContent?.trim() || "";
      const gate = document.getElementById("gate");
      const novel = document.getElementById("novel");
      return title.length > 0 && !/^Loading/i.test(title) && ((gate && !gate.hidden) || (novel && !novel.hidden));
    },
    null,
    { timeout: 25000 }
  );
  const playTitle = (await playWin.locator("#game-title").innerText()).trim();
  must(!/^Loading/i.test(playTitle), `Play window past Loading (title="${playTitle}")`);
  await playWin.screenshot({ path: path.join(shots, "studio-play.png") });
  try {
    await playWin.close();
  } catch {
    /* ignore */
  }

  // Exports into spaced dest under handoff
  const exportFolders = {};
  for (const target of ["html", "python", "cpp"]) {
    const destination = path.join(exportDest, `sample-${target}`);
    const result = await win.evaluate(
      async ({ target, destination }) => {
        const r = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, destination, saveDestination: false }),
        });
        return { status: r.status, body: await r.json() };
      },
      { target, destination }
    );
    must(result.body?.ok, `${target} export ok (${result.body?.error || result.body?.folder || ""})`);
    const folder = result.body?.folder || destination;
    exportFolders[target] = folder;
    must(fs.existsSync(folder), `${target} export folder exists (${folder})`);
    assertExportPackage(folder, target);
  }

  // HTML export player boot
  const htmlFolder = exportFolders.html;
  const child = await startPackagedServer(htmlFolder, 18090);
  try {
    const t = await assertPlayerBoots("http://127.0.0.1:18090/", "export-html-gate");
    pass(`HTML export player boots (title="${t}")`);
  } finally {
    child.kill();
  }

  // Python: pygame import + if_gui module load (no full GUI in headless CI-ish)
  const pyFolder = exportFolders.python;
  const pyCheck = spawnSync(
    "py",
    [
      "-c",
      "import sys; sys.path.insert(0, r'" +
        pyFolder.replace(/'/g, "\\'") +
        "'); import pygame; import if_gui; import if_engine; print('pygame', pygame.version.ver); print('gui', if_gui.__doc__.splitlines()[0] if if_gui.__doc__ else 'ok')",
    ],
    { encoding: "utf8", cwd: pyFolder }
  );
  if (pyCheck.status !== 0) {
    // try python
    const py2 = spawnSync(
      "python",
      [
        "-c",
        "import sys; sys.path.insert(0, r'" +
          pyFolder.replace(/'/g, "\\'") +
          "'); import pygame; import if_gui; print('ok', pygame.version.ver)",
      ],
      { encoding: "utf8", cwd: pyFolder }
    );
    must(py2.status === 0, `python pygame+if_gui import (${(py2.stderr || py2.stdout || "").slice(0, 200)})`);
  } else {
    pass(`python pygame+if_gui: ${(pyCheck.stdout || "").trim()}`);
  }
  // Ensure Play the Game.vbs references quiet play / not console-only terror
  const vbs = fs.readFileSync(path.join(pyFolder, "Play the Game.vbs"), "utf8");
  must(/play-quiet\.ps1/i.test(vbs), "Python Play the Game.vbs launches play-quiet.ps1");

  // C++ package structure + optional build already covered by check; verify Play path scripts
  const cppFolder = exportFolders.cpp;
  const cppVbs = fs.readFileSync(path.join(cppFolder, "Play the Game.vbs"), "utf8");
  must(/play-quiet\.ps1/i.test(cppVbs), "C++ Play the Game.vbs launches play-quiet.ps1");
  must(fs.existsSync(path.join(cppFolder, "src", "main.cpp")), "C++ raylib/src present");
} catch (err) {
  fail("uncaught: " + (err?.message || err));
  console.error(err);
  try {
    if (win) await win.screenshot({ path: path.join(shots, "failure.png") });
  } catch {
    /* ignore */
  }
} finally {
  try {
    await app.close();
  } catch {
    /* ignore */
  }
}

const fails = report.filter((r) => !r.ok);
console.log("\n=== Summary ===");
console.log(`Passed: ${report.filter((r) => r.ok).length}  Failed: ${fails.length}`);
fails.forEach((f) => console.log(" -", f.m));
process.exit(fails.length ? 1 : 0);
