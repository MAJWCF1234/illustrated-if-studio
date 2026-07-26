import { GraphView } from "./graph.js";
import { collectInbound } from "./layout.js";
import { HistoryStack } from "./history.js";
import { mergeTheme } from "./theme-defaults.js";
import { mountDesignStudio } from "./design.js";
import { runCliCommand, CLI_CHIPS, getCliSuggestions } from "./cli.js";

const state = {
  project: null,
  scenes: {},
  theme: null,
  startId: "start",
  selected: null,
  dirty: false,
  /** Fingerprint of last load/save — undo/redo clears dirty when it matches again. */
  savedFingerprint: "",
  assets: { sceneImages: [], characters: [] },
  abilities: [],
  inspTab: "story",
  mode: "story",
  projectId: "sample-project",
  projectUrl: "/projects/sample-project/",
};

const history = new HistoryStack();
let textHistoryTimer = null;

const els = {
  title: document.getElementById("project-title"),
  meta: document.getElementById("project-meta"),
  list: document.getElementById("scene-list"),
  filter: document.getElementById("scene-filter"),
  count: document.getElementById("scene-count"),
  empty: document.getElementById("inspector-empty"),
  form: document.getElementById("inspector-form"),
  heading: document.getElementById("scene-heading"),
  stats: document.getElementById("scene-stats"),
  wordCount: document.getElementById("word-count"),
  fId: document.getElementById("f-id"),
  fSpeaker: document.getElementById("f-speaker"),
  fBg: document.getElementById("f-bg"),
  fLeft: document.getElementById("f-left"),
  fRight: document.getElementById("f-right"),
  fUnlock: document.getElementById("f-unlock"),
  fText: document.getElementById("f-text"),
  choices: document.getElementById("choices-editor"),
  artPreview: document.getElementById("art-preview"),
  artBg: document.getElementById("art-preview-bg"),
  artLeft: document.getElementById("art-preview-left"),
  artRight: document.getElementById("art-preview-right"),
  toast: document.getElementById("toast"),
  logDialog: document.getElementById("log-dialog"),
  logTitle: document.getElementById("log-title"),
  logBody: document.getElementById("log-body"),
  previewDock: document.getElementById("preview-dock"),
  previewFrame: document.getElementById("preview-frame"),
  btnUndo: document.getElementById("btn-undo"),
  btnRedo: document.getElementById("btn-redo"),
};

const graph = new GraphView(document.getElementById("graph"), {
  onSelect: (id) => selectScene(id),
  onConnect: (fromId, toId) => connectScenes(fromId, toId),
});

function toast(msg) {
  els.toast.hidden = false;
  els.toast.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

function showLog(title, body) {
  // Native <dialog> is top-layer; an open Export menu behind it is confusing and
  // lets scripted/keyboard paths replace Validate output mid-read.
  const dd = document.getElementById("export-dropdown");
  const btn = document.getElementById("btn-export");
  if (dd) dd.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
  els.logTitle.textContent = title;
  els.logBody.textContent = body;
  els.logDialog.showModal();
}

function pushHistory(label) {
  history.snapshot(state.scenes, state.startId, label);
  syncHistoryButtons();
}

function syncHistoryButtons() {
  els.btnUndo.disabled = !history.canUndo();
  els.btnRedo.disabled = !history.canRedo();
}

function contentFingerprint() {
  return JSON.stringify({
    scenes: state.scenes,
    startId: state.startId,
    theme: state.theme,
  });
}

/** Set by runExport; declared early so syncShellBusyFlags can read it. */
let exportInFlight = null;

function syncShellBusyFlags() {
  try {
    window.__IF_DIRTY__ = Boolean(state.dirty);
    window.__IF_EXPORT_IN_FLIGHT__ = Boolean(exportInFlight);
  } catch {
    /* ignore */
  }
}

function syncDirtyFromFingerprint() {
  const dirty = contentFingerprint() !== state.savedFingerprint;
  state.dirty = dirty;
  document.title = dirty ? "• Illustrated IF Studio" : "Illustrated IF Studio";
  syncShellBusyFlags();
}

function markDirty(label = "edit") {
  state.dirty = true;
  document.title = "• Illustrated IF Studio";
  syncShellBusyFlags();
  pushHistory(label);
}

function clearDirty() {
  state.savedFingerprint = contentFingerprint();
  state.dirty = false;
  document.title = "Illustrated IF Studio";
  syncShellBusyFlags();
}

function applySnapshot(snap) {
  state.scenes = snap.scenes;
  state.startId = snap.startId;
  if (!state.scenes[state.selected]) state.selected = state.startId;
  renderList();
  fillInspector();
  graph.draw(state.scenes, state.startId);
  syncDirtyFromFingerprint();
  syncHistoryButtons();
}

/** Commit debounced text edits into the undo stack before undo/redo. */
function flushPendingTextHistory() {
  if (textHistoryTimer) {
    clearTimeout(textHistoryTimer);
    textHistoryTimer = null;
    flushInspectorToState();
    pushHistory("text");
  }
}

function connectScenes(fromId, toId) {
  const scene = state.scenes[fromId];
  if (!scene || !state.scenes[toId]) return;
  scene.choices = scene.choices || [];
  const dangling = scene.choices.find((c) => !c.next || !state.scenes[c.next]);
  if (dangling) dangling.next = toId;
  else scene.choices.push({ text: `Go to ${toId}`, next: toId });
  markDirty("connect");
  selectScene(fromId);
  graph.draw(state.scenes, state.startId);
  toast(`Linked ${fromId} → ${toId}`);
}

function fillDatalist(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = values.map((v) => `<option value="${escapeAttr(v)}"></option>`).join("");
}

function refreshDatalists() {
  fillDatalist("scene-ids", Object.keys(state.scenes).sort());
  fillDatalist("scene-image-ids", state.assets.sceneImages || []);
  fillDatalist("character-ids", state.assets.characters || []);
  fillDatalist("ability-ids", state.abilities || []);
}

async function loadAssets() {
  try {
    const res = await fetch("/api/assets");
    if (res.ok) state.assets = await res.json();
  } catch {
    /* optional */
  }
  // Catalog ids from abilities.json plus whatever scenes already use — so a
  // planned ability shows in the "Needs ability" datalist before any scene
  // unlocks it, without replacing freeform ids typed into scenes.
  const ids = new Set();
  try {
    const rel = state.project?.story?.abilities;
    if (rel) {
      const ab = await fetch(`${state.projectUrl}${rel}`);
      if (ab.ok) {
        const doc = await ab.json();
        const catalog = doc?.abilities;
        if (catalog && typeof catalog === "object" && !Array.isArray(catalog)) {
          for (const key of Object.keys(catalog)) {
            if (key) ids.add(key);
          }
        } else if (Array.isArray(catalog)) {
          for (const entry of catalog) {
            const id = typeof entry === "string" ? entry : entry?.id;
            if (id) ids.add(String(id));
          }
        }
      }
    }
  } catch {
    /* catalog optional */
  }
  for (const sc of Object.values(state.scenes)) {
    if (sc.unlockAbility) ids.add(String(sc.unlockAbility).trim());
    for (const c of sc.choices || []) {
      if (c.when?.hasAbility) ids.add(String(c.when.hasAbility).trim());
    }
  }
  state.abilities = [...ids].filter(Boolean).sort();
  refreshDatalists();
}

async function loadProject() {
  const res = await fetch("/api/project");
  if (!res.ok) {
    // Surface the server's actionable message (e.g. a damaged project.json)
    // instead of a generic failure the user can't act on.
    let msg = "Couldn't open the project.";
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const data = await res.json();
  state.project = data.project;
  state.projectId = data.activeProjectId || data.project?.id || "sample-project";
  state.projectUrl = `/projects/${state.projectId}/`;
  state.scenes = data.scenes.scenes || data.scenes;
  state.theme = mergeTheme(data.theme);
  const claimedStart = data.project.start || data.scenes.start || "start";
  state.startId =
    (state.scenes[claimedStart] && claimedStart) ||
    data.scenes.start ||
    Object.keys(state.scenes)[0] ||
    "start";
  els.title.textContent = data.project.title || data.project.id;
  const layout = data.project.meta?.layout || state.theme?.layout?.mode || "illustrated-if";
  els.meta.textContent = `${data.project.author || ""} · ${Object.keys(state.scenes).length} scenes · ${layout}`;
  const pill = document.getElementById("format-pill");
  if (pill) pill.textContent = data.project.meta?.formatLabel || "Illustrated TB RPG";

  // abilities catalog if present in bundled response later; derive for now
  await loadAssets();

  history.stack = [];
  history.index = -1;
  pushHistory("load");
  clearDirty();
  renderList();
  graph.layout(state.scenes, state.startId);
  selectScene(state.startId, { skipFlush: true });
  syncHistoryButtons();
  ensureDesignMounted();
}

function projectAsset(rel) {
  const clean = String(rel || "").replace(/^\/+/, "");
  return `${state.projectUrl}${clean}`;
}

async function confirmDiscardIfDirty(actionLabel = "continue") {
  if (!state.dirty) return true;
  return window.confirm(`You have unsaved changes. Discard them and ${actionLabel}?`);
}

function renderList() {
  const q = (els.filter.value || "").toLowerCase();
  const inbound = collectInbound(state.scenes);
  const ids = Object.keys(state.scenes).sort();
  els.list.innerHTML = "";
  let shown = 0;
  for (const id of ids) {
    if (q && !id.toLowerCase().includes(q)) continue;
    shown++;
    const li = document.createElement("li");
    li.textContent = id;
    li.dataset.id = id;
    if (id === state.startId) li.classList.add("start");
    if (!(state.scenes[id].choices || []).length) li.classList.add("dead");
    if (inbound[id] === 0 && id !== state.startId) li.title = "Orphan scene";
    if (id === state.selected) li.classList.add("active");
    // pointerdown selects before blur rebuilds the list, so the first click
    // after editing story text is not swallowed.
    li.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      selectScene(id);
    });
    els.list.appendChild(li);
  }
  els.count.textContent = String(Object.keys(state.scenes).length);
  if (shown !== ids.length) els.count.textContent += ` (${shown} shown)`;
}

