#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportHtml } from "./exporters/html.mjs";
import { exportPython } from "./exporters/python.mjs";
import { exportCpp } from "./exporters/cpp.mjs";
import { exportRawProject } from "./exporters/raw.mjs";
import { loadSettings, resolveExportDestination } from "./lib/settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const outRoot = path.join(studioRoot, "dist");

const [, , cmd, target, projectArg] = process.argv;
const settings = loadSettings(studioRoot);
const projectDir = path.resolve(
  projectArg ||
    process.env.IF_PROJECT ||
    process.env.VN_PROJECT ||
    path.join(studioRoot, "projects", settings.activeProjectId || "sample-project")
);

const known = ["html", "python", "cpp", "raw", "all"];
if (cmd !== "export" || !known.includes(target)) {
  console.log(`Usage:
  node server/cli.mjs export <html|python|cpp|raw|all> [projectDir]

Examples:
  npm run export:html
  npm run export:python
  npm run export:cpp
  npm run export:raw
  node server/cli.mjs export all
`);
  process.exit(1);
}

const exporters = {
  html: exportHtml,
  python: exportPython,
  cpp: exportCpp,
  raw: ({ studioRoot, projectDir }) =>
    exportRawProject({
      projectDir,
      destination: resolveExportDestination(studioRoot),
    }),
};

const targets = target === "all" ? ["html", "python", "cpp", "raw"] : [target];
let failed = false;

for (const t of targets) {
  const result = exporters[t]({ studioRoot, projectDir, outRoot });
  if (!result.ok) {
    failed = true;
    console.error(`[${t}] FAILED`);
    for (const e of result.errors || []) console.error(" ", e);
    continue;
  }
  console.log(`[${t}] OK — ${result.sceneCount ?? "?"} scenes`);
  if (result.folder) console.log(`  folder ${result.folder}`);
  if (result.zip) console.log(`  zip    ${result.zip}`);
  for (const w of (result.warnings || []).slice(0, 8)) console.log(`  warn  ${w}`);
  for (const n of result.notes || []) console.log(`  note  ${n}`);
}

process.exit(failed ? 1 : 0);
