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

export function writeSaveSlot(projectDir, slot, payload) {
  const id = String(slot);
  if (!SLOT_RE.test(id)) return { ok: false, error: "slot must be 1–5" };
  const save = {
    formatVersion: 1,
    slot: Number(id),
    label: payload.label || `Slot ${id}`,
    playerName: String(payload.playerName || ""),
    currentScene: String(payload.currentScene || "start"),
    abilities: Array.isArray(payload.abilities) ? payload.abilities : [],
    vars: payload.vars && typeof payload.vars === "object" ? payload.vars : {},
    history: Array.isArray(payload.history) ? payload.history : [],
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
