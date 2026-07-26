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
  // Stored values are only trusted for shape, not just for parseability: a leaf
  // that holds the wrong type would otherwise reach the engine and throw there.
  const read = (leaf, fallback, ok) => {
    try {
      const raw = readRaw(projectId, leaf);
      if (raw == null) return fallback;
      const value = JSON.parse(raw);
      return ok(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  // History must be [{id, choice?}…] — null / string / number entries used to
  // crash showHistory (`entry.id`) and rollback (`prev.id`) on click.
  const rawHistory = read("history", [], Array.isArray);
  const history = rawHistory
    .filter((h) => isPlainObject(h) && typeof h.id === "string" && h.id.length)
    .map((h) => ({
      id: h.id,
      choice: typeof h.choice === "string" && h.choice.length ? h.choice : null,
    }));
  return {
    playerName: readRaw(projectId, "playerName") || "",
    currentScene: readRaw(projectId, "currentScene") || defaults.start || "start",
    abilities: read("abilities", [], Array.isArray),
    vars: read("vars", {}, isPlainObject),
    history,
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
    // Reject arrays — they are objects in JS but not a scene→choice map.
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
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
  // Same shape guard as loadState: corrupt storage must never leave a non-array
  // in abilities (includes() would then crash unlockAbility / hasAbility checks).
  const abilities = keepAbilities
    ? (() => {
        try {
          const raw = readRaw(projectId, "abilities");
          const value = JSON.parse(raw || "[]");
          return Array.isArray(value) ? value : [];
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
