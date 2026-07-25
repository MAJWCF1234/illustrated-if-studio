const PREFIX = "ifstudio:";
const LEGACY_PREFIX = "vnstudio:";

export function storageKey(projectId, leaf) {
  return `${PREFIX}${projectId}:${leaf}`;
}

function legacyKey(projectId, leaf) {
  return `${LEGACY_PREFIX}${projectId}:${leaf}`;
}

function readRaw(projectId, leaf) {
  return localStorage.getItem(storageKey(projectId, leaf)) ?? localStorage.getItem(legacyKey(projectId, leaf));
}

export function loadState(projectId, defaults = {}) {
  const read = (leaf, fallback) => {
    try {
      const raw = readRaw(projectId, leaf);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  return {
    playerName: readRaw(projectId, "playerName") || "",
    currentScene: readRaw(projectId, "currentScene") || defaults.start || "start",
    abilities: read("abilities", []),
    vars: read("vars", {}),
    history: read("history", []),
  };
}

/** Scenes the player has visited — survives restart for skip-read. */
export function loadSeenScenes(projectId) {
  try {
    const raw = readRaw(projectId, "seenScenes");
    const list = raw == null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

export function saveSeenScenes(projectId, seen) {
  saveLeaf(projectId, "seenScenes", [...seen]);
}

/** Last choice text taken per scene id — guides skip-read at branches. */
export function loadLastChoices(projectId) {
  try {
    const raw = readRaw(projectId, "lastChoices");
    const obj = raw == null ? {} : JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export function saveLastChoices(projectId, map) {
  saveLeaf(projectId, "lastChoices", map || {});
}

export function saveLeaf(projectId, leaf, value) {
  const key = storageKey(projectId, leaf);
  if (typeof value === "string") localStorage.setItem(key, value);
  else localStorage.setItem(key, JSON.stringify(value));
}

export function clearPlaythrough(projectId, { keepAbilities }) {
  const abilities = keepAbilities
    ? (() => {
        try {
          const raw = readRaw(projectId, "abilities");
          return JSON.parse(raw || "[]");
        } catch {
          return [];
        }
      })()
    : [];

  ["playerName", "currentScene", "history", "vars", "abilities"].forEach((leaf) => {
    localStorage.removeItem(storageKey(projectId, leaf));
    localStorage.removeItem(legacyKey(projectId, leaf));
  });

  if (keepAbilities && abilities.length) {
    saveLeaf(projectId, "abilities", abilities);
  }

  return {
    playerName: "",
    currentScene: "start",
    abilities: keepAbilities ? abilities : [],
    vars: {},
    history: [],
  };
}