function selectScene(id, opts = {}) {
  if (!state.scenes[id]) return;
  if (!opts.skipFlush) {
    // Commit a typed-but-unblurred scene name before switching — pointerdown
    // selects before the #f-id change event, which used to silently drop renames.
    commitPendingSceneRename();
    flushInspectorToState();
  }
  if (!state.scenes[id]) return;
  state.selected = id;
  graph.select(id);
  graph.draw(state.scenes, state.startId);
  renderList();
  fillInspector();
}

/** Apply #f-id when it differs from the selected scene (Save / Preview / switch). */
function commitPendingSceneRename() {
  if (!state.selected || !els.fId || els.form?.hidden) return;
  const typed = String(els.fId.value || "").trim();
  if (!typed || typed === state.selected) return;
  renameSelectedScene(typed);
}

function wordCount(text) {
  const m = String(text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}

function updateStats(scene) {
  const inbound = collectInbound(state.scenes);
  const actions = (scene.choices || []).length;
  const broken = (scene.choices || []).filter((c) => !c.next || !state.scenes[c.next]).length;
  const chips = [];
  chips.push(`<span class="stat-chip">${wordCount(scene.text)} words</span>`);
  chips.push(`<span class="stat-chip ${actions ? "ok" : "warn"}">${actions} action${actions === 1 ? "" : "s"}</span>`);
  if (scene.unlockAbility) chips.push(`<span class="stat-chip ok">unlocks ${escapeAttr(scene.unlockAbility)}</span>`);
  if (broken) chips.push(`<span class="stat-chip danger">${broken} broken link${broken === 1 ? "" : "s"}</span>`);
  if (inbound[state.selected] === 0 && state.selected !== state.startId) {
    chips.push(`<span class="stat-chip warn">orphan</span>`);
  }
  if (state.selected === state.startId) chips.push(`<span class="stat-chip ok">start</span>`);
  els.stats.innerHTML = chips.join("");
  els.wordCount.textContent = `${wordCount(scene.text)} words`;
}

function setPreviewImg(el, folder, file) {
  if (!file) {
    el.hidden = true;
    el.removeAttribute("src");
    return;
  }
  el.hidden = false;
  el.onerror = () => {
    el.hidden = true;
  };
  el.src = projectAsset(`assets/${folder}/${encodeURIComponent(file)}`);
}

function updateArtPreview(scene) {
  const has = Boolean(scene.sceneImage || scene.characterLeft || scene.characterRight);
  els.artPreview.classList.toggle("has-art", has);
  const fallback = projectAsset("assets/scene_images/default.svg");
  if (scene.sceneImage) {
    els.artBg.hidden = false;
    els.artBg.onerror = () => {
      els.artBg.src = fallback;
    };
    els.artBg.src = projectAsset(`assets/scene_images/${encodeURIComponent(scene.sceneImage)}`);
  } else {
    els.artBg.src = fallback;
    els.artBg.hidden = false;
  }
  setPreviewImg(els.artLeft, "characters", scene.characterLeft);
  setPreviewImg(els.artRight, "characters", scene.characterRight);
}

function fillInspector() {
  const scene = state.scenes[state.selected];
  if (!scene) {
    els.form.hidden = true;
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  els.form.hidden = false;
  els.heading.textContent = scene.speaker || state.selected;
  els.fId.value = scene.id || state.selected;
  els.fSpeaker.value = scene.speaker || "";
  els.fBg.value = scene.sceneImage || "";
  els.fLeft.value = scene.characterLeft || "";
  els.fRight.value = scene.characterRight || "";
  els.fUnlock.value = scene.unlockAbility || "";
  els.fText.value = scene.text || "";
  updateStats(scene);
  updateArtPreview(scene);
  renderChoicesEditor(scene);
  refreshDatalists();
  setInspTab(state.inspTab);
}

function renderChoicesEditor(scene) {
  els.choices.innerHTML = "";
  const ids = Object.keys(state.scenes).sort();
  (scene.choices || []).forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "action-card";
    const broken = !c.next || !state.scenes[c.next];
    const placeholder = broken
      ? `<option value="${escapeAttr(c.next || "")}" selected>${
          c.next ? `${escapeAttr(c.next)} (missing)` : "(no scene chosen)"
        }</option>`
      : `<option value="" ${!c.next ? "selected" : ""}>(clear / pick a scene)</option>`;
    const options = ids
      .map((id) => `<option value="${escapeAttr(id)}" ${!broken && c.next === id ? "selected" : ""}>${escapeAttr(id)}</option>`)
      .join("");
    card.innerHTML = `
      <div class="action-card-top">
        <span class="action-num">#${i + 1}</span>
        <div class="action-card-tools">
          <button type="button" data-act="up" title="Move up">↑</button>
          <button type="button" data-act="down" title="Move down">↓</button>
          <button type="button" data-act="del" class="danger" title="Remove">✕</button>
        </div>
      </div>
      <label>Label
        <input data-k="text" type="text" value="${escapeAttr(c.text || "")}" placeholder="What the player clicks" />
      </label>
      <label>Goes to
        <select data-k="next">${placeholder}${options}</select>
      </label>
      <label>Needs ability
        <input data-k="when" type="text" list="ability-ids" value="${escapeAttr(c.when?.hasAbility || "")}" placeholder="optional" />
      </label>
      ${broken ? `<p class="action-broken">Broken or missing target</p>` : ""}
    `;

    card.querySelector('[data-act="up"]').addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (i === 0) return;
      const tmp = scene.choices[i - 1];
      scene.choices[i - 1] = scene.choices[i];
      scene.choices[i] = tmp;
      markDirty("reorder");
      renderChoicesEditor(scene);
      graph.draw(state.scenes, state.startId);
      updateStats(scene);
    });
    card.querySelector('[data-act="down"]').addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (i >= scene.choices.length - 1) return;
      const tmp = scene.choices[i + 1];
      scene.choices[i + 1] = scene.choices[i];
      scene.choices[i] = tmp;
      markDirty("reorder");
      renderChoicesEditor(scene);
      graph.draw(state.scenes, state.startId);
      updateStats(scene);
    });
    card.querySelector('[data-act="del"]').addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      scene.choices.splice(i, 1);
      markDirty("remove-choice");
      renderChoicesEditor(scene);
      graph.draw(state.scenes, state.startId);
      renderList();
      updateStats(scene);
    });

    card.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("change", () => {
        const k = input.dataset.k;
        if (k === "when") {
          const v = input.value.trim();
          if (v) c.when = { hasAbility: v };
          else delete c.when;
        } else {
          c[k] = input.value;
        }
        markDirty("choice");
        graph.draw(state.scenes, state.startId);
        renderList();
        updateStats(scene);
        // Avoid re-rendering the choice cards on every field blur — that
        // destroys Delete/Reorder buttons mid-click after typing.
      });
    });

    els.choices.appendChild(card);
  });

  if (!(scene.choices || []).length) {
    els.choices.innerHTML = `<p class="insp-hint">No actions yet — this beat is a dead end until you add one.</p>`;
  }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const SCENE_ID_RE = /^[\p{L}\p{N}_-]+$/u;

