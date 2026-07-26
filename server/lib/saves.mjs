import fs from "node:fs";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "./fs-utils.mjs";

const SLOT_RE = /^[1-5]$/;
const MAX_SLOTS = 5;

export function savesDir(projectDir) {
  return path.join(projectDir, "saves");
}

export function listSaveSlots(projectDir) {
  const dir = savesDir(projectDir);
  ensureDir(dir);
  const slots = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const file = path.join(dir, `slot-${i}.json`);
    if (!fs.existsSync(file)) {
      slots.push({ slot: i, empty: true });
      continue;
    }
    try {
      const data = readJson(file);
      slots.push({
        slot: i,
        empty: false,
        playerName: data.playerName || "",
        currentScene: data.currentScene || "",
        updatedAt: data.updatedAt || null,
        label: data.label || null,
      });
    } catch {
      slots.push({ slot: i, empty: false, corrupt: true });
    }
  }
  return slots;
}

export function readSaveSlot(projectDir, slot) {
  const id = String(slot);
  if (!SLOT_RE.test(id)) return { ok: false, error: "slot must be 1–5" };
  const file = path.join(savesDir(projectDir), `slot-${id}.json`);
  if (!fs.existsSync(file)) return { ok: false, error: "empty slot", empty: true, slot: Number(id) };
  try {
    return { ok: true, slot: Number(id), save: readJson(file) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// A save slot is written from whatever the player/editor POSTs, so every field
// is coerced to the shape the loader expects. Arrays are objects in JS, so a
// stray `vars: [1,2,3]` would otherwise be stored as-is and load back as
// numeric-keyed junk; a non-string or 200KB label would land in the slot list
// UI verbatim. This is the one authoritative place to normalize all of that.
const LABEL_MAX = 120;
const STRING_MAX = 2000;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clampString(value, max) {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

export function writeSaveSlot(projectDir, slot, payload) {
  const id = String(slot);
  if (!SLOT_RE.test(id)) return { ok: false, error: "slot must be 1–5" };
  const src = plainObject(payload);
  const label = clampString(src.label, LABEL_MAX).trim() || `Slot ${id}`;
  const save = {
    formatVersion: 1,
    slot: Number(id),
    label,
    playerName: clampString(src.playerName, STRING_MAX),
    currentScene: clampString(src.currentScene || "start", STRING_MAX),
    abilities: Array.isArray(src.abilities) ? src.abilities.filter((a) => typeof a === "string") : [],
    vars: plainObject(src.vars),
    // History drives rollback; a non-object beat would throw there, so keep only
    // well-shaped beats with a scene id.
    history: Array.isArray(src.history)
      ? src.history.filter((h) => h && typeof h === "object" && !Array.isArray(h))
      : [],
    updatedAt: new Date().toISOString(),
  };
  ensureDir(savesDir(projectDir));
  writeJson(path.join(savesDir(projectDir), `slot-${id}.json`), save);
  return { ok: true, slot: Number(id), save };
}

export function deleteSaveSlot(projectDir, slot) {
  const id = String(slot);
  if (!SLOT_RE.test(id)) return { ok: false, error: "slot must be 1–5" };
  const file = path.join(savesDir(projectDir), `slot-${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true, slot: Number(id), deleted: true };
}

export { MAX_SLOTS };
