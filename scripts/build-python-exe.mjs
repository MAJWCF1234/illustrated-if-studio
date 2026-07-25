#!/usr/bin/env node
/**
 * Export Python package then (optionally) invoke BUILD-EXE.ps1.
 * Usage: node scripts/build-python-exe.mjs [--skip-build]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportPython } from "../server/exporters/python.mjs";
import { loadSettings } from "../server/lib/settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const skipBuild = process.argv.includes("--skip-build");
const settings = loadSettings(studioRoot);
const projectDir = path.join(studioRoot, "projects", settings.activeProjectId || "sample-project");
const outRoot = path.join(studioRoot, "dist");

console.log("Exporting Python package…");
const result = exportPython({ studioRoot, projectDir, outRoot });
if (!result.ok) {
  console.error("Export failed:", (result.errors || []).join("\n"));
  process.exit(1);
}
console.log("Folder:", result.folder);
console.log("Zip:   ", result.zip);

const buildPs1 = path.join(result.folder, "BUILD-EXE.ps1");
if (skipBuild) {
  console.log("Skip build (--skip-build). Run BUILD-EXE.bat inside the folder when ready.");
  process.exit(0);
}
if (!fs.existsSync(buildPs1)) {
  console.error("BUILD-EXE.ps1 missing from export");
  process.exit(1);
}

console.log("Running PyInstaller via BUILD-EXE.ps1 (may take a few minutes)…");
const r = spawnSync(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", buildPs1],
  { cwd: result.folder, stdio: "inherit", shell: false }
);
process.exit(r.status ?? 1);
