#!/usr/bin/env node
/**
 * Illustrated IF Studio — Electron shell
 * Boots the local Node studio server (or reuses one), then opens the editor.
 */
import { app, BrowserWindow, shell, Menu, dialog } from "electron";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const preferredPort = Number(process.env.PORT) || 8787;
let port = preferredPort;
let baseUrl = process.env.STUDIO_URL || `http://127.0.0.1:${port}`;
const headless = process.env.IF_ELECTRON_HEADLESS === "1" || process.argv.includes("--headless");
const reuseServer = process.env.IF_REUSE_SERVER === "1" || process.argv.includes("--reuse-server");
const quitAfterMs = Number(process.env.IF_ELECTRON_QUIT_MS || 0);

let serverProc = null;
let mainWindow = null;
let ownedServer = false;

function editorUrl() {
  return `${baseUrl.replace(/\/$/, "")}/editor-web/`;
}

function setPort(next) {
  port = next;
  if (!process.env.STUDIO_URL) baseUrl = `http://127.0.0.1:${port}`;
}

/** Isolate lock + cache per studio folder so a handoff zip and a dev checkout can coexist. */
function configureUserData() {
  if (process.env.IF_ELECTRON_USER_DATA) {
    app.setPath("userData", process.env.IF_ELECTRON_USER_DATA);
    return;
  }
  const digest = crypto.createHash("sha1").update(studioRoot.toLowerCase()).digest("hex").slice(0, 12);
  app.setPath("userData", path.join(app.getPath("appData"), `illustrated-if-studio-${digest}`));
}

/** True when /api/health belongs to THIS studio folder (not another copy on the same port). */
function isOurStudio(health) {
  if (!health || typeof health !== "object") return false;
  if (health.studioRoot) {
    try {
      return path.resolve(String(health.studioRoot)) === studioRoot;
    } catch {
      return false;
    }
  }
  const projectDir = health.projectDir ? path.resolve(String(health.projectDir)) : "";
  if (!projectDir) return false;
  const root = studioRoot.endsWith(path.sep) ? studioRoot : studioRoot + path.sep;
  return projectDir === studioRoot || projectDir.startsWith(root);
}

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

function startServerOnPort(targetPort) {
  return new Promise((resolve, reject) => {
    setPort(targetPort);
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
    let settled = false;
    const failOnce = (err) => {
      if (settled) return;
      settled = true;
      stopServer();
      reject(err);
    };
    serverProc.stdout.on("data", (d) => process.stdout.write(d));
    serverProc.stderr.on("data", (d) => {
      const text = String(d);
      process.stderr.write(d);
      if (/EADDRINUSE|already in use/i.test(text)) {
        failOnce(new Error(`Port ${port} is already in use`));
      }
    });
    serverProc.on("exit", (code, signal) => {
      log("server exited", code, signal || "");
      serverProc = null;
      if (!settled && ownedServer && !mainWindow) {
        failOnce(new Error(`Studio server exited early (code ${code ?? "n/a"})`));
        return;
      }
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
    serverProc.on("error", failOnce);
    probeHealth(20000)
      .then((health) => {
        if (settled) return;
        if (!isOurStudio(health)) {
          failOnce(new Error("Studio server started but reported a different folder"));
          return;
        }
        settled = true;
        resolve(health);
      })
      .catch(failOnce);
  });
}

async function startServer() {
  const ports = [];
  for (let i = 0; i < 10; i++) ports.push(preferredPort + i);
  let lastErr = null;
  for (const candidate of ports) {
    try {
      return await startServerOnPort(candidate);
    } catch (err) {
      lastErr = err;
      log("port", candidate, "failed:", String(err?.message || err));
      stopServer();
    }
  }
  throw lastErr || new Error("Could not start studio server");
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
          click: () => shell.openExternal(editorUrl()),
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
    // Keep Play / engine-html inside the studio shell (no system browser).
    // External http(s) links still open in the default browser.
    try {
      const target = new URL(url);
      const origin = new URL(baseUrl).origin;
      if (target.origin === origin && target.pathname.startsWith("/engine-html")) {
        const win = new BrowserWindow({
          width: 1100,
          height: 720,
          title: "Illustrated IF — Play",
          backgroundColor: "#050208",
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        win.loadURL(url);
        return { action: "deny" };
      }
    } catch {
      /* fall through */
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const url = editorUrl();
  log("loading", url);
  await mainWindow.loadURL(url);

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

configureUserData();

const gotLock =
  process.env.IF_ELECTRON_ALLOW_MULTI === "1" || process.argv.includes("--allow-multi")
    ? true
    : app.requestSingleInstanceLock();
if (!gotLock) {
  log("another instance of this studio folder is running — quitting");
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
        if (!isOurStudio(health)) {
          throw new Error(
            "IF_REUSE_SERVER is set, but the server on this port belongs to a different studio folder."
          );
        }
        ownedServer = false;
      } else {
        try {
          health = await probeHealth(600);
          if (isOurStudio(health)) {
            log("server already up — reusing", health.activeProjectId || "");
            ownedServer = false;
          } else {
            log("foreign studio on port", port, "— starting our own");
            health = await startServer();
          }
        } catch {
          health = await startServer();
        }
      }
      log("health ok", health.name || "studio", health.activeProjectId || "", `PORT=${port}`);
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
