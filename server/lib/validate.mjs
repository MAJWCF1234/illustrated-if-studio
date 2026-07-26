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

  if (!ids.has(project.start))
    errors.push(`The story's start scene "${project.start}" is missing — pick an existing scene as the start`);

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
  if (Array.isArray(scenes)) {
    errors.push("scenes must be an object keyed by scene id, not an array");
    return { ok: false, errors, warnings, notes, project, sceneCount: 0 };
  }
  for (const [id, scene] of Object.entries(scenes)) {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      errors.push(`Scene "${id}" is not a valid scene object`);
      continue;
    }
    if (!scene.text) errors.push(`Scene "${id}" has no story text yet`);
    const choices = scene.choices;
    if (choices != null && !Array.isArray(choices)) {
      errors.push(`Scene "${id}" has choices that are not a list`);
    }
    for (const c of Array.isArray(choices) ? choices : []) {
      if (!c || typeof c !== "object") {
        errors.push(`Scene "${id}" has a malformed choice entry`);
        continue;
      }
      if (!c.text) errors.push(`Scene "${id}" has a choice with no label — players need something to click`);
      if (!c.next) errors.push(`Scene "${id}" has a choice that doesn't go anywhere — pick a target scene`);
      else if (!ids.has(c.next))
        errors.push(`A choice in "${id}" points to "${c.next}", but that scene doesn't exist`);
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
    if (id !== project.start && (inbound[id] || 0) === 0) {
      warnings.push(`Scene "${id}" is never linked from anywhere — players can't reach it`);
    }
  }
  const dead = [...ids].filter((id) => {
    const scene = scenes[id];
    if (!scene || typeof scene !== "object") return false;
    return !(Array.isArray(scene.choices) ? scene.choices : []).length;
  });
  if (dead.length) {
    warnings.push(
      `${dead.length} scene${dead.length === 1 ? "" : "s"} with no choices (dead end): ${dead.slice(0, 8).join(", ")}${
        dead.length > 8 ? "…" : ""
      }`
    );
  }

  const locales = project.locales;
  if (locales && typeof locales === "object") {
    // Anything non-array here (an object map, a number) threw "is not iterable" out of
    // validateProject, which surfaced as a 500 on /api/validate and blocked every export.
    const available = Array.isArray(locales.available) ? locales.available : [];
    if (locales.available != null && !Array.isArray(locales.available)) {
      warnings.push(
        "project.locales.available must be a list of { id, label, file } entries — ignoring it"
      );
    }
    for (const entry of available) {
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
