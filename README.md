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

Friendly launcher (what you hand to a non-coder): double-click **`Illustrated IF Studio`**
(the `.exe` in the root). No console window ever appears — it shows a small splash, boots the
server, and opens the Electron editor. Backup: `tools\emergency\Start the studio (backup).vbs`.

For development: `npm run electron`, or the manual/debug launcher `tools\emergency\RUN-EDITOR.bat`
(shows a console + errors; options `-ReuseServer`, `-Headless`, `-Port 8790`).

**When `node_modules/electron` is present, nothing else is needed — not even Node.** Electron
ships its own Node, and `electron/main.mjs` falls back to `process.execPath` with
`ELECTRON_RUN_AS_NODE=1` to run the server. That is what makes a bundled hand-off zip
install-free. Without it, the launcher installs Node (one UAC prompt) and downloads Electron.

#### Rebuilding the launcher

```bash
npm run build:launcher     # -> "Illustrated IF Studio.exe" in the root
```

Source: `scripts/launcher/Launcher.cs` (+ `app.manifest`), compiled by
`scripts/build-launcher.mjs` with the .NET Framework `csc.exe` built into Windows — no SDK,
no runtime for the recipient, and the icon is generated from the same void-violet mark as the
Electron window. Commit the rebuilt `.exe`; it is what ships in the zip. Language level is
**C# 5**, so no interpolated strings / `?.` / `nameof` in that file.

Useful while working on it: `--wizard`, `--simulate-no-node`, `--simulate-no-electron` force
the first-run screens without touching what's installed. Every run writes
`tools/logs/last-startup.txt`.

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
npm run check:windows                      # .bat/.ps1/.vbs are ASCII-only and still parse
npm run build:python-exe -- --skip-build   # export Python package (+ BUILD-EXE.bat)
```

> `check:windows` is not cosmetic. `powershell.exe` 5.1 reads a BOM-less `.ps1` as
> Windows-1252, so a UTF-8 em dash becomes `â€"` — that trailing byte is a smart quote, it
> closes the string early, and the script dies with a parse error. Keep launcher and setup
> scripts ASCII; `--fix` rewrites the typography for you.

## Send it to someone who can't code (hand-off zip)

The recipient never has to touch a terminal, winget, `git`, or `npm`. Build the zip for
them (don't Explorer-zip by hand — that can leak your own stories and
`studio-settings.json`):

```bash
npm run package:handoff
# also send specific stories of your own:
npm run package:handoff -- --projects sample-project,my-story
# every project in projects/:
npm run package:handoff -- --all-projects
# smaller zip (first launch downloads Electron):
npm run package:handoff -- --no-node-modules
```

Output: `dist/illustrated-if-studio-handoff-YYYY-MM-DD.zip` (script lives in
`tools/emergency/package-handoff.mjs`).

**What they do (all they do):**

1. **Unzip** the folder somewhere simple, e.g. `Documents\illustrated-if-studio`
   (avoid deep/OneDrive-synced paths; spaces are fine).
2. Double-click **`Illustrated IF Studio`** (the `.exe` in the root).
3. Make their game. The window opens straight into the studio with `sample-project` loaded.

**A bundled zip installs nothing.** `node_modules/electron` is all the studio needs, so the
default `npm run package:handoff` output goes unzip → double-click → studio window. No UAC,
no network, no prompts.

**If pieces are missing** (only with `--no-node-modules`, or a half-copied folder), the `.exe`
opens a plain-language wizard instead of the studio: what it needs, one big button, "Windows
may ask permission — click Yes", then an "Open the Studio" button. Progress is a marquee bar
with friendly sentences; raw `npm` / `winget` output goes to `tools/logs/last-startup.txt`,
never to the screen. Errors offer **Try again** and **Show the details**.

**Ordering matters on a first launch.** The one-time "also install tools for sharing games?"
question (Python / C++) is asked *after* the studio window is up, never before it — a
first-ever double-click should open the studio, not a question about C++ build tools. Saying
No is fine; every export zip installs its own prerequisites on first play, and
`tools\emergency\SETUP-EXPORT-TOOLS.bat` can do it later. The marker
`tools/.export-tools-offered` means it never asks twice.

The scary developer scripts (`SETUP-ADMIN.*`, `SETUP-EXPORT-TOOLS.*`, manual `RUN-EDITOR.*`)
live out of sight in **`tools/emergency/`** with a plain-language `README.txt`.

**What the packager includes / leaves out:**

| Include | Leave out |
|---------|-----------|
| `Illustrated IF Studio.exe`, `README.txt`, `tools/`, `server/`, `electron/`, `editor-web/`, `engine-*/`, `scripts/`, `projects/sample-project/`, `package.json`, **`node_modules/`** (recommended) | `.git/`, `dist/`, `build/`, `*.zip`, `studio-settings.json`, agent junk, and every other project in `projects/` unless you pass `--projects` or `--all-projects` |

**Gotchas (all handled, but good to know):**
- The one-time setup needs Administrator (UAC "Yes") + winget ("App Installer", preinstalled on
  Windows 10/11) + internet. The pop-up frames the UAC prompt so it isn't a surprise.
- Windows SmartScreen/antivirus may flag `.exe`/`.vbs`/`.bat`/`.ps1` from a downloaded zip. Right-click
  the zip → **Properties → Unblock** *before* extracting, or on the warning choose
  **More info → Run anyway**.
- If they already have Node.js and Electron is bundled, double-clicking the launcher opens the
  studio immediately (aside from the one optional sharing-tools question the first time).

## Export packages

From the editor **Export** menu, or CLI:

```bash
npm run export:html     # dist/*-web.zip
npm run export:site     # dist/*-site/ upload-ready static website
npm run export:python   # dist/*-python.zip
npm run export:cpp      # dist/*-cpp.zip
npm run export:all
npm run smoke           # re-export + verify packages + boot HTML
```

Each Windows zip includes:

| Script | Purpose |
|--------|---------|
| **`Play the Game`** (`.vbs`) | Primary: quiet launch + MsgBox wizard if tools are missing |
| `PLAY.bat` | Technical / debug path (same play flow, visible console) |
| `_emergency/SETUP-ADMIN.*` | UAC elevate → install prerequisites via winget (out of sight) |

- **HTML** setup installs Node.js LTS  
- **Python** setup installs Python 3.12 + pygame into a local `.venv`  
- **C++** setup installs Git, CMake, VS 2022 Build Tools (C++) — framed as a long download  

Studio itself: the friendly launcher installs Node if missing, and may optionally offer
Python/C++ sharing tools once. Manual: `tools\emergency\SETUP-ADMIN.bat` /
`SETUP-EXPORT-TOOLS.bat`.

### Static web hosting (Neocities)

Choose **Export → Static website (Neocities)** to create `dist/<game>-site/`.
Upload everything inside that folder to your site: `index.html`, `css/`, `js/`, and
`project/`. It is a normal static website and needs no Node.js, server process, or
terminal on the host. Browser saves remain on each player's own device.

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
