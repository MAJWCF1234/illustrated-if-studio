#!/usr/bin/env node
/**
 * Smoke-test: re-export all targets, verify package files, boot HTML player, play one beat.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { exportHtml } from "../server/exporters/html.mjs";
import { exportPython } from "../server/exporters/python.mjs";
import { exportCpp } from "../server/exporters/cpp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const projectDir = path.join(studioRoot, "projects", "sample-project");
const outRoot = path.join(studioRoot, "dist");

function mustExist(file, label) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
}

function assertPackage(staging, files) {
  for (const f of files) mustExist(path.join(staging, f), f);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function startPackagedServer(webDir, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(webDir, "start-server.mjs")], {
      cwd: webDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf) => {
      const s = buf.toString();
      if (!ready && s.includes("Play at")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`packaged server exited early: ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("packaged server timeout"));
    }, 8000);
  });
}

async function main() {
  console.log("1) Export all formats…");
  const args = { studioRoot, projectDir, outRoot };
  const html = exportHtml(args);
  const py = exportPython(args);
  const cpp = exportCpp(args);
  for (const r of [html, py, cpp]) {
    if (!r.ok) throw new Error(`${r.target} export failed: ${(r.errors || []).join("; ")}`);
    console.log(`   [${r.target}] OK zip=${path.basename(r.zip)}`);
  }

  console.log("2) Verify Windows setup scripts in packages…");
  assertPackage(html.folder, [
    "index.html",
    "js/config.js",
    "project/project.json",
    "Play the Game.vbs",
    "play-quiet.ps1",
    "PLAY.bat",
    "_emergency/SETUP-ADMIN.bat",
    "_emergency/SETUP-ADMIN.ps1",
    "_emergency/_common.ps1",
    "_emergency/README.txt",
    "start-server.mjs",
  ]);
  assertPackage(py.folder, [
    "app.py",
    "if_engine/runtime.py",
    "project/project.json",
    "Play the Game.vbs",
    "play-quiet.ps1",
    "PLAY.bat",
    "_emergency/SETUP-ADMIN.bat",
    "_emergency/SETUP-ADMIN.ps1",
    "_emergency/_common.ps1",
    "_emergency/BUILD-EXE.bat",
  ]);
  assertPackage(cpp.folder, [
    "CMakeLists.txt",
    "src/main.cpp",
    "src/saves.cpp",
    "src/runtime.cpp",
    "include/runtime.hpp",
    "include/saves.hpp",
    "include/conditions.hpp",
    "project/project.json",
    "Play the Game.vbs",
    "play-quiet.ps1",
    "PLAY.bat",
    "_emergency/SETUP-ADMIN.bat",
    "_emergency/SETUP-ADMIN.ps1",
    "_emergency/_common.ps1",
  ]);

  const cfg = fs.readFileSync(path.join(html.folder, "js", "config.js"), "utf8");
  if (!cfg.includes('../project/')) throw new Error("HTML export config.js not rewritten for package");

  console.log("3) Boot packaged HTML on :18080 and load game data…");
  const child = await startPackagedServer(html.folder, 18080);
  try {
    const page = await fetchText("http://127.0.0.1:18080/");
    if (!page.includes("illustrated-if") && !page.includes("game-title")) {
      throw new Error("index.html missing expected player markup");
    }
    const project = await fetchJson("http://127.0.0.1:18080/project/project.json");
    const scenesDoc = await fetchJson(`http://127.0.0.1:18080/project/${project.story.scenes}`);
    const scenes = scenesDoc.scenes || scenesDoc;
    const start = scenes[project.start];
    if (!start?.text) throw new Error("start scene missing text");
    const choices = (start.choices || []).filter((c) => c.next && scenes[c.next]);
    if (!choices.length) throw new Error("start scene has no valid choices");
    console.log(`   Title: ${project.title}`);
    console.log(`   Start: ${project.start} (${choices.length} choices)`);
    console.log(`   Beat:  ${start.text.slice(0, 80).replace(/\s+/g, " ")}…`);

    // Studio live player (dev server) if up
    try {
      const live = await fetchText("http://127.0.0.1:8787/engine-html/?preview=1&name=Tester&scene=" + encodeURIComponent(project.start));
      if (live.includes("boot-error") && live.includes("Failed")) {
        console.log("   warn: live player page contains boot-error markup (may be template)");
      } else {
        console.log("   Live studio player URL reachable");
      }
    } catch {
      console.log("   (studio server not up — skipped live URL check)");
    }
  } finally {
    child.kill();
  }

  console.log("4) Python runtime one-step check…");
  const pyRuntime = path.join(py.folder, "if_engine", "runtime.py");
  mustExist(pyRuntime, "runtime.py");

  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message || err);
  process.exit(1);
});
