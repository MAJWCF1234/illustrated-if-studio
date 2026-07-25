import fs from "node:fs";
import path from "node:path";
import { ensureDir, removeDir, writeJson, slugify } from "./fs-utils.mjs";
import { mergeTheme, DEFAULT_THEME } from "./theme-defaults.mjs";

const DEFAULT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#12081c"/>
      <stop offset="100%" stop-color="#3b0764"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <text x="400" y="230" text-anchor="middle" fill="#c084fc" font-family="Georgia, serif" font-size="42">Illustrated IF</text>
</svg>
`;

/**
 * Create a new empty studio project under projects/<id>/.
 */
export function createProject({ studioRoot, projectId, title, author, overwrite = false }) {
  const id = slugify(projectId || title || "new-game");
  if (!id) return { ok: false, errors: ["Invalid project id"] };

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

  const displayTitle = String(title || id).trim() || id;
  const project = {
    formatVersion: 1,
    id,
    title: displayTitle,
    author: String(author || "").trim(),
    genre: "illustrated-text-rpg",
    start: "start",
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
      // A new story is written before it is drawn; flip to false once the
      // art pass starts and every missing image is listed individually.
      artOptional: true,
    },
  };

  writeJson(path.join(dest, "project.json"), project);
  writeJson(path.join(dest, "story", "scenes.json"), {
    formatVersion: 1,
    start: "start",
    scenes: {
      start: {
        id: "start",
        sceneImage: "default.svg",
        characterLeft: null,
        characterRight: null,
        speaker: null,
        text: `Welcome to ${displayTitle}.\n\nEdit this opening beat, add scenes from the editor, and drop art onto the Art tab.`,
        unlockAbility: null,
        choices: [
          { text: "Look around", next: "look_around" },
          { text: "Continue", next: "continue" },
        ],
      },
      look_around: {
        id: "look_around",
        sceneImage: "default.svg",
        characterLeft: null,
        characterRight: null,
        speaker: null,
        text: "You take in the scene. Add more story and actions here.",
        unlockAbility: null,
        choices: [{ text: "Back to the start", next: "start" }],
      },
      continue: {
        id: "continue",
        sceneImage: "default.svg",
        characterLeft: null,
        characterRight: null,
        speaker: null,
        text: "The path continues. Link new scenes from the graph and Actions tab.",
        unlockAbility: null,
        choices: [{ text: "Return", next: "start" }],
      },
    },
  });
  writeJson(path.join(dest, "story", "characters.json"), { formatVersion: 1, characters: {} });
  writeJson(path.join(dest, "story", "abilities.json"), { formatVersion: 1, abilities: {} });
  writeJson(path.join(dest, "story", "scripts.json"), { formatVersion: 1, scripts: {} });
  writeJson(path.join(dest, "theme", "theme.json"), mergeTheme({ ...DEFAULT_THEME }));
  fs.writeFileSync(path.join(dest, "assets", "scene_images", "default.svg"), DEFAULT_SVG, "utf8");
  fs.writeFileSync(
    path.join(dest, "README.md"),
    `# ${displayTitle}\n\nCreated in **Illustrated IF Studio**.\n\nOpen via the Projects tab or CLI: \`use ${id}\`\n`
  );

  return {
    ok: true,
    projectId: id,
    projectDir: dest,
    created: true,
    sceneCount: 3,
  };
}
