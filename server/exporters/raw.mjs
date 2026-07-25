import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, readJson, removeDir, writeJson, slugify } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { mergeTheme, DEFAULT_THEME } from "../lib/theme-defaults.mjs";

function isProjectDir(dir) {
  return fs.existsSync(path.join(dir, "project.json"));
}

/** Copy the raw studio project folder (JSON + assets + theme) to destination. */
export function exportRawProject({ projectDir, destination, folderName }) {
  const report = validateProject(projectDir);
  if (!report.ok) {
    return { ok: false, target: "raw", errors: report.errors, warnings: report.warnings };
  }
  const project = report.project;
  const name = folderName || slugify(project.id);
  const destRoot = path.resolve(destination);
  ensureDir(destRoot);
  const outDir = path.join(destRoot, name);

  if (path.resolve(outDir) === path.resolve(projectDir)) {
    return { ok: false, target: "raw", errors: ["Destination is the same as the active project"] };
  }

  removeDir(outDir);
  copyDir(projectDir, outDir, {
    filter: (entry) => !entry.name.endsWith(".bak") && entry.name !== "node_modules",
  });

  // Ensure theme is fully merged defaults so exported raw projects are self-contained
  const themeRel = project.theme || "theme/theme.json";
  const themePath = path.join(outDir, themeRel);
  let theme = {};
  try {
    theme = readJson(themePath);
  } catch {
    /* create */
  }
  writeJson(themePath, mergeTheme(theme));

  const readme = path.join(outDir, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      `# ${project.title || project.id}

Raw **Illustrated IF Studio** project.

Open in the studio (set as active project) or import via **Import project folder**.

\`\`\`
project.json
story/
assets/
theme/
\`\`\`
`
    );
  }

  return {
    ok: true,
    target: "raw",
    folder: outDir,
    sceneCount: report.sceneCount,
    warnings: report.warnings,
    notes: report.notes,
  };
}

/**
 * Import an existing studio project folder into projects/<id>/.
 * @returns {{ ok, projectDir, projectId, created }}
 */
export function importProjectFolder({ studioRoot, sourcePath, projectId, overwrite = false }) {
  const opts = { overwrite: Boolean(overwrite) };
  const src = path.resolve(sourcePath);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return { ok: false, errors: [`Not a folder: ${src}`] };
  }
  if (!isProjectDir(src)) {
    return { ok: false, errors: [`No project.json in ${src}`] };
  }

  const srcProject = readJson(path.join(src, "project.json"));
  const id = slugify(projectId || srcProject.id || path.basename(src));
  const dest = path.join(studioRoot, "projects", id);

  if (path.resolve(src) === path.resolve(dest)) {
    return { ok: true, projectDir: dest, projectId: id, created: false, message: "Already the studio project path" };
  }

  if (fs.existsSync(dest) && !opts.overwrite) {
    return {
      ok: false,
      needsOverwrite: true,
      projectId: id,
      projectDir: dest,
      errors: [`Project "${id}" already exists. Pass overwrite: true to replace it.`],
    };
  }

  removeDir(dest);
  ensureDir(path.dirname(dest));
  copyDir(src, dest, {
    filter: (entry) => !entry.name.endsWith(".bak") && entry.name !== "node_modules",
  });

  // Normalize id in project.json
  const project = readJson(path.join(dest, "project.json"));
  project.id = id;
  if (!project.theme) project.theme = "theme/theme.json";
  if (!project.meta) project.meta = {};
  if (!project.meta.layout) project.meta.layout = "illustrated-if";
  writeJson(path.join(dest, "project.json"), project);

  const themePath = path.join(dest, project.theme);
  ensureDir(path.dirname(themePath));
  let theme = {};
  try {
    theme = readJson(themePath);
  } catch {
    theme = {};
  }
  writeJson(themePath, mergeTheme(theme));

  const report = validateProject(dest);
  return {
    ok: report.ok,
    projectDir: dest,
    projectId: id,
    created: true,
    errors: report.errors,
    warnings: report.warnings,
    sceneCount: report.sceneCount,
  };
}

export { isProjectDir, DEFAULT_THEME };
