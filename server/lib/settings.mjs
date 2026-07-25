import fs from "node:fs";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs-utils.mjs";

const DEFAULTS = {
  activeProjectId: "sample-project",
  exportDestination: "", // empty → studioRoot/dist/raw-projects
  lastImportPath: "",
  recentProjects: [],
};

export function settingsPath(studioRoot) {
  return path.join(studioRoot, "studio-settings.json");
}

export function loadSettings(studioRoot) {
  const file = settingsPath(studioRoot);
  try {
    return { ...DEFAULTS, ...readJson(file) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(studioRoot, partial) {
  const next = { ...loadSettings(studioRoot), ...partial };
  writeJson(settingsPath(studioRoot), next);
  return next;
}

export function resolveExportDestination(studioRoot, override) {
  const settings = loadSettings(studioRoot);
  const chosen = (override || settings.exportDestination || "").trim();
  if (chosen) return path.resolve(chosen);
  return path.join(studioRoot, "dist", "raw-projects");
}

export function listProjects(studioRoot) {
  const root = path.join(studioRoot, "projects");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(root, d.name);
      let title = d.name;
      let author = "";
      try {
        const p = readJson(path.join(dir, "project.json"));
        title = p.title || d.name;
        author = p.author || "";
      } catch {
        /* skip */
      }
      return { id: d.name, title, author, path: dir };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export { ensureDir };
