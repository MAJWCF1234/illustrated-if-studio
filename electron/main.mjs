#!/usr/bin/env node
/**
 * Illustrated IF Studio — Electron shell
 * Boots the local Node studio server (or reuses one), then opens the editor.
 */
import { app, BrowserWindow, shell, Menu, dialog } from "electron";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT) || 8787;
const baseUrl = process.env.STUDIO_URL || `http://127.0.0.1:${port}`;
const editorUrl = `${baseUrl.replace(/\/$/, "")}/editor-web/`;
const headless = process.env.IF_ELECTRON_HEADLESS === "1" || process.argv.includes("--headless");
const reuseServer = process.env.IF_REUSE_SERVER === "1" || process.argv.includes("--reuse-server");
const quitAfterMs = Number(process.env.IF_ELECTRON_QUIT_MS || 0);

let serverProc = null;
let mainWindow = null;
let ownedServer = false;

function log(...args) {
  console.log("[electron]", ...args);
}

function fail(message, detail) {
  console.error("[electron]", message, detail || "");
  if (!headless) {
    dialog.showErrorBox("Illustrated IF Studio", detail ? `${message}\n\n${detail}` : message);
  }
  app.exit(1);
}

function resolveNodeBinary() {
  if (process.env.IF_NODE_BIN && fs.existsSync(process.env.IF_NODE_BIN)) {
    return process.env.IF_NODE_BIN;
  }
  // Prefer a real Node on PATH (not Electron.exe)
  const which = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(which, ["node"], { encoding: "utf8", windowsHide: true });
  const candidate = String(probe.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (candidate && fs.existsSync(candidate) && !/electron/i.test(candidate)) {
    return candidate;
  }
  // Fallback: run Electron binary as Node
  return process.execPath;
}

function probeHealth(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${baseUrl}/api/health`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve({ ok: true, raw: body });
            }
            return;
          }
          if (Date.now() > deadline) reject(new Error(`Health HTTP ${res.statusCode}`));
          else setTimeout(tryOnce, 200);
        });
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Studio server not reachable"));
        else setTimeout(tryOnce, 200);
      });
      req.setTimeout(1500, () => {
        req.destroy();
      });
    };
    tryOnce();
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const entry = path.join(studioRoot, "server", "index.mjs");
    const nodeBin = resolveNodeBinary();
    const env = { ...process.env, PORT: String(port) };
    // When falling back to Electron.exe, force Node mode
    if (path.basename(nodeBin).toLowerCase().includes("electron")) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    log("starting server", entry, `via ${nodeBin}`, `PORT=${port}`);
    serverProc = spawn(nodeBin, [entry], {
      cwd: studioRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    ownedServer = true;
    serverProc.stdout.on("data", (d) => process.stdout.write(d));
    serverProc.stderr.on("data", (d) => process.stderr.write(d));
    serverProc.on("exit", (code, signal) => {
      log("server exited", code, signal || "");
      serverProc = null;
      if (mainWindow && !mainWindow.isDestroyed() && ownedServer) {
        if (!headless) {
          dialog
            .showMessageBox(mainWindow, {
              type: "error",
              title: "Studio server stopped",
              message: "The local studio backend exited.",
              detail: `Exit code: ${code ?? "n/a"}${signal ? ` signal: ${signal}` : ""}\n\nReload after restarting, or quit the app.`,
              buttons: ["Reload", "Quit"],
              defaultId: 0,
              cancelId: 1,
            })
            .then(({ response }) => {
              if (response === 0) mainWindow.reload();
              else app.quit();
            })
            .catch(() => {});
        }
      }
    });
    serverProc.on("error", reject);
    probeHealth(20000).then(resolve).catch((err) => {
      stopServer();
      reject(err);
    });
  });
}

function stopServer() {
  if (!ownedServer || !serverProc || serverProc.killed) return;
  log("stopping server pid", serverProc.pid);
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(serverProc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      serverProc.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
  serverProc = null;
  ownedServer = false;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "Studio",
      submenu: [
        {
          label: "Reload Editor",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.reload(),
        },
        {
          label: "Open Player",
          accelerator: "CmdOrCtrl+P",
          click: () => {
            const win = new BrowserWindow({
              width: 1100,
              height: 720,
              title: "Illustrated IF — Play",
              backgroundColor: "#050208",
              webPreferences: { contextIsolation: true, nodeIntegration: false },
            });
            win.loadURL(`${baseUrl}/engine-html/`);
          },
        },
        {
          label: "Open in Browser",
          click: () => shell.openExternal(editorUrl),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(health) {
  const iconPath = path.join(__dirname, "icon.png");
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: !headless,
    title: `Illustrated IF Studio${health?.activeProjectId ? ` — ${health.activeProjectId}` : ""}`,
    backgroundColor: "#050208",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  log("loading", editorUrl);
  await mainWindow.loadURL(editorUrl);

  if (!headless) mainWindow.show();

  await mainWindow.webContents.executeJavaScript(
    `window.__IF_STUDIO_ELECTRON__ = ${JSON.stringify({
      shell: true,
      port,
      baseUrl,
      project: health?.activeProjectId || null,
    })}; true;`
  );
}

const gotLock =
  process.env.IF_ELECTRON_ALLOW_MULTI === "1" || process.argv.includes("--allow-multi")
    ? true
    : app.requestSingleInstanceLock();
if (!gotLock) {
  log("another instance is running — quitting");
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("com.illustratedif.studio");
  }

  app.whenReady().then(async () => {
    try {
      buildMenu();
      let health;
      if (reuseServer) {
        log("reusing existing server at", baseUrl);
        health = await probeHealth(5000);
        ownedServer = false;
      } else {
        try {
          health = await probeHealth(600);
          log("server already up — reusing", health.activeProjectId || "");
          ownedServer = false;
        } catch {
          health = await startServer();
        }
      }
      log("health ok", health.name || "studio", health.activeProjectId || "");
      await createWindow(health);

      if (quitAfterMs > 0) {
        setTimeout(() => app.quit(), quitAfterMs);
      }
    } catch (err) {
      fail("Failed to start Illustrated IF Studio", String(err?.stack || err?.message || err));
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    stopServer();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({}).catch((err) => console.error(err));
    }
  });
}
