import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, removeDir, slugify, safeLabel } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { zipDirectory } from "../lib/zip.mjs";
import { installWindowsScripts } from "./windows-scripts.mjs";
import { PACKAGED_HTML_CONFIG_JS, PACKAGED_START_SERVER_JS } from "./packaged-html-config.mjs";

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

  fs.writeFileSync(path.join(staging, "js", "config.js"), PACKAGED_HTML_CONFIG_JS);

  fs.writeFileSync(
    path.join(staging, "README.txt"),
    `${safeLabel(project.title, slug)}
by ${safeLabel(project.author, "Unknown")}

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

  fs.writeFileSync(path.join(staging, "start-server.mjs"), PACKAGED_START_SERVER_JS);
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