function renameSelectedScene(rawId) {
  const oldId = state.selected;
  if (!oldId || !state.scenes[oldId]) return false;
  const newId = String(rawId || "").trim();
  if (!newId) {
    toast("Scene name can't be empty");
    els.fId.value = oldId;
    return false;
  }
  if (newId === oldId) return true;
  if (newId.length > 64) {
    toast("Scene name is too long (max 64 characters)");
    els.fId.value = oldId;
    return false;
  }
  if (/\s/.test(newId) || /[<>&"'`/\\]/.test(newId) || !SCENE_ID_RE.test(newId)) {
    toast("Use letters, numbers, hyphens, or underscores — no spaces or symbols");
    els.fId.value = oldId;
    return false;
  }
  if (state.scenes[newId]) {
    toast(`A scene named "${newId}" already exists`);
    els.fId.value = oldId;
    return false;
  }

  const scene = state.scenes[oldId];
  delete state.scenes[oldId];
  scene.id = newId;
  state.scenes[newId] = scene;
  for (const sc of Object.values(state.scenes)) {
    for (const c of sc.choices || []) {
      if (c.next === oldId) c.next = newId;
    }
  }
  if (state.startId === oldId) state.startId = newId;
  if (graph.positions[oldId]) {
    graph.positions[newId] = graph.positions[oldId];
    delete graph.positions[oldId];
  }
  state.selected = newId;
  markDirty("rename");
  renderList();
  fillInspector();
  graph.draw(state.scenes, state.startId);
  toast(`Renamed ${oldId} → ${newId}`);
  return true;
}

function flushInspectorToState() {
  if (!state.selected || !state.scenes[state.selected] || els.form.hidden) return;
  const scene = state.scenes[state.selected];
  scene.speaker = els.fSpeaker.value.trim() || null;
  scene.sceneImage = els.fBg.value.trim() || null;
  scene.characterLeft = els.fLeft.value.trim() || null;
  scene.characterRight = els.fRight.value.trim() || null;
  scene.unlockAbility = els.fUnlock.value.trim() || null;
  scene.text = els.fText.value;
}

function setInspTab(name) {
  state.inspTab = name;
  document.querySelectorAll(".insp-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.insp === name);
  });
  document.querySelectorAll(".insp-panel").forEach((panel) => {
    const on = panel.id === `insp-${name}`;
    panel.hidden = !on;
    panel.classList.toggle("active", on);
  });
  if (name === "art") renderAssetBrowser();
}

let assetFolder = "scene_images";

function assignArtSlot(slot, filename, sceneId = state.selected) {
  const scene = sceneId && state.scenes[sceneId];
  if (!scene) return;
  if (slot === "bg") {
    scene.sceneImage = filename || null;
    if (state.selected === sceneId) els.fBg.value = filename || "";
  } else if (slot === "left") {
    scene.characterLeft = filename || null;
    if (state.selected === sceneId) els.fLeft.value = filename || "";
  } else if (slot === "right") {
    scene.characterRight = filename || null;
    if (state.selected === sceneId) els.fRight.value = filename || "";
  }
  markDirty("art-assign");
  if (state.selected === sceneId) {
    updateArtPreview(scene);
    updateStats(scene);
    renderAssetBrowser();
  } else {
    renderList();
  }
  toast(
    filename
      ? state.selected === sceneId
        ? `Assigned ${filename}`
        : `Assigned ${filename} → ${sceneId}`
      : "Cleared slot"
  );
}

