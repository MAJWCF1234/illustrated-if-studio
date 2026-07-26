import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, removeDir, safeLabel, slugify } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { STATIC_SITE_CONFIG_JS } from "./packaged-html-config.mjs";

/** Export a plain static website that can be uploaded to hosts such as Neocities. */
export function exportStaticHtml({ studioRoot, projectDir, outRoot }) {
  const report = validateProject(projectDir);
  if (!report.ok) {
    return { ok: false, target: "site", errors: report.errors, warnings: report.warnings };
  }

  const project = report.project;
  const slug = slugify(project.id);
  const staging = path.join(outRoot, `${slug}-site`);

  removeDir(staging);
  ensureDir(staging);
  copyDir(path.join(studioRoot, "engine-html"), staging);
  // This folder is uploaded publicly, so never publish local saves or backups.
  copyDir(projectDir, path.join(staging, "project"), {
    filter: (entry) => entry.name !== "saves" && !entry.name.endsWith(".bak"),
  });
  fs.writeFileSync(path.join(staging, "js", "config.js"), STATIC_SITE_CONFIG_JS);
  fs.writeFileSync(
    path.join(staging, "README.txt"),
    `${safeLabel(project.title, slug)} - static website export

This folder is ready for a normal static web host such as Neocities.

HOW TO PUBLISH
--------------
1. Create or open your site on Neocities (or another static web host).
2. Upload EVERYTHING INSIDE this folder: index.html, css, js, and project.
3. Visit your site. Your game starts in the browser - no Node.js or server setup.

IMPORTANT
---------
Do not upload only index.html; the game also needs the css, js, and project folders.
Do not double-click index.html on your computer to test it. Browsers protect local
files, but any normal web host serves this folder correctly.

Saves live in the player's browser storage. They stay on that browser and device.
`
  );

  return {
    ok: true,
    target: "site",
    folder: staging,
    warnings: report.warnings,
    notes: ["Upload the contents of this folder to Neocities or another static web host."],
    sceneCount: report.sceneCount,
  };
}
