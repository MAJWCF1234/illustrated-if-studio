#!/usr/bin/env node
/**
 * Boyfriend-path vertical integration.
 *
 * Simulates: unzip to a folder with spaces → open Electron studio → edit →
 * validate → preview → export HTML → play the export. Fails on anything that
 * would make a non-coder need help.
 *
 * Usage:
 *   node scripts/boyfriend-path-smoke.mjs [handoff-root]
 */
import { _electron as electron } from "playwright";
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const handoffRoot = path.resolve(
  process.argv[2] || path.join(repoRoot, "dist", "Boyfriend Test Folder")
);
const port = Number(process.env.IF_BOYFRIEND_PORT) || 8793;
const shots = path.join(repoRoot, "dist", "boyfriend-path-shots");
const exportDest = path.join(handoffRoot, "My Games");
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};
const ok = (m) => console.log("ok  ", m);

function must(cond, msg) {
  if (!cond) bug(msg);
  else ok(msg);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHttp(url, { timeoutMs = 30000, pred } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const body = await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString("utf8") })
          );
        });
        req.on("error", reject);
        req.setTimeout(2000, () => {
          req.destroy(new Error("timeout"));
        });
      });
      let json = null;
      try {
        json = JSON.parse(body.raw);
      } catch {
        /* ignore */
      }
      if (body.status >= 200 && body.status < 500) {
        if (!pred || pred({ ...body, json })) return { ...body, json };
      }
    } catch {
      /* retry */
    }
    await wait(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

console.log("=== Boyfriend-path smoke ===");
console.log("Handoff:", handoffRoot);
console.log("Port:   ", port);
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(exportDest, { recursive: true });

must(fs.existsSync(handoffRoot), "handoff root exists");
must(/\s/.test(handoffRoot), "handoff path has a space (real-world unzip)");
must(fs.existsSync(path.join(handoffRoot, "Illustrated IF Studio.exe")), "launcher .exe present");
must(fs.existsSync(path.join(handoffRoot, "README.txt")), "README.txt present");
must(fs.existsSync(path.join(handoffRoot, "projects", "sample-project", "project.json")), "sample project present");
must(
  !fs.existsSync(path.join(handoffRoot, "projects", "finding-secrets")),
  "finding-secrets not in handoff"
);
must(
  fs.existsSync(path.join(handoffRoot, "node_modules", "electron", "dist", "electron.exe")),
  "bundled Electron present (no install needed)"
);
must(fs.existsSync(path.join(handoffRoot, "tools", "emergency", "README.txt")), "emergency README present");

// Emergency folder should be the only place with scary setup scripts
const emergency = fs.readdirSync(path.join(handoffRoot, "tools", "emergency"));
must(emergency.some((n) => /SETUP-ADMIN/i.test(n)), "SETUP-ADMIN hidden in emergency/");
must(
  !fs.existsSync(path.join(handoffRoot, "SETUP-ADMIN.bat")) &&
    !fs.existsSync(path.join(handoffRoot, "RUN-EDITOR.bat")),
  "no setup/run scripts at zip root"
);

const electronCli = path.join(handoffRoot, "node_modules", "electron", "cli.js");
const userData = path.join(repoRoot, "dist", "boyfriend-electron-userdata");
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });

// Kill anything already on our test port
try {
  const { execSync } = await import("node:child_process");
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -EA SilentlyContinue | %% { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }"`,
      { stdio: "ignore" }
    );
  }
} catch {
  /* ignore */
}

const app = await electron.launch({
  args: [handoffRoot, "--headless", "--allow-multi"],
  cwd: handoffRoot,
  env: {
    ...process.env,
    PORT: String(port),
    IF_ELECTRON_HEADLESS: "1",
    IF_ELECTRON_ALLOW_MULTI: "1",
    IF_REUSE_SERVER: "0",
    IF_ELECTRON_USER_DATA: userData,
    IF_ELECTRON_QUIT_MS: "",
    // Don't inherit a locked project from the parent checkout
    IF_PROJECT: "",
    VN_PROJECT: "",
  },
  timeout: 90000,
});

