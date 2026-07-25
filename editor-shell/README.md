# Illustrated IF Studio desktop shell

The desktop app is **Electron**, not Tauri.

| Path | Role |
|------|------|
| `../electron/main.mjs` | Window + boots/reuses the studio server |
| `../electron/preload.cjs` | Safe preload bridge (`window.ifStudioDesktop`) |
| `../Illustrated IF Studio.vbs` | Friendly no-console launcher (for non-coders) |
| `../tools/launch-studio.ps1` | Quiet launcher engine the `.vbs` runs |
| `../tools/emergency/RUN-EDITOR.bat` / `.ps1` | Manual/debug launch with a console (installs Electron on first run) |

```bash
npm run electron
npm run test:electron
```

Browser mode (no desktop shell): `npm start` → http://127.0.0.1:8787/editor-web/

This folder is kept as a pointer so older “Tauri shell” notes still resolve; prefer `electron/` for all new work.
