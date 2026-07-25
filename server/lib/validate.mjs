import fs from "node:fs";
import path from "node:path";
import { readJson } from "./fs-utils.mjs";
import { resolveArtOptional, reportMissingArt } from "./art-status.mjs";

export function validateProject(projectDir) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const projectPath = path.join(projectDir, "project.json");
  if (!fs.existsSync(projectPath)) {
    return { ok: false, errors: ["Missing project.json"], warnings, notes };
  }
  const project = readJson(projectPath);
  if (project.formatVersion !== 1) errors.push(`Unsupported formatVersion: ${project.formatVersion}`);

  const scenesPath = path.join(projectDir, project.story?.scenes || "story/scenes.json");
  if (!fs.existsSync(scenesPath)) {
    errors.push(`Missing scenes file: ${project.story?.scenes}`);
    return { ok: false, errors, warnings, notes, project };
  }
  const scenesDoc = readJson(scenesPath);
  const scenes = scenesDoc.scenes || scenesDoc;
  const ids = new Set(Object.keys(scenes));

  if (!ids.has(project.start)) errors.push(`Start scene missing: ${project.start}`);

  let scripts = { hooks: {} };
  try {
    if (project.story?.scripts) {
      scripts = readJson(path.join(projectDir, project.story.scripts));
    }
  } catch {
    warnings.push("No scripts.json");
  }

  const artOptional = resolveArtOptional(projectDir, project);
  const missingArt = [];

  const inbound = Object.fromEntries([...ids].map((id) => [id, 0]));
  for (const [id, scene] of Object.entries(scenes)) {
    if (!scene.text) errors.push(`Scene ${id} missing text`);
    for (const c of scene.choices || []) {
      if (!c.text) errors.push(`Scene ${id} has choice with empty text`);
      if (!c.next) errors.push(`Scene ${id} has choice with empty next`);
      else if (!ids.has(c.next)) errors.push(`Broken link ${id} → ${c.next}`);
      else inbound[c.next]++;
    }
    const hook = scene.hooks?.onEnter;
    if (hook && !scripts.hooks?.[hook]) warnings.push(`Hook not declared: ${hook}`);
    if (scene.sceneImage) {
      const art = path.join(projectDir, "assets", "scene_images", scene.sceneImage);
      if (!fs.existsSync(art)) missingArt.push(scene.sceneImage);
    }
    for (const kind of ["bgm", "sfx"]) {
      const file = scene[kind];
      if (typeof file === "string" && file.trim() && !/^(none|stop|off)$/i.test(file.trim())) {
        const audioPath = path.join(projectDir, "assets", "audio", file);
        if (!fs.existsSync(audioPath)) warnings.push(`Missing audio: assets/audio/${file} (${id}.${kind})`);
      }
    }
  }
  const art = reportMissingArt(missingArt, artOptional);
  warnings.push(...art.warnings);
  notes.push(...art.notes);

  const themeAudio = (() => {
    try {
      const themeRel = project.theme || "theme/theme.json";
      const theme = readJson(path.join(projectDir, themeRel));
      return theme?.audio?.defaultBgm || project.audio?.defaultBgm || null;
    } catch {
      return project.audio?.defaultBgm || null;
    }
  })();
  if (typeof themeAudio === "string" && themeAudio.trim()) {
    const p = path.join(projectDir, "assets", "audio", themeAudio);
    if (!fs.existsSync(p)) warnings.push(`Missing audio: assets/audio/${themeAudio} (defaultBgm)`);
  }

  for (const id of ids) {
    if (id !== project.start && (inbound[id] || 0) === 0) warnings.push(`Orphan scene: ${id}`);
  }
  const dead = [...ids].filter((id) => !(scenes[id].choices || []).length);
  if (dead.length) warnings.push(`Dead-end scenes: ${dead.length}`);

  const locales = project.locales;
  if (locales && typeof locales === "object") {
    for (const entry of locales.available || []) {
      if (!entry?.id) {
        warnings.push("Locale entry missing id");
        continue;
      }
      if (!entry.file) continue;
      const localePath = path.join(projectDir, entry.file);
      if (!fs.existsSync(localePath)) {
        warnings.push(`Missing locale file: ${entry.file} (${entry.id})`);
        continue;
      }
      try {
        const overlay = readJson(localePath);
        const overlayScenes = overlay.scenes || {};
        for (const [sid, patch] of Object.entries(overlayScenes)) {
          if (!ids.has(sid)) {
            warnings.push(`Locale ${entry.id} references unknown scene: ${sid}`);
            continue;
          }
          const choiceCount = (scenes[sid].choices || []).length;
          if (Array.isArray(patch?.choices) && patch.choices.length > choiceCount) {
            warnings.push(
              `Locale ${entry.id} scene ${sid} has ${patch.choices.length} choice strings (scene has ${choiceCount})`
            );
          }
        }
      } catch (err) {
        warnings.push(`Invalid locale JSON: ${entry.file} (${err.message || err})`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notes,
    artOptional,
    project,
    sceneCount: ids.size,
  };
}
