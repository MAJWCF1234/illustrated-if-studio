import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ensureDir, readJson, removeDir, writeJson, slugify, copyDir } from "./fs-utils.mjs";
import { mergeTheme } from "./theme-defaults.mjs";
import { validateProject } from "./validate.mjs";

/**
 * Import legacy HTML/txt with `const scenes = {...}` into a new studio project.
 */
export function importLegacyHtml({ studioRoot, sourcePath, projectId, title, author, overwrite = false }) {
  const src = path.resolve(sourcePath);
  if (!fs.existsSync(src)) return { ok: false, errors: [`File not found: ${src}`] };

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
    vm.runInContext(`scenes = ${match[1]};`, sandbox);
  } catch (err) {
    return { ok: false, errors: [`Failed to parse scenes object: ${err.message}`] };
  }
  const scenes = sandbox.scenes;
  if (!scenes || typeof scenes !== "object") {
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
  removeDir(dest);
  ensureDir(path.join(dest, "story"));
  ensureDir(path.join(dest, "assets", "scene_images"));
  ensureDir(path.join(dest, "assets", "characters"));
  ensureDir(path.join(dest, "assets", "audio"));
  ensureDir(path.join(dest, "theme"));

  const out = {};
  let migrated = 0;
  for (const [sid, s] of Object.entries(scenes)) {
    const choices = (s.choices || []).map((c) => {
      const choice = { text: c.text, next: c.next };
      if (c.requiredAbility) {
        choice.when = { hasAbility: c.requiredAbility };
        migrated++;
      }
      return choice;
    });
    const scene = {
      id: sid,
      sceneImage: s.sceneImage || null,
      characterLeft: s.characterLeft || null,
      characterRight: s.characterRight || null,
      speaker: s.speaker || null,
      text: s.text || "",
      unlockAbility: s.unlockAbility || null,
      choices,
    };
    if (typeof s.onEnter === "function") {
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
  };
}