function renderAssetBrowser() {
  const grid = document.getElementById("asset-grid");
  if (!grid) return;
  const files = assetFolder === "characters" ? state.assets.characters || [] : state.assets.sceneImages || [];
  const scene = state.scenes[state.selected];
  const selected =
    assetFolder === "characters"
      ? [scene?.characterLeft, scene?.characterRight].filter(Boolean)
      : [scene?.sceneImage].filter(Boolean);

  if (!files.length) {
    grid.innerHTML = `<p class="asset-grid-empty">No images yet. Upload or drop a file onto a slot.</p>`;
    return;
  }

  grid.innerHTML = files
    .map((f) => {
      const url = projectAsset(`assets/${assetFolder}/${encodeURIComponent(f)}`);
      const sel = selected.includes(f) ? "selected" : "";
      return `<button type="button" class="asset-tile ${sel}" draggable="true" data-file="${escapeAttr(f)}" title="${escapeAttr(f)}">
        <img src="${escapeAttr(url)}" alt="" loading="lazy" />
        <span>${escapeAttr(f)}</span>
      </button>`;
    })
    .join("");

  grid.querySelectorAll(".asset-tile").forEach((tile) => {
    const file = tile.dataset.file;
    tile.addEventListener("click", () => {
      if (assetFolder === "characters") {
        // Prefer empty left, else right, else replace left
        const sc = state.scenes[state.selected];
        if (!sc?.characterLeft) assignArtSlot("left", file);
        else if (!sc?.characterRight) assignArtSlot("right", file);
        else assignArtSlot("left", file);
      } else {
        assignArtSlot("bg", file);
      }
    });
    tile.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-if-asset", JSON.stringify({ folder: assetFolder, file }));
      e.dataTransfer.setData("text/plain", file);
      e.dataTransfer.effectAllowed = "copy";
    });
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Resize/compress large images in-browser before upload (Phase 2 asset pipeline). */
async function prepareImageForUpload(file, folder) {
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return { dataUrl: await readFileAsDataUrl(file), filename: file.name, resized: false };
  }
  const maxEdge = folder === "characters" ? 1024 : 1920;
  const quality = 0.85;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 1.5 * 1024 * 1024 && file.type !== "image/png") {
      return { dataUrl: await readFileAsDataUrl(file), filename: file.name, resized: false };
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const preferJpeg = folder === "scene_images" || file.type === "image/jpeg";
    const mime = preferJpeg ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(mime, quality);
    let filename = file.name.replace(/\.[^.]+$/, preferJpeg ? ".jpg" : ".png");
    if (!/\.(jpe?g|png)$/i.test(filename)) filename += preferJpeg ? ".jpg" : ".png";
    return { dataUrl, filename, resized: scale < 1 || mime !== file.type, width: w, height: h };
  } finally {
    bitmap.close?.();
  }
}

async function uploadAssetFile(file, folder = assetFolder) {
  const prepared = await prepareImageForUpload(file, folder);
  const res = await fetch("/api/assets/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder,
      filename: prepared.filename,
      dataUrl: prepared.dataUrl,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
  state.assets.sceneImages = data.sceneImages || state.assets.sceneImages;
  state.assets.characters = data.characters || state.assets.characters;
  fillDatalist("scene-image-ids", state.assets.sceneImages || []);
  fillDatalist("character-ids", state.assets.characters || []);
  if (data.renamed && data.filename) {
    toast(`Saved as ${data.filename} (name was already taken)`);
  } else if (prepared.resized) {
    toast(`Optimized ${prepared.filename}${prepared.width ? ` (${prepared.width}×${prepared.height})` : ""}`);
  }
  return data;
}

function bindAssetBrowser() {
  document.querySelectorAll("[data-asset-folder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      assetFolder = btn.dataset.assetFolder;
      document.querySelectorAll("[data-asset-folder]").forEach((b) => b.classList.toggle("active", b === btn));
      renderAssetBrowser();
    });
  });

  const fileInput = document.getElementById("asset-file-input");
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const targetSceneId = state.selected;
    const folder = assetFolder;
    try {
      toast(`Uploading ${file.name}…`);
      const data = await uploadAssetFile(file, folder);
      renderAssetBrowser();
      if (folder === "scene_images") assignArtSlot("bg", data.filename, targetSceneId);
      else assignArtSlot("left", data.filename, targetSceneId);
    } catch (err) {
      showLog("Upload failed", String(err.message || err));
    }
  });

  document.querySelectorAll("[data-art-slot]").forEach((el) => {
    const slot = el.dataset.artSlot;
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const raw = e.dataTransfer.getData("application/x-if-asset");
      if (raw) {
        try {
          const { folder, file } = JSON.parse(raw);
          if (slot === "bg" && folder !== "scene_images") {
            toast("Use a background image for this slot");
            return;
          }
          if ((slot === "left" || slot === "right") && folder !== "characters") {
            // still allow assigning scene images as characters if user insists? better warn
            toast("Prefer character assets for sprite slots");
          }
          assignArtSlot(slot, file);
        } catch {
          /* ignore */
        }
        return;
      }
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const folder = slot === "bg" ? "scene_images" : "characters";
      const targetSceneId = state.selected;
      try {
        toast(`Uploading ${file.name}…`);
        const data = await uploadAssetFile(file, folder);
        assetFolder = folder;
        document.querySelectorAll("[data-asset-folder]").forEach((b) =>
          b.classList.toggle("active", b.dataset.assetFolder === folder)
        );
        renderAssetBrowser();
        assignArtSlot(slot, data.filename, targetSceneId);
      } catch (err) {
        showLog("Upload failed", String(err.message || err));
      }
    });
  });
}

function bindInspectorFields() {
  const onFieldChange = () => {
    flushInspectorToState();
    markDirty("inspector");
    const scene = state.scenes[state.selected];
    if (!scene) return;
    updateStats(scene);
    updateArtPreview(scene);
    els.heading.textContent = scene.speaker || state.selected;
    graph.draw(state.scenes, state.startId);
    // Do not renderList() here — blur+rebuild mid-click swallows the next
    // scene-list click after typing in the inspector.
  };

  [els.fSpeaker, els.fBg, els.fLeft, els.fRight, els.fUnlock].forEach((el) => {
    el.addEventListener("change", onFieldChange);
  });
  els.fId.addEventListener("change", () => {
    renameSelectedScene(els.fId.value);
  });
  els.fId.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      els.fId.blur();
    }
  });
  [els.fBg, els.fLeft, els.fRight].forEach((el) => {
    el.addEventListener("input", () => {
      flushInspectorToState();
      updateArtPreview(state.scenes[state.selected]);
    });
  });
  els.fText.addEventListener("input", () => {
    flushInspectorToState();
    state.dirty = true;
    document.title = "• Illustrated IF Studio";
    syncShellBusyFlags();
    updateStats(state.scenes[state.selected]);
    clearTimeout(textHistoryTimer);
    textHistoryTimer = setTimeout(() => {
      textHistoryTimer = null;
      pushHistory("text");
    }, 700);
  });
  els.fText.addEventListener("change", onFieldChange);

  document.querySelectorAll(".insp-tab").forEach((tab) => {
    tab.addEventListener("click", () => setInspTab(tab.dataset.insp));
  });

  document.getElementById("btn-insert-name").addEventListener("click", () => {
    const ta = els.fText;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + "[NAME]" + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + 6;
    flushInspectorToState();
    markDirty("insert-name");
    updateStats(state.scenes[state.selected]);
  });

  document.getElementById("btn-play-scene").addEventListener("click", () => {
    openPreview(state.selected);
  });
}

