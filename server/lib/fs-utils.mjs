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
 * Recursively delete a staging/export directory.
 *
 * On Windows an antivirus scan of a freshly written binary briefly holds the
 * file open, and the delete fails with EPERM/EBUSY even though nothing owns
 * the handle a moment later. Retrying absorbs that window.
 */
export function removeDir(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export function slugify(id) {
  return String(id || "game").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export function listImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f))
    .sort();
}
