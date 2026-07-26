#!/usr/bin/env node
/**
 * Build a clean handoff zip: unzip it, double-click, start writing a story.
 *
 * Ships node_modules by default so the recipient installs nothing, plus the
 * launcher, README.txt, and the sample project. Left out: .git, dist, root
 * *.zip, studio-settings.json, scratch files, and every project except the
 * sample — stories belong to their author and are usually already on the
 * machine the zip is going to.
 *
 * Usage:
 *   node tools/emergency/package-handoff.mjs
 *   node tools/emergency/package-handoff.mjs --projects sample-project,my-story
 *   node tools/emergency/package-handoff.mjs --all-projects
 *   node tools/emergency/package-handoff.mjs --out D:\Desktop\studio.zip
 *   node tools/emergency/package-handoff.mjs --no-node-modules   # smaller; first launch downloads Electron
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const opts = {
    projects: ["sample-project"],
    allProjects: false,
    includeNodeModules: true,
    out: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all-projects") opts.allProjects = true;
    else if (a === "--projects" && argv[i + 1]) {
      opts.projects = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--no-node-modules") opts.includeNodeModules = false;
    else if (a === "--out" && argv[i + 1]) opts.out = path.resolve(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Directory / file name basenames skipped everywhere. */
const SKIP_NAMES = new Set([
  ".git",
  ".github",
  ".cursor",
  ".vscode",
  "dist",
  "build",
  "build-exe",
  "dist-exe",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  "node_modules", // handled separately
  "studio-settings.json",
  ".gitattributes",
  ".gitignore",
  ".DS_Store",
  "Thumbs.db",
  "agent-transcripts",
  ".export-tools-offered",
  ".export-tools-ready",
]);

function shouldSkip(name, relPosix) {
  if (SKIP_NAMES.has(name)) return true;
  if (name.endsWith(".zip")) return true;
  if (name.endsWith(".bak")) return true;
  if (name.endsWith(".log")) return true;
  if (relPosix === "tools/logs") return true; // launcher diagnostics from this machine
  if (relPosix.startsWith("projects/") && relPosix.endsWith("/saves")) return true;
  if (relPosix.includes("/__pycache__/") || relPosix.endsWith("/__pycache__")) return true;
  return false;
}

/** A story folder the sender didn't ask to ship. Files under projects/ stay. */
function isUnwantedProject(relPosix, isDir, { allProjects, projects }) {
  if (!isDir || allProjects) return false;
  const match = /^projects\/([^/]+)$/.exec(relPosix);
  return match ? !projects.includes(match[1]) : false;
}

