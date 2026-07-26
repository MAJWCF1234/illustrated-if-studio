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

/**
 * Folders an export must never be written into. Exporters clear their target
 * folder before writing, so a mistyped destination like "C:\Windows\System32"
 * is not just clutter — it is a delete-and-overwrite inside a system tree.
 */
function protectedRoots() {
  const roots = [];
  const add = (p) => {
    if (p) roots.push(path.resolve(p));
  };
  if (process.platform === "win32") {
    const winDir = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const sysDrive = process.env.SystemDrive || "C:";
    add(winDir);
    add(process.env.ProgramFiles || `${sysDrive}\\Program Files`);
    add(process.env["ProgramFiles(x86)"] || `${sysDrive}\\Program Files (x86)`);
    add(process.env.ProgramData || `${sysDrive}\\ProgramData`);
    add(`${sysDrive}\\Users`);
  } else {
    for (const p of ["/bin", "/sbin", "/usr", "/etc", "/var", "/System", "/Library", "/Applications"]) {
      add(p);
    }
  }
  return roots;
}

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Why a destination is unusable, in words a non-coder can act on, or null when
 * it is fine. `Users` itself is refused but `Users\name\Desktop` is allowed.
 */
export function describeUnsafeDestination(dir) {
  const resolved = path.resolve(dir);
  if (path.parse(resolved).root === resolved) {
    return `"${resolved}" is the top of a whole drive. Pick a folder inside it, like a "Games" folder on your Desktop.`;
  }
  for (const root of protectedRoots()) {
    const atRoot = resolved === root;
    if (atRoot || isWithin(resolved, root)) {
      // Per-user folders live under C:\Users but are perfectly good targets.
      if (!atRoot && /[\\/]users$/i.test(root)) continue;
      return `"${resolved}" is inside a Windows system folder (${root}). Pick somewhere personal instead, like your Desktop or Documents.`;
    }
  }
  return null;
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
    // Dot folders are studio bookkeeping (e.g. .replaced backups), not projects.
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
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
