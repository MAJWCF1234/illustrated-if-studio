import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, removeDir, slugify } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { zipDirectory } from "../lib/zip.mjs";
import { installWindowsScripts } from "./windows-scripts.mjs";

export function exportHtml({ studioRoot, projectDir, outRoot }) {
  const report = validateProject(projectDir);
  if (!report.ok) {
    return { ok: false, target: "html", errors: report.errors, warnings: report.warnings };
  }

  const project = report.project;
  const slug = slugify(project.id);
  const staging = path.join(outRoot, `${slug}-web`);
  const zipPath = path.join(outRoot, `${slug}-web.zip`);

  removeDir(staging);
  ensureDir(staging);
  copyDir(path.join(studioRoot, "engine-html"), staging);
  copyDir(projectDir, path.join(staging, "project"));

  fs.writeFileSync(
    path.join(staging, "js", "config.js"),
    `/** Packaged build */\nexport const PROJECT_BASE = new URL("../project/", import.meta.url);\n`
  );

  fs.writeFileSync(
    path.join(staging, "README.txt"),
    `${project.title}
by ${project.author || "Unknown"}

Illustrated text-based RPG (HTML package)

How to play (Windows)
---------------------
1. Double-click:  Play the Game
2. Your browser opens the game.

The first time, Windows may ask for permission to install a small helper
(Node.js) if it isn't already on this PC. Click YES — it needs the internet
once. After that, play is instant.

Do not open index.html by itself (file://) — browsers block the game data.

If something goes wrong
-----------------------
Open the _emergency folder and read README.txt. Technical PLAY.bat is also
in this folder if you need a black console for debugging.
`
  );

  fs.writeFileSync(
    path.join(staging, "start-server.mjs"),
    `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
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
  fs.writeFileSync(path.join(staging, "start-server.bat"), `@echo off\r\nnode "%~dp0start-server.mjs"\r\npause\r\n`);

  installWindowsScripts(staging, "html");
  zipDirectory(staging, zipPath);

  return {
    ok: true,
    target: "html",
    folder: staging,
    zip: zipPath,
    warnings: report.warnings,
    notes: report.notes,
    sceneCount: report.sceneCount,
  };
}
