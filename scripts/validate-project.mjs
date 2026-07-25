#!/usr/bin/env node
/** Validate a Illustrated IF Studio project folder. */
import fs from "node:fs";
import path from "node:path";
import { resolveArtOptional, reportMissingArt } from "../server/lib/art-status.mjs";

const projectDir = path.resolve(process.argv[2] || "illustrated-if-studio/projects/sample-project");
const errors = [];
const warnings = [];
const notes = [];
const missingArt = [];

function read(rel) {
  const p = path.join(projectDir, rel);
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${rel}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const project = read("project.json");
if (project.formatVersion !== 1) errors.push(`Unsupported formatVersion: ${project.formatVersion}`);

const scenesDoc = read(project.story.scenes);
const scenes = scenesDoc.scenes || scenesDoc;
const ids = new Set(Object.keys(scenes));

if (!ids.has(project.start)) errors.push(`Start scene missing: ${project.start}`);

let scripts = { hooks: {} };
try {
  scripts = read(project.story.scripts);
} catch {
  warnings.push("No scripts.json");
}

const inbound = new Map([...ids].map((id) => [id, 0]));
for (const [id, scene] of Object.entries(scenes)) {
  if (!scene.text) errors.push(`Scene ${id} missing text`);
  for (const c of scene.choices || []) {
    if (!c.text) errors.push(`Scene ${id} has choice with empty text`);
    if (!c.next) errors.push(`Scene ${id} has choice with empty next`);
    else if (!ids.has(c.next)) errors.push(`Broken link ${id} → ${c.next}`);
    else inbound.set(c.next, (inbound.get(c.next) || 0) + 1);
  }
  const hook = scene.hooks?.onEnter;
  if (hook && !scripts.hooks?.[hook]) warnings.push(`Hook not declared in scripts.json: ${hook}`);

  if (scene.sceneImage) {
    const p = path.join(projectDir, "assets", "scene_images", scene.sceneImage);
    if (!fs.existsSync(p)) missingArt.push(scene.sceneImage);
  }
  for (const kind of ["bgm", "sfx"]) {
    const file = scene[kind];
    if (typeof file === "string" && file.trim() && !/^(none|stop|off)$/i.test(file.trim())) {
      const p = path.join(projectDir, "assets", "audio", file);
      if (!fs.existsSync(p)) warnings.push(`Missing audio: assets/audio/${file} (${id}.${kind})`);
    }
  }
}

const artOptional = resolveArtOptional(projectDir, project);
const art = reportMissingArt(missingArt, artOptional);
warnings.push(...art.warnings);
notes.push(...art.notes);

for (const id of ids) {
  if (id !== project.start && (inbound.get(id) || 0) === 0) warnings.push(`Orphan scene: ${id}`);
}

const dead = [...ids].filter((id) => !(scenes[id].choices || []).length);
if (dead.length) warnings.push(`Dead-end scenes: ${dead.length}`);

console.log(`Project: ${project.title} (${ids.size} scenes)`);
console.log(`Errors: ${errors.length}`);
errors.forEach((e) => console.log("  ERR ", e));
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 40).forEach((w) => console.log("  WARN", w));
if (warnings.length > 40) console.log(`  ... +${warnings.length - 40} more`);
notes.forEach((n) => console.log("  NOTE", n));
process.exit(errors.length ? 1 : 0);
