import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ensureDir, retireProject, writeJson, slugify } from "./fs-utils.mjs";
import { mergeTheme } from "./theme-defaults.mjs";
import { validateProject } from "./validate.mjs";

/**
 * Import legacy HTML/txt with `const scenes = {...}` into a new studio project.
 */
/** Cap legacy HTML on disk so import cannot OOM the studio from a multi‑GB paste. */
const MAX_LEGACY_HTML_BYTES = 8 * 1024 * 1024;
/** Cap VM evaluation so hostile loops cannot hang the request thread. */
const LEGACY_VM_TIMEOUT_MS = 2000;

/** Own data properties only — never invoke getters (hostile scenes can hang otherwise). */
function ownDataEntries(obj) {
  if (!obj || typeof obj !== "object") return [];
  const out = [];
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc || !Object.prototype.hasOwnProperty.call(desc, "value")) continue;
    out.push([key, desc.value]);
  }
  return out;
}

function ownData(obj, key, fallback = undefined) {
  if (!obj || typeof obj !== "object") return fallback;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || !Object.prototype.hasOwnProperty.call(desc, "value")) return fallback;
  return desc.value;
}

export function importLegacyHtml({ studioRoot, sourcePath, projectId, title, author, overwrite = false }) {
  const src = path.resolve(sourcePath);
  if (!fs.existsSync(src)) return { ok: false, errors: [`File not found: ${src}`] };

  let stat;
  try {
    stat = fs.statSync(src);
  } catch (err) {
    return { ok: false, errors: [`Cannot read file: ${err.message}`] };
  }
  if (!stat.isFile()) return { ok: false, errors: [`Not a file: ${src}`] };
  if (stat.size > MAX_LEGACY_HTML_BYTES) {
    return {
      ok: false,
      errors: [`File too large (max ${MAX_LEGACY_HTML_BYTES} bytes)`],
    };
  }

  const html = fs.readFileSync(src, "utf8");
  const match = html.match(/const scenes = (\{[\s\S]*?\n\s*\});/);
  if (!match) {
    return { ok: false, errors: ["Could not find const scenes = {...} in the file"] };
  }

  const sandbox = {
    console,
    setTimeout: () => {},
    characterNameTagElement: { textContent: "" },
    loadProgress: () => "start",
    scenes: null,
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(`scenes = ${match[1]};`, sandbox, { timeout: LEGACY_VM_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, errors: [`Failed to parse scenes object: ${err.message}`] };
  }
  const scenes = sandbox.scenes;
  if (!scenes || typeof scenes !== "object" || Array.isArray(scenes)) {
    return { ok: false, errors: ["Parsed scenes is empty"] };
  }

  const id = slugify(projectId || path.basename(src, path.extname(src)) || "imported-game");
  const dest = path.join(studioRoot, "projects", id);
  if (fs.existsSync(dest) && !overwrite) {
    return {
      ok: false,
      needsOverwrite: true,
      projectId: id,
      projectDir: dest,
      errors: [`Project "${id}" already exists. Pass overwrite: true to replace it.`],
    };
  }
  const replaced = retireProject(dest);
  ensureDir(path.join(dest, "story"));
  ensureDir(path.join(dest, "assets", "scene_images"));
  ensureDir(path.join(dest, "assets", "characters"));
  ensureDir(path.join(dest, "assets", "audio"));
  ensureDir(path.join(dest, "theme"));

  const out = {};
  let migrated = 0;
  for (const [sid, s] of ownDataEntries(scenes)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const rawChoices = ownData(s, "choices", []);
    const choices = (Array.isArray(rawChoices) ? rawChoices : []).map((c) => {
      if (!c || typeof c !== "object") return { text: "", next: null };
      const choice = { text: ownData(c, "text", ""), next: ownData(c, "next", null) };
      const requiredAbility = ownData(c, "requiredAbility");
      if (requiredAbility) {
        choice.when = { hasAbility: requiredAbility };
        migrated++;
      }
      return choice;
    });
    const scene = {
      id: sid,
      sceneImage: ownData(s, "sceneImage", null),
      characterLeft: ownData(s, "characterLeft", null),
      characterRight: ownData(s, "characterRight", null),
      speaker: ownData(s, "speaker", null),
      text: ownData(s, "text", "") || "",
      unlockAbility: ownData(s, "unlockAbility", null),
      choices,
    };
    if (typeof ownData(s, "onEnter") === "function") {
      scene.hooks = { onEnter: `${sid}_on_enter` };
    }
    out[sid] = scene;
  }
  if (out.look_around?.hooks) {
    out.look_around.hooks.onEnter = "look_around_rename_speaker";
  }

  writeJson(path.join(dest, "story", "scenes.json"), {
    formatVersion: 1,
    start: out.start ? "start" : Object.keys(out)[0],
    scenes: out,
  });
  writeJson(path.join(dest, "story", "abilities.json"), { abilities: [] });
  writeJson(path.join(dest, "story", "characters.json"), { characters: [] });
  writeJson(path.join(dest, "story", "scripts.json"), {
    hooks: {
      look_around_rename_speaker: {
        description: "After 3s on look_around, rename speaker tag to EmmaLee if still on that scene.",
        runtime: { html: "look_around_rename_speaker" },
      },
    },
  });
  writeJson(path.join(dest, "theme", "theme.json"), mergeTheme(null));
  writeJson(path.join(dest, "project.json"), {
    formatVersion: 1,
    id,
    title: title || id,
    author: author || "",
    genre: "illustrated-text-rpg",
    start: out.start ? "start" : Object.keys(out)[0],
    story: {
      scenes: "story/scenes.json",
      characters: "story/characters.json",
      abilities: "story/abilities.json",
      scripts: "story/scripts.json",
    },
    theme: "theme/theme.json",
    meta: {
      keepAbilitiesOnRestart: true,
      layout: "illustrated-if",
      formatLabel: "Illustrated text-based RPG",
    },
  });

  // Seed default placeholder art if available from the bundled sample project
  const seedArt = path.join(studioRoot, "projects", "sample-project", "assets", "scene_images", "default.svg");
  if (fs.existsSync(seedArt)) {
    fs.copyFileSync(seedArt, path.join(dest, "assets", "scene_images", "default.svg"));
  }

  const report = validateProject(dest);
  return {
    ok: report.ok,
    projectDir: dest,
    projectId: id,
    sceneCount: Object.keys(out).length,
    abilityGates: migrated,
    errors: report.errors,
    warnings: report.warnings,
    replacedBackup: replaced,
  };
}
