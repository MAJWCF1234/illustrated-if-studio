#!/usr/bin/env node
/**
 * Export a Illustrated IF Studio project as a playable HTML folder (+ zip on Windows).
 * Usage: node illustrated-if-studio/scripts/export-html.mjs [projectDir] [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

// Point player at ./project/
fs.writeFileSync(
  path.join(staging, "js", "config.js"),
  `/** Packaged build — project shipped beside the engine. */\nexport const PROJECT_BASE = new URL("../project/", import.meta.url);\n`
);

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
fs.writeFileSync(
  path.join(staging, "start-server.mjs"),
  `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = { ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp" };
http.createServer((req,res)=>{
  let rel = decodeURIComponent((req.url||"/").split("?")[0]);
  if (rel === "/") rel = "/index.html";
  let file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file,(err,data)=>{
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200,{"Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream"});
    res.end(data);
  });
}).listen(port,()=>console.log("Play at http://127.0.0.1:"+port+"/"));
`
);

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
