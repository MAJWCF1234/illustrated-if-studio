import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, removeDir, slugify } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { zipDirectory } from "../lib/zip.mjs";
import { installWindowsScripts } from "./windows-scripts.mjs";

const APP_PY = `# Illustrated IF — desktop player entry point.
# Rendering lives in if_gui (pygame); story logic in the shared if_engine runtime.
from __future__ import annotations

import sys
import traceback
from pathlib import Path


def _root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def _alert(title: str, message: str) -> None:
    """Best-effort GUI alert for windowed (no console) runs."""
    print(f"{title}: {message}")
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
        except Exception:
            pass


def main() -> int:
    root = _root()
    sys.path.insert(0, str(root))
    project = root / "project"
    if not project.is_dir():
        _alert("Missing project", f"Could not find the project folder at:\\n{project}")
        return 1

    try:
        import pygame  # noqa: F401
    except ModuleNotFoundError:
        print("pygame is not installed.")
        print("On Windows just double-click PLAY.bat — it sets everything up automatically.")
        print("Manual install:  python -m pip install -r requirements.txt")
        print()
        print("Starting text-only fallback...")
        from if_engine.cli import main as cli_main

        return cli_main([str(project)])

    from if_gui import main as gui_main

    try:
        return gui_main(project)
    except Exception:
        log = Path(sys.executable).resolve().parent / "crash-log.txt" if getattr(sys, "frozen", False) else root / "crash-log.txt"
        try:
            log.write_text(traceback.format_exc(), encoding="utf-8")
        except OSError:
            pass
        traceback.print_exc()
        _alert("Illustrated IF crashed", f"Something went wrong.\\nDetails were written to:\\n{log}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
`;

export function exportPython({ studioRoot, projectDir, outRoot }) {
  const report = validateProject(projectDir);
  if (!report.ok) {
    return { ok: false, target: "python", errors: report.errors, warnings: report.warnings };
  }

  const project = report.project;
  const slug = slugify(project.id);
  const staging = path.join(outRoot, `${slug}-python`);
  const zipPath = path.join(outRoot, `${slug}-python.zip`);

  removeDir(staging);
  ensureDir(staging);

  const noPycache = { filter: (entry) => entry.name !== "__pycache__" };
  copyDir(path.join(studioRoot, "engine-python", "if_engine"), path.join(staging, "if_engine"), noPycache);
  copyDir(path.join(studioRoot, "engine-python", "if_gui"), path.join(staging, "if_gui"), noPycache);
  copyDir(projectDir, path.join(staging, "project"));
  fs.writeFileSync(path.join(staging, "app.py"), APP_PY);
  fs.writeFileSync(
    path.join(staging, "requirements.txt"),
    `# Illustrated IF Python package — graphical player dependency.
# PLAY.bat installs this automatically into a local .venv on first launch.
pygame>=2.5
`
  );
  fs.writeFileSync(
    path.join(staging, "README.md"),
    `# ${project.title}

Python package for an **illustrated text-based RPG** — a graphical desktop
player (pygame) with backgrounds, character sprites, and the project's theme.

## Windows — just play (no coding needed)

1. Double-click \`PLAY.bat\`.
   - First launch installs Python 3.12 (via a one-time Administrator prompt if
     it's missing) and the game libraries into a private \`.venv\` folder, then
     starts the game. Later launches start instantly.
2. That's it. If anything fails, double-click \`SETUP-ADMIN.bat\` once, then
   \`PLAY.bat\` again.

## Run manually

\`\`\`bash
python -m pip install -r requirements.txt
python app.py
\`\`\`

## Run headless (terminal, no graphics)

\`\`\`bash
python -m if_engine project
\`\`\`

## Project data

Story JSON + art + theme live in \`project/\`. Saves are written to
\`project/saves/\` (next to the .exe for frozen builds). Edit the files or
re-export from Illustrated IF Studio.

## Build a standalone exe (Windows)

Double-click \`BUILD-EXE.bat\` — installs PyInstaller and produces
\`dist-exe\\<id>.exe\` with Python, pygame, the engine, and the project data
frozen inside.

Or manually:

\`\`\`bash
pip install pyinstaller -r requirements.txt
pyinstaller --onefile --windowed --add-data "project;project" --add-data "if_engine;if_engine" --add-data "if_gui;if_gui" app.py
\`\`\`
`
  );
  fs.writeFileSync(
    path.join(staging, "run.bat"),
    `@echo off\r\ncall "%~dp0PLAY.bat"\r\n`
  );

  installWindowsScripts(staging, "python");
  zipDirectory(staging, zipPath);

  return {
    ok: true,
    target: "python",
    folder: staging,
    zip: zipPath,
    warnings: report.warnings,
    notes: report.notes,
    sceneCount: report.sceneCount,
  };
}
