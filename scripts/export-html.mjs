#!/usr/bin/env node
/**
 * Export a Illustrated IF Studio project as a playable HTML folder (+ zip on Windows).
 * Usage: node illustrated-if-studio/scripts/export-html.mjs [projectDir] [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  PACKAGED_HTML_CONFIG_JS,
  PACKAGED_START_SERVER_JS,
} from "../server/exporters/packaged-html-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const projectDir = path.resolve(process.argv[2] || path.join(studioRoot, "projects", "sample-project"));
const outRoot = path.resolve(process.argv[3] || path.join(studioRoot, "dist"));

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

// Validate first
const validate = spawnSync(process.execPath, [path.join(__dirname, "validate-project.mjs"), projectDir], {
  encoding: "utf8",
});
process.stdout.write(validate.stdout || "");
process.stderr.write(validate.stderr || "");
if (validate.status !== 0) {
  console.error("Export aborted: project has errors.");
  process.exit(1);
}

const project = readJson(path.join(projectDir, "project.json"));
const slug = (project.id || "game").replace(/[^a-z0-9-]/gi, "-");
const staging = path.join(outRoot, `${slug}-web`);

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

// Engine
copyDir(path.join(studioRoot, "engine-html"), staging);

// Project payload
const projectOut = path.join(staging, "project");
copyDir(projectDir, projectOut);

// Point player at ./project/ (must export initProjectBase — main.js imports it)
fs.writeFileSync(path.join(staging, "js", "config.js"), PACKAGED_HTML_CONFIG_JS);

// Friendly readme for the zip
fs.writeFileSync(
  path.join(staging, "README.txt"),
  `${project.title || slug}
by ${project.author || "Unknown"}

How to play
-----------
Option A: Double-click start-server (if present), then open the URL it prints.
Option B: Serve this folder with any static server, e.g.:
  npx --yes serve .
  python -m http.server 8080

Opening index.html via file:// will not load JSON in most browsers.
`
);

// Tiny starter for Windows/mac/linux using the studio serve pattern inlined
fs.writeFileSync(path.join(staging, "start-server.mjs"), PACKAGED_START_SERVER_JS);

fs.writeFileSync(
  path.join(staging, "start-server.bat"),
  `@echo off\r\nnode "%~dp0start-server.mjs"\r\npause\r\n`
);

// Zip via PowerShell when available
const zipPath = path.join(outRoot, `${slug}-web.zip`);
fs.rmSync(zipPath, { force: true });
let zipped = false;
if (process.platform === "win32") {
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: "utf8" }
  );
  zipped = ps.status === 0 && fs.existsSync(zipPath);
  if (!zipped) process.stderr.write(ps.stderr || ps.stdout || "zip failed\n");
}

console.log(`Exported folder: ${staging}`);
if (zipped) console.log(`Exported zip:    ${zipPath}`);
else console.log("Zip skipped (folder export only).");
