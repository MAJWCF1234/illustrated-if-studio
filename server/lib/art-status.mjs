import fs from "node:fs";
import path from "node:path";

/** Shipped with every new project, so it never counts as authored art. */
const PLACEHOLDER_ART = new Set(["default.svg"]);

/** Scene art the studio can supply itself rather than the creator. */
export function isPlaceholderArt(filename) {
  return PLACEHOLDER_ART.has(String(filename || "").toLowerCase());
}

/** Number of real (non-placeholder) images in assets/scene_images. */
export function countSceneArt(projectDir) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(projectDir, "assets", "scene_images"), {
      withFileTypes: true,
    });
  } catch {
    return 0;
  }
  return entries.filter((e) => e.isFile() && !isPlaceholderArt(e.name)).length;
}

/**
 * Whether a project is still illustrating. Art-optional projects collapse
 * their missing-art warnings into one summary line, so a story that is
 * written but not yet drawn validates and exports cleanly.
 *
 * `meta.artOptional` pins the answer in either direction; otherwise a project
 * counts as art-optional until its first real scene image lands.
 */
export function resolveArtOptional(projectDir, project) {
  const pinned = project?.meta?.artOptional;
  if (typeof pinned === "boolean") return pinned;
  return countSceneArt(projectDir) === 0;
}

/**
 * Turn the scene images a project referenced but does not have into either
 * one summary note (art-optional) or one warning per file (illustrated).
 */
export function reportMissingArt(missingFiles, artOptional) {
  const unique = [...new Set(missingFiles)];
  if (!unique.length) return { warnings: [], notes: [] };
  if (!artOptional) {
    return {
      warnings: unique.map((f) => `Missing art: assets/scene_images/${f}`),
      notes: [],
    };
  }
  return {
    warnings: [],
    notes: [
      `Art pending: ${unique.length} scene image${unique.length === 1 ? "" : "s"} not yet drawn — ` +
        `placeholder art is shown at runtime. Set meta.artOptional to false to list them individually.`,
    ],
  };
}
