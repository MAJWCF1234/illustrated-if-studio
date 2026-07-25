import { NovelEngine } from "./engine.js";
import { LocaleTables } from "./locale.js";
import { LayoutMode } from "./layout-mode.js";
import { PROJECT_BASE, initProjectBase } from "./config.js";

function qs(id) {
  return document.getElementById(id);
}

async function loadJson(rel) {
  const url = new URL(rel, PROJECT_BASE);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${rel}: ${res.status}`);
  return res.json();
}

async function loadLocaleTables(project) {
  const cfg = project.locales || {};
  const tables = {};
  for (const entry of cfg.available || []) {
    if (!entry?.file || !entry?.id) continue;
    try {
      tables[entry.id] = await loadJson(entry.file);
    } catch (err) {
      console.warn(`Locale overlay missing or invalid (${entry.id}):`, err.message || err);
    }
  }
  return new LocaleTables({
    projectId: project.id,
    localesConfig: cfg,
    tables,
    previewMode: new URLSearchParams(location.search).get("preview") === "1",
  });
}

function showBootError(err) {
  const el = qs("boot-error");
  el.hidden = false;
  el.textContent =
    String(err.message || err) +
    " — If you opened this as a file:// page, run: npm start (from illustrated-if studio folder)";
  console.error(err);
}

async function main() {
  try {
    await initProjectBase();
    const project = await loadJson("project.json");
    const scenes = await loadJson(project.story.scenes);
    const theme = await loadJson(project.theme || "theme/theme.json");
    let abilitiesDoc = { abilities: [] };
    try {
      abilitiesDoc = await loadJson(project.story.abilities);
    } catch {
      /* optional */
    }

    const localeTables = await loadLocaleTables(project);
    const previewMode = new URLSearchParams(location.search).get("preview") === "1";
    const layoutMode = new LayoutMode({
      projectId: project.id,
      themeMode: theme?.layout?.mode,
      projectMode: project?.meta?.layout,
      previewMode,
    });

    const engine = new NovelEngine({
      project,
      scenes,
      theme,
      assetBase: new URL("assets/", PROJECT_BASE).href,
      localeTables,
      layoutMode,
      root: {
        brandMark: qs("brand-mark"),
        gameTitle: qs("game-title"),
        gameAuthor: qs("game-author"),
        gate: qs("gate"),
        gateForm: qs("gate-form"),
        playerNameInput: qs("player-name"),
        continueBtn: qs("continue-btn"),
        novel: qs("novel"),
        stageBg: qs("stage-bg"),
        spriteLeft: qs("sprite-left"),
        spriteRight: qs("sprite-right"),
        speaker: qs("speaker"),
        storyText: qs("story-text"),
        choices: qs("choices"),
        textSize: qs("text-size"),
        btnHistory: qs("btn-history"),
        btnRollback: qs("btn-rollback"),
        btnSkip: qs("btn-skip"),
        btnAbilities: qs("btn-abilities"),
        btnRestart: qs("btn-restart"),
        btnHideArt: qs("btn-hide-art"),
        saveSlots: qs("save-slots"),
        saveBackendNote: qs("save-backend-note"),
        layoutPanel: qs("layout-panel"),
        layoutSelect: qs("layout-select"),
        layoutNote: qs("layout-note"),
        localePanel: qs("locale-panel"),
        localeSelect: qs("locale-select"),
        audioMute: qs("audio-mute"),
        audioBgm: qs("audio-bgm"),
        audioSfx: qs("audio-sfx"),
        audioBgmVal: qs("audio-bgm-val"),
        audioSfxVal: qs("audio-sfx-val"),
        abilityMenu: qs("ability-menu"),
        abilityList: qs("ability-list"),
        abilityClose: qs("ability-close"),
        toast: qs("toast"),
      },
      previewMode,
    });

    window.__ifEngine = engine;

    if (engine.root.brandMark) {
      engine.root.brandMark.textContent = "Illustrated IF";
    }

    engine.setAbilityCatalog(abilitiesDoc.abilities || []);

    const params = new URLSearchParams(location.search);
    const preview = params.get("preview") === "1";
    const jumpScene = params.get("scene");
    const previewName = params.get("name") || "Author";

    if (preview) {
      // Skip gate; jump straight into a scene for editor live preview (does not touch saves).
      engine.state.playerName = previewName;
      engine.root.playerNameInput.value = previewName;
      engine.root.gate.hidden = true;
      engine.root.novel.hidden = false;
      const scenesMap = scenes.scenes || scenes;
      const target = jumpScene && scenesMap[jumpScene] ? jumpScene : project.start;
      engine.state.history = [];
      engine.audio.unlock();
      engine.showScene(target);
    } else {
      engine.bootGate();
    }
  } catch (err) {
    showBootError(err);
  }
}

main();