let saveInFlight = null;
async function saveProject() {
  if (saveInFlight) return saveInFlight;
  saveInFlight = (async () => {
    try {
      commitPendingSceneRename();
      flushInspectorToState();
      designApi?.flush?.();
      const scenesRes = await fetch("/api/scenes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: state.startId, scenes: state.scenes }),
      });
      let scenesData = {};
      try {
        scenesData = await scenesRes.json();
      } catch {
        scenesData = {};
      }
      if (!scenesRes.ok) {
        showLog(
          "Save failed",
          scenesData.error ||
            (scenesRes.status === 413
              ? "Story is too large to save (over 8 MB). Split scenes or shrink pasted text."
              : `Could not save scenes (HTTP ${scenesRes.status}).`)
        );
        return false;
      }

      const themeRes = await fetch("/api/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: mergeTheme(state.theme) }),
      });
      let themeData = {};
      try {
        themeData = await themeRes.json();
      } catch {
        themeData = {};
      }
      if (!themeRes.ok) {
        showLog("Theme save failed", themeData.error || `HTTP ${themeRes.status}`);
        return false;
      }

      clearDirty();
      toast(`Saved ${scenesData.count} scenes + theme`);
      return true;
    } catch (err) {
      // Network drop / body-too-large socket reset used to leave a silent dirty
      // dot with no toast — beginners thought Save was broken.
      showLog(
        "Save failed",
        String(err?.message || err) || "Network error — is the studio still running?"
      );
      return false;
    }
  })().finally(() => {
    saveInFlight = null;
  });
  return saveInFlight;
}

/** Load the active project; on failure optionally restore a previous id. */
async function loadProjectOrExplain(failTitle = "Couldn't open project", revertToId = null) {
  try {
    await loadProject();
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (revertToId) {
      try {
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeProjectId: revertToId }),
        });
        await loadProject();
        showLog(
          failTitle,
          `${msg}\n\nStayed on ${revertToId} so Save won't write into the broken project.`
        );
        return false;
      } catch (err2) {
        showLog(failTitle, `${msg}\n\nAlso couldn't restore ${revertToId}: ${err2?.message || err2}`);
        return false;
      }
    }
    showLog(failTitle, msg);
    return false;
  }
}

let designApi = null;
function ensureDesignMounted() {
  const root = document.getElementById("workspace-design");
  if (!root || designApi) {
    designApi?.refresh?.();
    return;
  }
  designApi = mountDesignStudio(root, {
    getTheme: () => state.theme,
    setTheme: (t) => {
      state.theme = mergeTheme(t);
    },
    onDirty: () => {
      syncDirtyFromFingerprint();
    },
  });
}

let cliReady = false;
const cliHistory = [];
let cliHistoryIdx = -1;

