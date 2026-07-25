# Illustrated IF Studio (code)

**Illustrated text-based RPG** editor + engines (HTML / Python / C++). Not a visual novel toolkit.

## Quick start

```bash
cd illustrated-if-studio
npm start
```

| URL | What |
|-----|------|
| http://127.0.0.1:8787/editor-web/ | Studio editor |
| http://127.0.0.1:8787/engine-html/ | Player (active project) |
| http://127.0.0.1:8787/api/health | Backend health |

### Desktop app (Electron)

Friendly launcher (what you hand to a non-coder): double-click **`Illustrated IF Studio.vbs`**
in the root. It starts the studio quietly (no console window) and opens the Electron editor.

For development: `npm run electron`, or the manual/debug launcher `tools\emergency\RUN-EDITOR.bat`
(shows a console + errors; options `-ReuseServer`, `-Headless`, `-Port 8790`).

Electron is installed on first launch if it isn't already in `node_modules/`.

Editor tabs: **Story** · **Design** · **Projects** (New / Open / import / raw export destination) · **CLI**.

Art tab includes an **asset browser** — click, drag, or drop images onto background / character slots (large images are resized on upload).

Player **Settings → Save slots** writes checkpoints to `projects/<id>/saves/` when the studio server is running.

### Checks

```bash
npm run validate
npm run check
npm run smoke
npm run playtest
npm run test:cli
npm run test:switch
npm run test:saves
npm run test:saves-labels
npm run test:rollback
npm run test:audio
npm run test:locale
npm run test:layout
npm run test:python-saves
npm run test:electron
npm run build:python-exe -- --skip-build   # export Python package (+ BUILD-EXE.bat)
```

## Send it to someone who can't code (hand-off zip)

The recipient never has to touch a terminal, winget, `git`, or `npm`. Zip this folder,
they unzip and double-click **one** thing.

**What they do (all they do):**

1. **Unzip** the folder somewhere simple, e.g. `Documents\illustrated-if-studio`
   (avoid deep/OneDrive-synced paths; spaces are fine).
2. Double-click **`Illustrated IF Studio`** (the `.vbs` launcher in the root).
3. Make their game. The window opens straight into the studio with `sample-project` loaded.

**First-run install, handled quietly:** the launcher starts with **no visible console**.
If Node.js is missing it shows a friendly pop-up ("Windows needs permission to finish
installing…"), triggers the emergency setup once (UAC + winget, needs internet), then
opens the studio. If Electron isn't bundled it fetches it once with a "getting ready…"
pop-up. No wall of terminal text, and it never leaves them staring at a `cmd` prompt.

The scary developer scripts (`SETUP-ADMIN.*`, manual `RUN-EDITOR.*`) live out of sight in
**`tools/emergency/`** with a plain-language `README.txt` — recovery is there if they ever
need it, but it isn't in their face.

**What to put in the zip vs. leave out** (zip from Explorer, or use the exclude list below):

| Include | Leave out |
|---------|-----------|
| Everything under the folder: `Illustrated IF Studio.vbs`, `README.txt`, `tools/`, `server/`, `electron/`, `editor-web/`, `engine-*/`, `scripts/`, `projects/`, `package.json` | `.git/` (huge, unneeded), `dist/` (regenerates), `build/`, any `*.zip` archives, `studio-settings.json` (machine-local; harmless if left in, but delete it for a clean start) |

- **`node_modules/`** (~320 MB, almost all Electron): **recommended to include** for a
  non-coder — it makes the studio open instantly with no first-run download. Leave it out only
  for a much smaller zip (the launcher then fetches Electron once, needs internet). Node.js
  still must be installed either way (handled automatically by the launcher / emergency setup).
- **Playwright** is only for the dev test suite — the recipient never needs it.
- `projects/finding-secrets/` is git-ignored but **is on disk**, so an Explorer zip of the
  folder **will include it**. It's not the default (the studio opens `sample-project`), but
  **delete that subfolder before zipping** if you don't want to share it.

**Gotchas (all handled, but good to know):**
- The one-time setup needs Administrator (UAC "Yes") + winget ("App Installer", preinstalled on
  Windows 10/11) + internet. The pop-up frames the UAC prompt so it isn't a surprise.
- Windows SmartScreen/antivirus may flag `.vbs`/`.bat`/`.ps1` from a downloaded zip. Right-click
  the zip → **Properties → Unblock** *before* extracting, or on the warning choose
  **More info → Run anyway**.
- If they already have Node.js and Electron is bundled, double-clicking the launcher opens the
  studio immediately with no prompts at all.

## Export packages

From the editor **Export** menu, or CLI:

```bash
npm run export:html     # dist/*-web.zip   (+ SETUP-ADMIN.bat / PLAY.bat)
npm run export:python   # dist/*-python.zip
npm run export:cpp      # dist/*-cpp.zip
npm run export:all
npm run smoke           # re-export + verify packages + boot HTML
```

Each Windows zip includes:

| Script | Purpose |
|--------|---------|
| `SETUP-ADMIN.bat` | UAC elevate → install prerequisites via winget |
| `PLAY.bat` | Launch the game (installs prereqs first if missing) |

- **HTML** setup installs Node.js LTS  
- **Python** setup installs Python 3.12 + pygame into a local `.venv` (PLAY.bat auto-installs on first launch too)  
- **C++** setup installs Git, CMake, VS 2022 Build Tools (C++)

Studio itself: the friendly launcher (`Illustrated IF Studio.vbs`) installs Node if it's
missing. To do it by hand, run `tools\emergency\SETUP-ADMIN.bat`.

## Design (creator UX)

In the editor, switch **Story → Design**:

- **Colors** — full palette + fonts (default: void-violet black/purple)
- **Scene template** — art position, action grid, hotkeys, frame chrome
- **Menu template** — title gate style, buttons, brand/byline, settings layout

Saved into `theme/theme.json` with the project (also included in HTML/Python/C++ exports).

## Projects

Projects live under `projects/<id>/` (`project.json` + `story/` + `assets/` + `theme/`).
A generic `projects/sample-project/` ships with the studio as the default project so
the editor, exporters, players, and checks have something to run against. Create your
own game from the **Projects** tab (or CLI `use <id>`); the active project is stored in
the git-ignored `studio-settings.json`.

## Design docs

Obsidian vault: `../illustrated-if-docs/`

Steam-oriented packaging (depots, build targets, saves, ratings pitfalls): [`../illustrated-if-docs/05 Export/Steam Packaging.md`](../illustrated-if-docs/05%20Export/Steam%20Packaging.md) — docs only; no Steamworks SDK in this repo.
