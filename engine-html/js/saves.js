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
  const s = save && typeof save === "object" ? save : {};
  // Arrays are objects in JS: a slot hand-edited (or written by an older build)
  // with vars:[1,2,3] must not load back as {0:1,1:2,2:3}.
  const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  state.playerName = typeof s.playerName === "string" ? s.playerName : "";
  state.currentScene = s.currentScene || "start";
  state.abilities = Array.isArray(s.abilities) ? s.abilities.filter((a) => typeof a === "string") : [];
  state.vars = isPlainObject(s.vars) ? { ...s.vars } : {};
  state.history = Array.isArray(s.history)
    ? s.history
        .filter((h) => isPlainObject(h) && typeof h.id === "string" && h.id.length)
        .map((h) => ({
          id: h.id,
          choice: typeof h.choice === "string" && h.choice.length ? h.choice : null,
        }))
    : [];
}

function lsKey(projectId, slot) {
  return `ifstudio:${projectId}:slot:${slot}`;
}

// Probed once per session: packaged games have no save API, and re-asking on
// every slot operation cost a wasted request and a console 404 each time. Only
// the answer is cached, never the slot list, which changes as the player saves.
let apiProbe = null;

async function apiAvailable() {
  // Static hosts such as Neocities have no Studio API. The static export sets
  // this before boot so browser-only saves do not create a needless 404 probe.
  if (globalThis.__IF_STATIC_SITE__) return false;
  if (apiProbe === null) {
    apiProbe = (async () => {
      try {
        const r = await fetch("/api/saves");
        return r.ok;
      } catch {
        return false;
      }
    })();
  }
  return apiProbe;
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