function cliAppend(text, cls = "") {
  const out = document.getElementById("cli-out");
  if (!out || !text) return;
  const line = document.createElement("div");
  line.className = `cli-line ${cls}`.trim();
  line.textContent = text;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function validCliSceneId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return { ok: false, text: "Scene id required." };
  if (id.length > 64 || /\s/.test(id) || /[<>&"'`/\\]/.test(id) || !SCENE_ID_RE.test(id)) {
    return { ok: false, text: "Scene ids use letters, numbers, hyphens, or underscores (no spaces)." };
  }
  return { ok: true, id };
}

async function saveCliStoryChange(label) {
  const saved = await saveProject();
  return saved
    ? { text: `${label}\n[SAVED] Your story is safe. [UNDO] is available above.`, ok: true }
    : { text: `${label}\n[SAVE FAILED] The change is still open in the editor.`, ok: false };
}

async function cliCreateScene(rawId) {
  const check = validCliSceneId(rawId);
  if (!check.ok) return check;
  const id = check.id;
  if (state.scenes[id]) return { text: `[EXISTS] Scene: ${id}\nTry select ${id} to inspect it.`, ok: false };
  flushInspectorToState();
  state.scenes[id] = {
    id,
    sceneImage: "default.svg",
    characterLeft: null,
    characterRight: null,
    speaker: null,
    text: "Write what happens here.",
    unlockAbility: null,
    choices: [],
  };
  const base = graph.positions[state.selected] || { x: 0, y: 0 };
  graph.positions[id] = { x: base.x + 200, y: base.y + 40 };
  markDirty("cli-add-scene");
  refreshDatalists();
  selectScene(id, { skipFlush: true });
  return saveCliStoryChange(`[CREATED] Scene: ${id}\n[NEXT] Try: say "Something happens here."`);
}

async function cliWriteScene(id, text) {
  const scene = state.scenes[id];
  if (!scene) return { text: `[MISSING] No scene named "${id}".\nTry: add scene ${id}`, ok: false };
  flushInspectorToState();
  scene.text = text;
  markDirty("cli-write");
  selectScene(id, { skipFlush: true });
  return saveCliStoryChange(`[WROTE] ${id} · ${wordCount(text)} words`);
}

async function cliAddChoice(from, text, to) {
  const source = state.scenes[from];
  if (!source) return { text: `[MISSING] No scene named "${from}".`, ok: false };
  if (!state.scenes[to]) return { text: `[MISSING] No scene named "${to}".\nTry: add scene ${to}`, ok: false };
  flushInspectorToState();
  source.choices = source.choices || [];
  if (source.choices.some((choice) => choice.text === text && choice.next === to)) {
    return { text: `[EXISTS] ${from} already links to ${to} with that choice.`, ok: false };
  }
  source.choices.push({ text, next: to });
  markDirty("cli-choice");
  selectScene(from, { skipFlush: true });
  return saveCliStoryChange(`[LINKED] ${from} -> ${to}\n[CHOICE] ${text}`);
}

function cliSelectScene(id) {
  if (!state.scenes[id]) return { text: `[MISSING] No scene named "${id}".`, ok: false };
  selectScene(id);
  return { text: `[FOCUS] Scene: ${id}\n[MAP] Highlighted in the Story workspace.`, ok: true };
}

function ensureCliMounted() {
  if (cliReady) return;
  cliReady = true;
  const chips = document.getElementById("cli-chips");
  const form = document.getElementById("cli-form");
  const input = document.getElementById("cli-input");
  const out = document.getElementById("cli-out");
  const suggestions = document.getElementById("cli-suggestions");

  const renderSuggestions = () => {
    const items = getCliSuggestions(input.value, Object.keys(state.scenes).sort());
    suggestions.innerHTML = "";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cli-suggestion";
      btn.setAttribute("role", "option");
      const code = document.createElement("code");
      code.textContent = item.label;
      const hint = document.createElement("span");
      hint.textContent = item.hint;
      btn.append(code, hint);
      btn.addEventListener("click", () => {
        input.value = item.value;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        renderSuggestions();
      });
      suggestions.appendChild(btn);
    }
  };

  for (const chip of CLI_CHIPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cli-chip";
    btn.textContent = chip;
    btn.addEventListener("click", () => {
      input.value = chip;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      renderSuggestions();
    });
    chips.appendChild(btn);
  }

  cliAppend(
    "Illustrated IF Dev Console ready.\nTry: add scene attic · say \"The rain has started.\" · choice start \"Open the door\" -> attic\nStory commands save automatically. Press Tab for a suggestion.",
    "meta"
  );
  renderSuggestions();

  document.getElementById("cli-clear").addEventListener("click", () => {
    out.innerHTML = "";
    cliAppend("Cleared.", "meta");
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      const first = suggestions.querySelector(".cli-suggestion");
      if (first) {
        e.preventDefault();
        first.click();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!cliHistory.length) return;
      cliHistoryIdx = Math.max(0, cliHistoryIdx < 0 ? cliHistory.length - 1 : cliHistoryIdx - 1);
      input.value = cliHistory[cliHistoryIdx];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cliHistoryIdx < 0) return;
      cliHistoryIdx += 1;
      if (cliHistoryIdx >= cliHistory.length) {
        cliHistoryIdx = -1;
        input.value = "";
      } else {
        input.value = cliHistory[cliHistoryIdx];
      }
    }
  });
  input.addEventListener("input", renderSuggestions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const line = input.value.trim();
    if (!line) return;
    cliHistory.push(line);
    cliHistoryIdx = -1;
    input.value = "";
    renderSuggestions();
    cliAppend(`if> ${line}`, "cmd");
    try {
      const result = await runCliCommand(line, {
        startId: state.startId,
        saveFirst: async () => {
          flushInspectorToState();
          if (!state.dirty) return true;
          return saveProject();
        },
        confirmDiscard: (label) => confirmDiscardIfDirty(label),
        openPreview,
        selectedSceneId: state.selected,
        createScene: cliCreateScene,
        writeScene: cliWriteScene,
        addChoice: cliAddChoice,
        selectScene: cliSelectScene,
      });
      if (result.action === "clear") {
        out.innerHTML = "";
        return;
      }
      if (result.text) cliAppend(result.text, result.ok === false ? "err" : "ok");
      if (result.action === "reload") {
        const okLoad = await loadProjectOrExplain("Couldn't reload after CLI command");
        if (okLoad) cliAppend("Editor reloaded.", "meta");
      }
    } catch (err) {
      cliAppend(String(err.message || err), "err");
    }
  });
}

function setWorkspaceMode(mode) {
  state.mode = mode;
  const isDesign = mode === "design";
  const isProjects = mode === "projects";
  const isCli = mode === "cli";
  const isStory = mode === "story";
  document.body.classList.toggle("mode-design", isDesign);
  document.body.classList.toggle("mode-story", isStory);
  document.body.classList.toggle("mode-projects", isProjects);
  document.body.classList.toggle("mode-cli", isCli);
  document.getElementById("workspace-story").hidden = !isStory;
  document.getElementById("workspace-design").hidden = !isDesign;
  document.getElementById("workspace-projects").hidden = !isProjects;
  document.getElementById("workspace-cli").hidden = !isCli;
  document.getElementById("mode-story").classList.toggle("active", isStory);
  document.getElementById("mode-design").classList.toggle("active", isDesign);
  document.getElementById("mode-projects").classList.toggle("active", isProjects);
  document.getElementById("mode-cli").classList.toggle("active", isCli);
  document.getElementById("mode-story").setAttribute("aria-selected", String(isStory));
  document.getElementById("mode-design").setAttribute("aria-selected", String(isDesign));
  document.getElementById("mode-projects").setAttribute("aria-selected", String(isProjects));
  document.getElementById("mode-cli").setAttribute("aria-selected", String(isCli));
  if (isDesign) ensureDesignMounted();
  if (isProjects) refreshProjectsPane();
  if (isCli) {
    ensureCliMounted();
    requestAnimationFrame(() => document.getElementById("cli-input")?.focus());
  }
  if (isStory) {
    graph.draw(state.scenes, state.startId);
    requestAnimationFrame(() => graph.fit());
  }
}

function previewUrl(sceneId) {
  const params = new URLSearchParams({
    preview: "1",
    name: "Author",
    scene: sceneId || state.startId,
    t: String(Date.now()),
  });
  return `/engine-html/?${params.toString()}`;
}

async function openPreview(sceneId) {
  els.previewDock.hidden = false;
  // Design font/number fields may have typed values not yet in state.theme.
  designApi?.flush?.();
  commitPendingSceneRename();
  const ok = state.dirty ? await saveProject() : true;
  if (!ok) return;
  els.previewFrame.src = previewUrl(sceneId);
}

document.getElementById("btn-add-choice").addEventListener("click", () => {
  const scene = state.scenes[state.selected];
  if (!scene) return;
  scene.choices = scene.choices || [];
  scene.choices.push({ text: "New action", next: state.startId });
  markDirty("add-choice");
  setInspTab("actions");
  renderChoicesEditor(scene);
  graph.draw(state.scenes, state.startId);
  renderList();
  updateStats(scene);
});

document.getElementById("btn-add").addEventListener("click", () => {
  flushInspectorToState();
  let n = 1;
  let id = `scene_${n}`;
  while (state.scenes[id]) {
    n++;
    id = `scene_${n}`;
  }
  state.scenes[id] = {
    id,
    sceneImage: null,
    characterLeft: null,
    characterRight: null,
    speaker: null,
    text: "New scene text.",
    unlockAbility: null,
    choices: [],
  };
  const base = graph.positions[state.selected] || { x: 0, y: 0 };
  graph.positions[id] = { x: base.x + 200, y: base.y + 40 };
  markDirty("add-scene");
  // A filter that hides the new id made "+ Scene" look like a no-op and left
  // orphans only visible after Save. Clear the filter so the scene stays in view.
  if (els.filter?.value) {
    els.filter.value = "";
    toast(`Added ${id} (cleared scene filter so you can see it)`);
  } else {
    toast(`Added ${id}`);
  }
  renderList();
  selectScene(id);
  setInspTab("story");
});