function copyTree(src, dest, opts) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    const rel = path.relative(studioRoot, from).split(path.sep).join("/");

    if (ent.name === "node_modules") continue; // optional second pass
    if (isUnwantedProject(rel, ent.isDirectory(), opts)) {
      console.log(`  skip ${rel} (use --projects or --all-projects to keep it)`);
      continue;
    }
    if (shouldSkip(ent.name, rel)) continue;

    if (ent.isDirectory()) {
      copyTree(from, to, opts);
    } else if (ent.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

function copyNodeModules(srcNm, destNm) {
  // Prefer robocopy on Windows for speed/reliability with huge trees.
  if (process.platform === "win32") {
    const r = spawnSync(
      "robocopy",
      [srcNm, destNm, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np", "/XD", "__pycache__"],
      { encoding: "utf8" }
    );
    // robocopy: 0–7 success-ish; >=8 failure
    if (r.status != null && r.status >= 8) {
      throw new Error(`robocopy node_modules failed (code ${r.status}): ${r.stderr || r.stdout || ""}`);
    }
    return;
  }
  fs.cpSync(srcNm, destNm, { recursive: true });
}

function zipStaging(staging, zipPath) {
  ensureDir(path.dirname(zipPath));
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  if (process.platform === "win32") {
    const ps = `
$ErrorActionPreference = 'Stop'
Compress-Archive -Path (Join-Path '${staging.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force
`;
    const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Compress-Archive failed: ${r.stderr || r.stdout}`);
    return;
  }
  const r = spawnSync("tar", ["-a", "-cf", zipPath, "-C", staging, "."], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar zip failed: ${r.stderr || r.stdout}`);
}

function listZipEntries(zipPath) {
  if (process.platform === "win32") {
    const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}').Entries | ForEach-Object { $_.FullName }
`;
    const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Could not inspect handoff zip: ${r.stderr || r.stdout}`);
    return String(r.stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  const r = spawnSync("tar", ["-tf", zipPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Could not inspect handoff zip: ${r.stderr || r.stdout}`);
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Verify the delivered archive itself, not just the folder we zipped. */
function verifyHandoffZip(zipPath, opts) {
  const entries = new Set(listZipEntries(zipPath).map((entry) => entry.replaceAll("\\", "/")));
  const required = [
    "Illustrated IF Studio.exe",
    "README.txt",
    "tools/launch-studio.ps1",
    "projects/sample-project/project.json",
  ];
  if (opts.includeNodeModules) required.push("node_modules/electron/dist/electron.exe");

  const missing = required.filter((entry) => !entries.has(entry));
  if (missing.length) throw new Error(`Handoff zip is missing: ${missing.join(", ")}`);
  if (entries.has("studio-settings.json")) throw new Error("studio-settings.json leaked into handoff zip");
  if ([...entries].some((entry) => entry.startsWith("dist/"))) {
    throw new Error("dist/ leaked into handoff zip");
  }

  if (!opts.allProjects) {
    const shipped = new Set();
    for (const entry of entries) {
      const match = /^projects\/([^/]+)\//.exec(entry);
      if (match) shipped.add(match[1]);
    }
    const extra = [...shipped].filter((name) => !opts.projects.includes(name));
    if (extra.length) throw new Error(`Projects leaked into handoff zip: ${extra.join(", ")}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node tools/emergency/package-handoff.mjs [options]

Options:
  --projects <a,b>    Story folders to ship (default: sample-project)
  --all-projects      Ship every project in projects/
  --no-node-modules   Omit node_modules (smaller; first launch downloads Electron)
  --out <path>        Output zip path (default: dist/illustrated-if-studio-handoff.zip)
`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const outZip =
    opts.out || path.join(studioRoot, "dist", `illustrated-if-studio-handoff-${stamp}.zip`);
  const staging = path.join(studioRoot, "dist", "_handoff-staging");

  console.log("Handoff packager");
  console.log(`  root:    ${studioRoot}`);
  console.log(`  staging: ${staging}`);
  console.log(`  out:     ${outZip}`);
  console.log(`  projects:     ${opts.allProjects ? "ALL" : opts.projects.join(", ") || "(none)"}`);
  console.log(`  node_modules: ${opts.includeNodeModules ? "INCLUDE" : "omit"}`);

  rmrf(staging);
  ensureDir(staging);

  console.log("Copying studio files…");
  copyTree(studioRoot, staging, opts);

  // Never ship machine-local settings — the recipient lands on the sample.
  const settings = path.join(staging, "studio-settings.json");
  if (fs.existsSync(settings)) fs.unlinkSync(settings);

  if (opts.includeNodeModules) {
    const srcNm = path.join(studioRoot, "node_modules");
    if (!fs.existsSync(srcNm)) {
      console.warn("  warn: no node_modules — zip will need first-run Electron download");
    } else {
      console.log("Copying node_modules (this can take a minute)…");
      copyNodeModules(srcNm, path.join(staging, "node_modules"));
    }
  }

  // Sanity: launcher + sample project must exist
  const launcherExe = path.join(staging, "Illustrated IF Studio.exe");
  const sample = path.join(staging, "projects", "sample-project", "project.json");
  if (!fs.existsSync(launcherExe) && !fs.existsSync(path.join(staging, "tools", "launch-studio.ps1"))) {
    throw new Error("Staging missing launcher (Illustrated IF Studio.exe or tools/launch-studio.ps1)");
  }
  if (!fs.existsSync(sample)) throw new Error("Staging missing projects/sample-project");
  if (fs.existsSync(path.join(staging, "studio-settings.json"))) {
    throw new Error("studio-settings.json leaked into staging");
  }
  // A story travelling inside a zip its author never meant to send is the one
  // mistake here that cannot be taken back, so fail loudly instead.
  if (!opts.allProjects) {
    const projectsDir = path.join(staging, "projects");
    const shipped = fs.existsSync(projectsDir)
      ? fs
          .readdirSync(projectsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];
    const extra = shipped.filter((name) => !opts.projects.includes(name));
    if (extra.length) throw new Error(`Projects leaked into staging: ${extra.join(", ")}`);
  }

  console.log("Zipping…");
  zipStaging(staging, outZip);
  verifyHandoffZip(outZip, opts);

  const mb = (fs.statSync(outZip).size / (1024 * 1024)).toFixed(1);
  console.log(`\nDone: ${outZip} (${mb} MB)`);
  console.log("Verified: launcher, offline runtime, sample project, and private-file exclusions.");
  console.log("Give him the zip + README.txt tip: Unzip → double-click Illustrated IF Studio.");
  console.log("(Staging folder left at dist/_handoff-staging for inspection; safe to delete.)");
}

main();