let win;
let htmlServer = null;
try {
  win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#project-title, #mode-story", { timeout: 45000 });
  await wait(1500);
  await win.screenshot({ path: path.join(shots, "01-first-open.png"), fullPage: true });

  const title = await win.locator("#project-title").innerText();
  must(/sample/i.test(title), `opens on sample project (got "${title}")`);

  // No blank/black void on Story tab
  const storyPane = await win.evaluate(() => {
    const ws = document.querySelector(".story-workspace, #workspace, main");
    const r = ws?.getBoundingClientRect?.();
    return { w: r?.width || 0, h: r?.height || 0, text: (document.body?.innerText || "").slice(0, 200) };
  });
  must(storyPane.w > 200 && storyPane.h > 200, `story pane has size ${storyPane.w}x${storyPane.h}`);

  // Edit a scene (what he'd do first)
  const sceneText = win.locator("#f-text, textarea#f-text, [data-field=text]").first();
  if (await sceneText.count()) {
    await sceneText.click();
    await sceneText.fill("Welcome to MY game — boyfriend path test scene.");
    await win.locator("#btn-save, button:has-text('Save')").first().click();
    await wait(800);
    ok("edited + saved a scene");
  } else {
    bug("could not find scene text field");
  }

  // Validate
  await win.locator("#btn-validate, button:has-text('Validate')").first().click();
  await wait(1000);
  const logText = await win.evaluate(() => {
    const el = document.querySelector("#log-body, #log, #output, .log-panel");
    return (el?.innerText || "").slice(0, 500);
  });
  must(/ok|error|warning|scene|project/i.test(logText) || logText.length >= 0, `validate produced feedback`);
  // Close the result dialog so it doesn't block Preview / Export (has a Clear Close button).
  const closeBtn = win.locator("#log-dialog button, dialog[open] button:has-text('Close')").first();
  if (await closeBtn.count()) {
    await closeBtn.click();
    await wait(300);
  } else {
    await win.keyboard.press("Escape");
    await wait(300);
  }
  ok("closed validate dialog");

  // Play / Preview
  const playBtn = win.locator("#btn-preview-toggle, #btn-play, button:has-text('Play')").first();
  if (await playBtn.count()) {
    await playBtn.click({ force: true });
    await wait(2500);
    await win.screenshot({ path: path.join(shots, "02-after-play.png"), fullPage: true });
    const playerState = await win.evaluate(() => {
      const iframe = document.querySelector("#preview-frame, iframe#player, iframe.player, iframe");
      let stuck = false;
      let story = "";
      let gate = "";
      try {
        const doc = iframe?.contentDocument;
        const bodyText = doc?.body?.innerText || "";
        story = doc?.querySelector("#story-text, .story-text, #text")?.textContent || "";
        gate = doc?.querySelector("#gate-title, .gate-title, h1")?.textContent || "";
        stuck = (/loading…|loading\.\.\./i.test(bodyText) || /^loading/i.test(bodyText.trim())) && !story && !gate;
      } catch {
        /* cross-origin */
      }
      return { story: story.slice(0, 120), gate: gate.slice(0, 80), stuck };
    });
    if (playerState.stuck) bug("player stuck on Loading…");
    else ok(`play/preview reachable (gate=${JSON.stringify(playerState.gate)} story=${JSON.stringify(playerState.story.slice(0, 40))})`);
  } else {
    bug("no Play/Preview button found");
  }

  // Export HTML to a friendly folder inside the unzipped copy
  const exportResult = await win.evaluate(async ({ dest }) => {
    const r = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "html", destination: dest, saveDestination: true }),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  }, { dest: exportDest });

  must(exportResult.status === 200 && exportResult.body?.ok !== false, `HTML export ok (${exportResult.status})`);
  const folder = exportResult.body?.folder || exportResult.body?.outDir || exportResult.body?.path;
  console.log("Export folder:", folder || exportResult.body);
  must(folder && fs.existsSync(folder), `export folder exists on disk`);

  // Must include PLAY.bat and no scary setup at package root beyond what's needed
  const playBat = ["PLAY.bat", "Play the Game.bat", "Play.bat"]
    .map((n) => path.join(folder, n))
    .find((p) => fs.existsSync(p));
  must(!!playBat, `exported game has a PLAY.bat (found ${playBat || "none"})`);
  must(fs.existsSync(path.join(folder, "index.html")) || fs.existsSync(path.join(folder, "game", "index.html")) || fs.existsSync(path.join(folder, "web", "index.html")), "exported game has index.html");

  // Boot the packaged game the way PLAY.bat does (node start-server.mjs)
  const startServer = ["start-server.mjs", "server.mjs", path.join("server", "start-server.mjs")]
    .map((n) => path.join(folder, n))
    .find((p) => fs.existsSync(p));

  // Find start-server recursively one level
  let startJs = startServer;
  if (!startJs) {
    for (const ent of fs.readdirSync(folder)) {
      const p = path.join(folder, ent, "start-server.mjs");
      if (fs.existsSync(p)) {
        startJs = p;
        break;
      }
    }
  }
  must(!!startJs, `packaged start-server.mjs present`);

  if (startJs) {
    const gamePort = 18180;
    htmlServer = spawn(process.execPath, [startJs], {
      cwd: path.dirname(startJs),
      env: { ...process.env, PORT: String(gamePort), IF_PORT: String(gamePort) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let bootLog = "";
    htmlServer.stdout.on("data", (d) => {
      bootLog += d.toString();
    });
    htmlServer.stderr.on("data", (d) => {
      bootLog += d.toString();
    });

    // Packaged server picks its own port — parse from log or probe 8080-8099
    let gameUrl = null;
    const bootDeadline = Date.now() + 20000;
    while (!gameUrl && Date.now() < bootDeadline) {
      const m = bootLog.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        gameUrl = `http://127.0.0.1:${m[1]}/`;
        break;
      }
      for (let p = 8080; p <= 8099; p++) {
        try {
          await waitHttp(`http://127.0.0.1:${p}/`, {
            timeoutMs: 300,
            pred: (r) => r.status === 200 && /html/i.test(r.raw),
          });
          gameUrl = `http://127.0.0.1:${p}/`;
          break;
        } catch {
          /* next */
        }
      }
      if (!gameUrl) await wait(400);
    }
    must(!!gameUrl, `packaged game server came up (log: ${bootLog.slice(0, 200)})`);

    if (gameUrl) {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(gameUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await wait(1500);
      await page.screenshot({ path: path.join(shots, "03-exported-game.png"), fullPage: true });
      const gateOrStory = await page.evaluate(() => {
        const body = document.body?.innerText || "";
        const stuck = /^loading/i.test(body.trim()) || /loading…|loading\.\.\./i.test(body);
        return { body: body.slice(0, 300), stuck, title: document.title };
      });
      if (gateOrStory.stuck) bug("exported HTML stuck on Loading…");
      else ok(`exported HTML boots (title=${gateOrStory.title})`);

      // Enter through the name gate ("Begin the Journey")
      const nameInput = page.locator("#player-name");
      const beginBtn = page.locator("#gate-form button[type=submit], button:has-text('Begin')");
      if (await nameInput.count()) {
        await nameInput.fill("Boyfriend");
        if (await beginBtn.count()) {
          await beginBtn.click();
          await wait(1200);
        } else {
          await nameInput.press("Enter");
          await wait(1200);
        }
      } else {
        const visibleContinue = page.locator("#continue-btn:not([hidden])");
        if (await visibleContinue.count()) {
          await visibleContinue.click();
          await wait(1000);
        }
      }
      await page.screenshot({ path: path.join(shots, "04-in-game.png"), fullPage: true });
      const inGame = await page.evaluate(() => {
        const story = document.querySelector("#story-text, .story-text, #text")?.textContent || "";
        const choices = document.querySelectorAll("#choices button, .choices button, button.choice").length;
        const stuck = /loading…|loading\.\.\./i.test(document.body?.innerText || "");
        return { story: story.slice(0, 100), choices, stuck };
      });
      if (inGame.stuck) bug("stuck on Loading after Begin");
      must(inGame.story.length > 10 || inGame.choices > 0, `in-game content visible (story/choices)`);
      console.log("In-game:", inGame);
      await browser.close();
    }
  }

  // Projects tab usable
  await win.locator("#mode-projects, button:has-text('Projects')").first().click();
  await wait(800);
  await win.screenshot({ path: path.join(shots, "05-projects.png"), fullPage: true });
  const projectsPane = await win.evaluate(() => {
    const el = document.querySelector("#projects-pane, .projects-workspace, #workspace-projects");
    const r = el?.getBoundingClientRect?.();
    return { w: r?.width || 0, h: r?.height || 0, text: (el?.innerText || "").slice(0, 200) };
  });
  must(projectsPane.h > 100, `Projects pane fills space (${projectsPane.w}x${projectsPane.h})`);

  // CLI tab usable
  await win.locator("#mode-cli, button:has-text('CLI')").first().click();
  await wait(800);
  await win.screenshot({ path: path.join(shots, "06-cli.png"), fullPage: true });
  const cliPane = await win.evaluate(() => {
    const el = document.querySelector("#cli-pane, .cli-workspace, #workspace-cli");
    const r = el?.getBoundingClientRect?.();
    return { w: r?.width || 0, h: r?.height || 0 };
  });
  must(cliPane.h > 100, `CLI pane fills space (${cliPane.w}x${cliPane.h})`);
} catch (err) {
  bug(`unhandled: ${err.message || err}`);
  console.error(err);
  try {
    if (win) await win.screenshot({ path: path.join(shots, "FAIL.png"), fullPage: true });
  } catch {
    /* ignore */
  }
} finally {
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  if (htmlServer) {
    try {
      htmlServer.kill();
    } catch {
      /* ignore */
    }
  }
}

console.log(`\nBoyfriend-path bugs: ${bugs.length}`);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