document.getElementById("btn-delete").addEventListener("click", () => {
  const id = state.selected;
  if (!id || id === state.startId) {
    toast("Cannot delete the start scene");
    return;
  }
  const inbound = collectInbound(state.scenes);
  const n = inbound[id] || 0;
  const warn =
    n > 0
      ? `\n\n${n} other action${n === 1 ? "" : "s"} point here — those links will break until you fix them.`
      : "";
  if (!confirm(`Delete scene "${id}"?${warn}`)) return;
  delete state.scenes[id];
  delete graph.positions[id];
  for (const sc of Object.values(state.scenes)) {
    for (const c of sc.choices || []) {
      if (c.next === id) c.next = "";
    }
  }
  markDirty("delete");
  state.selected = state.startId;
  renderList();
  fillInspector();
  graph.draw(state.scenes, state.startId);
  toast(`Deleted ${id}`);
});

document.getElementById("btn-save").addEventListener("click", () => saveProject());
document.getElementById("mode-story").addEventListener("click", () => setWorkspaceMode("story"));
document.getElementById("mode-design").addEventListener("click", () => setWorkspaceMode("design"));
document.getElementById("mode-projects").addEventListener("click", () => setWorkspaceMode("projects"));
document.getElementById("mode-cli").addEventListener("click", () => setWorkspaceMode("cli"));
document.getElementById("btn-validate").addEventListener("click", async () => {
  flushInspectorToState();
  if (state.dirty) {
    const saved = await saveProject();
    if (!saved) return;
  }
  const res = await fetch("/api/validate", { method: "POST" });
  const data = await res.json();
  showLog(data.ok ? "Validate OK" : "Validate issues", data.output || "");
});
const exportMenu = document.getElementById("export-menu");
const exportBtn = document.getElementById("btn-export");
const exportDropdown = document.getElementById("export-dropdown");

function closeExportMenu() {
  exportDropdown.hidden = true;
  exportBtn.setAttribute("aria-expanded", "false");
}

exportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (els.logDialog?.open) {
    closeExportMenu();
    toast("Close the dialog first");
    return;
  }
  const open = exportDropdown.hidden;
  exportDropdown.hidden = !open;
  exportBtn.setAttribute("aria-expanded", open ? "true" : "false");
});

document.addEventListener("click", (e) => {
  if (!exportMenu.contains(e.target)) closeExportMenu();
});

function setExportInFlight(promise) {
  exportInFlight = promise;
  syncShellBusyFlags();
}
async function runExport(target) {
  if (exportInFlight) {
    toast("Export already in progress…");
    return exportInFlight;
  }
  const pinnedProjectId = state.projectId;
  setExportInFlight(
    (async () => {
      try {
        closeExportMenu();
        if (!(await saveProject())) return;
        toast(`Exporting ${target}…`);
        const dest = document.getElementById("proj-export-dest")?.value?.trim() || "";
        const endpoint = target === "all" ? "/api/export-all" : "/api/export";
        const body =
          target === "all"
            ? JSON.stringify({
                projectId: pinnedProjectId,
                ...(dest ? { destination: dest, saveDestination: true } : {}),
              })
            : JSON.stringify({
                target,
                projectId: pinnedProjectId,
                ...(dest ? { destination: dest, saveDestination: true } : {}),
              });
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = { error: `Export returned non-JSON (HTTP ${res.status})` };
        }
        let extra = "";
        if (data.downloadUrl) {
          extra = `\n\nDownload: ${location.origin}${data.downloadUrl}`;
        } else if (data.folder) {
          extra = `\n\nFolder: ${data.folder}`;
        } else if (data.results) {
          const links = data.results
            .filter((r) => r.downloadUrl || r.folder)
            .map((r) => `${r.target}: ${r.downloadUrl ? location.origin + r.downloadUrl : r.folder}`);
          if (links.length) extra = `\n\nOutputs:\n${links.join("\n")}`;
        }
        showLog(data.ok ? "Export OK" : "Export failed", (data.output || data.error || "") + extra);
        if (data.ok && data.downloadUrl) {
          const a = document.createElement("a");
          a.href = data.downloadUrl;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (err) {
        showLog("Export failed", String(err?.message || err));
      }
    })().finally(() => {
      setExportInFlight(null);
    })
  );
  return exportInFlight;
}

exportDropdown.querySelectorAll("[data-export]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (els.logDialog?.open) {
      closeExportMenu();
      toast("Close the dialog first");
      return;
    }
    runExport(btn.dataset.export);
  });
});
document.getElementById("btn-fit").addEventListener("click", () => graph.fit());
document.getElementById("btn-auto").addEventListener("click", () => {
  graph.layout(state.scenes, state.startId);
  toast("Auto-layout applied");
});
document.getElementById("btn-undo").addEventListener("click", () => {
  flushPendingTextHistory();
  flushInspectorToState();
  const snap = history.undo();
  if (snap) {
    applySnapshot(snap);
    toast("Undo");
  }
});
document.getElementById("btn-redo").addEventListener("click", () => {
  flushPendingTextHistory();
  const snap = history.redo();
  if (snap) {
    applySnapshot(snap);
    toast("Redo");
  }
});
function closePreviewDock() {
  els.previewDock.hidden = true;
  // Unload the iframe so BGM / timers cannot keep running while the dock is hidden.
  els.previewFrame.src = "about:blank";
}

document.getElementById("btn-preview-toggle").addEventListener("click", () => {
  if (els.previewDock.hidden) openPreview(state.selected || state.startId);
  else closePreviewDock();
});
document.getElementById("btn-preview-here").addEventListener("click", () => openPreview(state.selected));
document.getElementById("btn-preview-start").addEventListener("click", () => openPreview(state.startId));
document.getElementById("btn-preview-reload").addEventListener("click", () => openPreview(state.selected || state.startId));
document.getElementById("btn-preview-close").addEventListener("click", () => closePreviewDock());

els.filter.addEventListener("input", renderList);

async function refreshProjectsPane() {
  const [settingsRes, projectsRes] = await Promise.all([fetch("/api/settings"), fetch("/api/projects")]);
  const settings = await settingsRes.json();
  const { projects, activeProjectId, recentProjects } = await projectsRes.json();
  const sel = document.getElementById("proj-active");
  sel.innerHTML = (projects || [])
    .map(
      (p) =>
        `<option value="${escapeAttr(p.id)}" ${p.id === activeProjectId ? "selected" : ""}>${escapeAttr(
          p.title || p.id
        )} (${escapeAttr(p.id)})</option>`
    )
    .join("");
  document.getElementById("proj-active-path").textContent = settings.projectDir || "";
  document.getElementById("proj-export-dest").value = settings.exportDestination || "";
  document.getElementById("proj-import-folder").value = settings.lastImportPath || "";

  const recentEl = document.getElementById("proj-recent");
  const recent = (recentProjects || settings.recentProjects || []).filter((id) =>
    (projects || []).some((p) => p.id === id)
  );
  if (recent.length) {
    recentEl.hidden = false;
    recentEl.innerHTML =
      `<span class="insp-hint">Recently opened:</span> ` +
      recent
        .map((id) => `<button type="button" class="btn" data-recent="${escapeAttr(id)}">${escapeAttr(id)}</button>`)
        .join("");
    recentEl.querySelectorAll("[data-recent]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.getElementById("proj-active").value = btn.dataset.recent;
        document.getElementById("btn-proj-open").click();
      });
    });
  } else {
    recentEl.hidden = true;
    recentEl.innerHTML = "";
  }
}

