/**
 * Multi-slot saves: prefer studio disk API when available; else localStorage.
 * Autosave (continue path) still uses leaf keys in state.js.
 */

const SLOT_COUNT = 5;

export function snapshotFromState(state, { label } = {}) {
  return {
    formatVersion: 1,
    label: label || null,
    playerName: state.playerName || "",
    currentScene: state.currentScene || "start",
    abilities: [...(state.abilities || [])],
    vars: { ...(state.vars || {}) },
    history: [...(state.history || [])],
    updatedAt: new Date().toISOString(),
  };
}

export function applySnapshot(state, save) {
  state.playerName = save.playerName || "";
  state.currentScene = save.currentScene || "start";
  state.abilities = Array.isArray(save.abilities) ? [...save.abilities] : [];
  state.vars = save.vars && typeof save.vars === "object" ? { ...save.vars } : {};
  state.history = Array.isArray(save.history) ? [...save.history] : [];
}

function lsKey(projectId, slot) {
  return `ifstudio:${projectId}:slot:${slot}`;
}

async function apiAvailable() {
  try {
    const r = await fetch("/api/saves");
    return r.ok;
  } catch {
    return false;
  }
}

export async function listSlots(projectId) {
  if (await apiAvailable()) {
    const r = await fetch("/api/saves");
    const data = await r.json();
    if (r.ok) return { backend: "disk", slots: data.slots || [] };
  }
  const slots = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    try {
      const raw = localStorage.getItem(lsKey(projectId, i));
      if (!raw) {
        slots.push({ slot: i, empty: true });
        continue;
      }
      const data = JSON.parse(raw);
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
  return { backend: "local", slots };
}

export async function loadSlot(projectId, slot) {
  if (await apiAvailable()) {
    const r = await fetch(`/api/saves/${slot}`);
    const data = await r.json();
    if (r.ok && data.save) return { backend: "disk", save: data.save };
    if (r.status === 404) return { backend: "disk", empty: true };
    throw new Error(data.error || "Load failed");
  }
  const raw = localStorage.getItem(lsKey(projectId, slot));
  if (!raw) return { backend: "local", empty: true };
  return { backend: "local", save: JSON.parse(raw) };
}

export async function saveSlot(projectId, slot, save) {
  const payload = { ...save, slot: Number(slot), updatedAt: new Date().toISOString() };
  if (await apiAvailable()) {
    const r = await fetch(`/api/saves/${slot}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ save: payload }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Save failed");
    return { backend: "disk", save: data.save };
  }
  localStorage.setItem(lsKey(projectId, slot), JSON.stringify(payload));
  return { backend: "local", save: payload };
}

export async function clearSlot(projectId, slot) {
  if (await apiAvailable()) {
    const r = await fetch(`/api/saves/${slot}`, { method: "DELETE" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Delete failed");
    return { backend: "disk" };
  }
  localStorage.removeItem(lsKey(projectId, slot));
  return { backend: "local" };
}

export { SLOT_COUNT };
