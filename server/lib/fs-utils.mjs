import fs from "node:fs";
import path from "node:path";

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function copyDir(src, dest, { filter } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(entry, src)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to, { filter });
    else fs.copyFileSync(from, to);
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Move a project out of the way instead of deleting it, so that overwriting a
 * project during create/import stays recoverable. Someone's only copy of a
 * story is not something to delete on the strength of one confirm dialog.
 *
 * Returns the archive path, or null when there was nothing there.
 */
export function retireProject(projectDir) {
  if (!fs.existsSync(projectDir)) return null;
  const projectsRoot = path.dirname(projectDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trash = path.join(projectsRoot, ".replaced", `${path.basename(projectDir)}-${stamp}`);
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  try {
    fs.renameSync(projectDir, trash);
    return trash;
  } catch {
    // Different volume or a lock: fall back to a copy, then the usual delete.
    try {
      copyDir(projectDir, trash);
      removeDir(projectDir);
      return trash;
    } catch {
      removeDir(projectDir);
      return null;
    }
  }
}

/**
 * Recursively delete a staging/export directory.
 *
 * On Windows an antivirus scan of a freshly written binary briefly holds the
 * file open, and the delete fails with EPERM/EBUSY even though nothing owns
 * the handle a moment later. Retrying absorbs that window. If another process
 * still holds the tree (e.g. a running game .exe or a stuck cmake build),
 * fall back to renaming the folder out of the way so the export can proceed.
 */
export function removeDir(target) {
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return;
  } catch (err) {
    const code = err && err.code;
    if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw err;
  }
  // Last resort: move the locked tree aside so a fresh export can take its place.
  const parent = path.dirname(target);
  const base = path.basename(target);
  for (let i = 0; i < 20; i++) {
    const trash = path.join(parent, `${base}.old-${Date.now()}-${i}`);
    try {
      fs.renameSync(target, trash);
      // Best-effort background cleanup of the trash; ignore if still locked.
      try {
        fs.rmSync(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        /* leave trash for OS/user cleanup */
      }
      return;
    } catch {
      /* try another trash name */
    }
  }
  throw new Error(
    `Could not clear "${target}" — close any running game/build using that folder and try again.`
  );
}

function slugFingerprint(raw) {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function slugify(id) {
  const raw = String(id || "game");
  let s = raw
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!s) s = `p${slugFingerprint(raw)}`;
  if (WIN_RESERVED.test(s)) s = `game-${s}`;
  if (s.length > 60) {
    s = `${s.slice(0, 40).replace(/-$/, "")}-${slugFingerprint(raw)}`;
  }
  return s;
}

/**
 * Sanitize an uploaded asset basename so it cannot escape the assets folder
 * or hit Windows reserved device names / path-length traps.
 * @returns {{ ok: true, filename: string } | { ok: false, error: string }}
 */
export function safeAssetFilename(rawName, { maxLen = 120 } = {}) {
  let filename = path.basename(String(rawName || "").trim());
  // path.basename leaves a trailing NUL in the string on some inputs; strip controls.
  filename = filename.replace(/[\u0000-\u001F\u007F]/g, "");
  if (!filename || !/\.(png|jpe?g|webp|gif|svg)$/i.test(filename)) {
    return { ok: false, error: "filename must be an image (png/jpg/webp/gif/svg)" };
  }
  filename = filename.replace(/[^\w.\-]+/g, "_");
  if (!filename || filename === "." || filename === "..") {
    return { ok: false, error: "filename must be an image (png/jpg/webp/gif/svg)" };
  }
  const stem = filename.replace(/\.[^.]+$/, "");
  const ext = filename.slice(stem.length);
  if (WIN_RESERVED.test(stem)) {
    filename = `file-${stem}${ext}`;
  }
  if (filename.length > maxLen) {
    return { ok: false, error: `filename too long (max ${maxLen} characters)` };
  }
  return { ok: true, filename };
}

/** Strip controls / non-strings for package README labels. */
export function safeLabel(value, fallback = "Untitled") {
  if (typeof value !== "string") {
    if (value == null) return fallback;
    if (typeof value === "object") return fallback;
    value = String(value);
  }
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned || fallback;
}

export function listImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))
    .sort();
}
