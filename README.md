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

```bat
RUN-EDITOR.bat
```

Or PowerShell: `.\RUN-EDITOR.ps1` · npm: `npm run electron`

Installs Electron on first launch if needed. Options: `-ReuseServer`, `-Headless`, `-Port 8790`.

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
- **Python** setup installs Python 3.12 (tkinter)  
- **C++** setup installs Git, CMake, VS 2022 Build Tools (C++)

Studio itself: run `SETUP-ADMIN.bat` in this folder if Node is missing.

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
