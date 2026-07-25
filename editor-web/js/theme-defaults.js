/** Browser copy of theme defaults (keep in sync with server/lib/theme-defaults.mjs). */
export const DEFAULT_THEME = {
  id: "void-violet",
  fonts: {
    display: "MedievalSharp",
    ui: "Cinzel",
    body: "Literata",
  },
  colors: {
    bg: "#050208",
    frame: "#6b21a8",
    stage: "#0a0612",
    panel: "#12081c",
    panelInner: "#1a0f2e",
    accent: "#a855f7",
    accentSoft: "#c084fc",
    text: "#f3e8ff",
    textOnLight: "#ede4ff",
    muted: "#a78bba",
    border: "#5b2d8e",
    speaker: "#e9d5ff",
    speakerBg: "#3b0764",
    choice: "#7c3aed",
    choiceHover: "#9333ea",
  },
  layout: {
    mode: "illustrated-if",
    artRatio: 0.62,
    maxWidth: 1100,
    gameHeight: 620,
  },
  templates: {
    scene: {
      id: "illustrated-if-default",
      label: "Illustrated IF (default)",
      artPosition: "left",
      choiceColumns: 2,
      showHotkeys: true,
      showSpeaker: true,
      showHideImage: true,
      choiceStyle: "filled",
      frameBorderPx: 3,
      storyRadiusPx: 8,
      artRatio: 0.62,
    },
    menu: {
      id: "gate-default",
      label: "Title gate (default)",
      gateStyle: "centered-card",
      showBrandMark: true,
      showByline: true,
      buttonStyle: "filled",
      titleAlign: "center",
      settingsLayout: "stack",
    },
  },
};

export const COLOR_FIELDS = [
  ["bg", "Page background"],
  ["frame", "Game frame border"],
  ["stage", "Art stage"],
  ["panel", "Story panel"],
  ["panelInner", "Story text box"],
  ["accent", "Accent / titles"],
  ["accentSoft", "Soft accent"],
  ["text", "UI text"],
  ["textOnLight", "Story text"],
  ["muted", "Muted text"],
  ["border", "Borders"],
  ["speaker", "Speaker label text"],
  ["speakerBg", "Speaker label bg"],
  ["choice", "Action buttons"],
  ["choiceHover", "Action hover"],
];

export const SCENE_TEMPLATE_OPTIONS = {
  artPosition: [
    { value: "left", label: "Art left (classic)" },
    { value: "right", label: "Art right" },
    { value: "top", label: "Art on top" },
    { value: "hidden", label: "No art pane" },
  ],
  choiceColumns: [
    { value: 1, label: "1 column" },
    { value: 2, label: "2 columns" },
  ],
  choiceStyle: [
    { value: "filled", label: "Filled" },
    { value: "outline", label: "Outline" },
    { value: "soft", label: "Soft glow" },
  ],
};

export const MENU_TEMPLATE_OPTIONS = {
  gateStyle: [
    { value: "centered-card", label: "Centered card" },
    { value: "wide-banner", label: "Wide banner" },
    { value: "minimal", label: "Minimal" },
  ],
  buttonStyle: [
    { value: "filled", label: "Filled" },
    { value: "outline", label: "Outline" },
  ],
  titleAlign: [
    { value: "center", label: "Center" },
    { value: "left", label: "Left" },
  ],
  settingsLayout: [
    { value: "stack", label: "Stacked buttons" },
    { value: "grid", label: "2-column grid" },
  ],
};

export function mergeTheme(partial) {
  const base = JSON.parse(JSON.stringify(DEFAULT_THEME));
  if (!partial || typeof partial !== "object") return base;
  return {
    ...base,
    ...partial,
    id: partial.id || base.id,
    fonts: { ...base.fonts, ...(partial.fonts || {}) },
    colors: { ...base.colors, ...(partial.colors || {}) },
    layout: { ...base.layout, ...(partial.layout || {}) },
    templates: {
      scene: { ...base.templates.scene, ...(partial.templates?.scene || {}) },
      menu: { ...base.templates.menu, ...(partial.templates?.menu || {}) },
    },
  };
}
