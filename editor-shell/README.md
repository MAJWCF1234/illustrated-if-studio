# Illustrated IF Studio desktop shell

The desktop app is **Electron**, not Tauri.

| Path | Role |
|------|------|
| `../electron/main.mjs` | Window + boots/reuses the studio server |
| `../electron/preload.cjs` | Safe preload bridge (`window.ifStudioDesktop`) |
| `../RUN-EDITOR.bat` / `../RUN-EDITOR.ps1` | One-click launch (installs Electron on first run) |

```bat
cd ..
RUN-EDITOR.bat
```

Or:

```bash
npm run electron
npm run test:electron
```

Browser mode (no desktop shell): `npm start` → http://127.0.0.1:8787/editor-web/

This folder is kept as a pointer so older “Tauri shell” notes still resolve; prefer `electron/` for all new work.