document.getElementById("proj-new-title")?.addEventListener("input", () => {
  const title = document.getElementById("proj-new-title").value.trim();
  const idEl = document.getElementById("proj-new-id");
  if (!idEl.dataset.touched) {
    idEl.value = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  }
});
document.getElementById("proj-new-id")?.addEventListener("input", () => {
  document.getElementById("proj-new-id").dataset.touched = "1";
});

document.getElementById("btn-proj-new").addEventListener("click", async () => {
  if (exportInFlight) {
    toast("Wait for the current export to finish");
    return;
  }
  if (!(await confirmDiscardIfDirty("create a new project"))) return;
  const title = document.getElementById("proj-new-title").value.trim();
  const projectId = document.getElementById("proj-new-id").value.trim();
  const author = document.getElementById("proj-new-author").value.trim();
  if (!title && !projectId) {
    toast("Enter a title or id");
    return;
  }
  toast("Creating…");
  const body = { title, projectId: projectId || undefined, author: author || undefined, activate: true };
  let res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = await res.json();
  if (data.needsOverwrite) {
    if (!window.confirm(`Project "${data.projectId}" already exists. Overwrite?`)) {
      showLog("Create cancelled", "Existing project left untouched.");
      return;
    }
    body.overwrite = true;
    res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json();
  }
  showLog(data.ok ? "Created" : "Create failed", data.output || data.error || "");
  if (data.ok) {
    document.getElementById("proj-new-title").value = "";
    document.getElementById("proj-new-id").value = "";
    delete document.getElementById("proj-new-id").dataset.touched;
    if (await loadProjectOrExplain("Created, but couldn't open it")) {
      await refreshProjectsPane();
      setWorkspaceMode("story");
      toast(`Opened ${data.projectId}`);
    }
  }
});

document.getElementById("btn-proj-open").addEventListener("click", async () => {
  if (exportInFlight) {
    toast("Wait for the current export to finish");
    return;
  }
  if (!(await confirmDiscardIfDirty("switch projects"))) return;
  const id = document.getElementById("proj-active").value;
  const previousId = state.projectId;
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeProjectId: id }),
  });
  const data = await res.json();
  if (!res.ok) {
    showLog("Switch failed", data.error || JSON.stringify(data));
    return;
  }
  if (await loadProjectOrExplain("Couldn't open project", previousId)) {
    toast(`Active: ${id}`);
    setWorkspaceMode("story");
  } else {
    await refreshProjectsPane();
  }
});

document.getElementById("btn-proj-save-dest").addEventListener("click", async () => {
  const exportDestination = document.getElementById("proj-export-dest").value.trim();
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exportDestination }),
  });
  const data = await res.json();
  if (!res.ok) {
    // Keep the field from looking "saved" when the server rejected an unsafe path.
    try {
      const cur = await (await fetch("/api/settings")).json();
      document.getElementById("proj-export-dest").value = cur.exportDestination || "";
    } catch {
      /* ignore */
    }
    showLog("Settings failed", data.error || "");
    return;
  }
  document.getElementById("proj-export-dest").value = data.settings?.exportDestination || "";
  toast("Export destination saved");
  showLog(
    "Destination saved",
    `Exports go to:\n${data.settings.resolvedExportDestination || exportDestination || "(studio dist folder)"}`
  );
});

document.getElementById("btn-proj-export-raw").addEventListener("click", () => runExport("raw"));

async function runImport(body) {
  if (exportInFlight) {
    toast("Wait for the current export to finish");
    return;
  }
  if (!(await confirmDiscardIfDirty("import a project"))) return;
  toast("Importing…");
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.needsOverwrite) {
    const ok = window.confirm(
      `Project "${data.projectId}" already exists and will be replaced.\n\nOverwrite it?`
    );
    if (!ok) {
      showLog("Import cancelled", "Existing project left untouched.");
      return;
    }
    body.overwrite = true;
    const res2 = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data2 = await res2.json();
    showLog(data2.ok ? "Import OK" : "Import failed", data2.output || (data2.errors || []).join("\n") || data2.error || "");
    if (data2.ok && (await loadProjectOrExplain("Imported, but couldn't open it"))) {
      await refreshProjectsPane();
      setWorkspaceMode("story");
    }
    return;
  }
  showLog(data.ok ? "Import OK" : "Import failed", data.output || (data.errors || []).join("\n") || data.error || "");
  if (data.ok && (await loadProjectOrExplain("Imported, but couldn't open it"))) {
    await refreshProjectsPane();
    setWorkspaceMode("story");
  }
}

document.getElementById("btn-proj-import-folder").addEventListener("click", async () => {
  const sourcePath = document.getElementById("proj-import-folder").value.trim();
  const projectId = document.getElementById("proj-import-folder-id").value.trim();
  if (!sourcePath) {
    toast("Paste a folder path first");
    return;
  }
  await runImport({ kind: "folder", sourcePath, projectId: projectId || undefined, activate: true });
});

document.getElementById("btn-proj-import-html").addEventListener("click", async () => {
  const sourcePath = document.getElementById("proj-import-html").value.trim();
  const projectId = document.getElementById("proj-import-html-id").value.trim();
  const title = document.getElementById("proj-import-html-title").value.trim();
  if (!sourcePath) {
    toast("Paste an HTML/TXT path first");
    return;
  }
  await runImport({
    kind: "html",
    sourcePath,
    projectId: projectId || undefined,
    title: title || undefined,
    activate: true,
  });
});

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("btn-undo").click();
  } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
    e.preventDefault();
    document.getElementById("btn-redo").click();
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveProject();
  }
});

window.addEventListener("beforeunload", (e) => {
  // Dirty edits OR an in-flight export — Electron main shows a real dialog via
  // will-prevent-unload; browsers use their generic leave-site prompt.
  if (state.dirty || exportInFlight) {
    e.preventDefault();
    e.returnValue = "";
  }
});

bindInspectorFields();
bindAssetBrowser();
loadProject().catch((err) => {
  els.title.textContent = "Load failed";
  els.meta.textContent = String(err.message || err);
  showLog("Boot error", String(err.stack || err));
});
