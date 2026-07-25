import fs from "node:fs";
import path from "node:path";
import { copyDir, ensureDir, removeDir, slugify } from "../lib/fs-utils.mjs";
import { validateProject } from "../lib/validate.mjs";
import { zipDirectory } from "../lib/zip.mjs";
import { installWindowsScripts } from "./windows-scripts.mjs";

const TK_APP = `# Illustrated IF — desktop player (stdlib tkinter)
from __future__ import annotations

import json
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog

from if_engine.runtime import NovelRuntime


class IllustratedIfApp(tk.Tk):
    def __init__(self, project_dir: Path):
        super().__init__()
        self.runtime = NovelRuntime(project_dir)
        self.title(self.runtime.project.get("title", "Illustrated IF"))
        self.geometry("980x620")
        self.configure(bg="#050208")
        self.art_hidden = False

        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(0, weight=1)

        self.art = tk.Label(self, text="Illustration\\n(assets optional)", bg="#0a0612", fg="#a78bba",
                            font=("Georgia", 14), justify="center")
        self.art.grid(row=0, column=0, sticky="nsew", padx=(8, 4), pady=8)

        right = tk.Frame(self, bg="#12081c")
        right.grid(row=0, column=1, sticky="nsew", padx=(4, 8), pady=8)
        right.rowconfigure(1, weight=1)
        right.columnconfigure(0, weight=1)

        tabs = tk.Frame(right, bg="#0a0612")
        tabs.grid(row=0, column=0, sticky="ew")
        tk.Button(tabs, text="Story", command=lambda: self.show_tab("story"),
                  bg="#3b0764", fg="#f3e8ff", relief="flat").pack(side="left", padx=2, pady=2)
        tk.Button(tabs, text="Settings", command=lambda: self.show_tab("settings"),
                  bg="#3b0764", fg="#f3e8ff", relief="flat").pack(side="left", padx=2, pady=2)

        self.story_frame = tk.Frame(right, bg="#12081c")
        self.story_frame.grid(row=1, column=0, sticky="nsew")
        self.story_frame.rowconfigure(1, weight=1)
        self.story_frame.columnconfigure(0, weight=1)

        self.speaker = tk.Label(self.story_frame, text="", bg="#3b0764", fg="#e9d5ff",
                                font=("Georgia", 10, "bold"), anchor="w")
        self.speaker.grid(row=0, column=0, sticky="ew", padx=8, pady=(8, 0))

        self.text = tk.Text(self.story_frame, wrap="word", bg="#1a0f2e", fg="#ede4ff",
                            font=("Georgia", 11), relief="flat", padx=10, pady=10)
        self.text.grid(row=1, column=0, sticky="nsew", padx=8, pady=8)

        self.choices = tk.Frame(self.story_frame, bg="#12081c")
        self.choices.grid(row=2, column=0, sticky="ew", padx=8, pady=(0, 8))

        utils = tk.Frame(self.story_frame, bg="#12081c")
        utils.grid(row=3, column=0, sticky="ew", padx=8, pady=(0, 8))
        tk.Button(utils, text="Hide Image", command=self.toggle_art,
                  bg="#7c3aed", fg="#faf5ff", relief="flat").pack(side="left", padx=2)
        self.btn_back = tk.Button(utils, text="Back", command=self.rollback,
                  bg="#7c3aed", fg="#faf5ff", relief="flat")
        self.btn_back.pack(side="left", padx=2)
        self.skip_mode = False
        self.btn_skip = tk.Button(utils, text="Skip read", command=self.toggle_skip,
                  bg="#7c3aed", fg="#faf5ff", relief="flat")
        self.btn_skip.pack(side="left", padx=2)
        tk.Button(utils, text="Restart", command=self.restart,
                  bg="#7c3aed", fg="#faf5ff", relief="flat").pack(side="left", padx=2)

        self.settings_frame = tk.Frame(right, bg="#12081c")
        tk.Label(self.settings_frame, text="Illustrated text-based RPG",
                 bg="#12081c", fg="#a78bba", font=("Georgia", 10)).pack(padx=12, pady=12, anchor="w")
        tk.Button(self.settings_frame, text="Abilities", command=self.show_abilities,
                  bg="#3b0764", fg="#f3e8ff", relief="flat").pack(padx=12, pady=4, anchor="w")
        tk.Label(self.settings_frame, text="Save slots (disk)",
                 bg="#12081c", fg="#e9d5ff", font=("Georgia", 10, "bold")).pack(padx=12, pady=(12, 4), anchor="w")
        self.slots_frame = tk.Frame(self.settings_frame, bg="#12081c")
        self.slots_frame.pack(fill="x", padx=8, pady=4)
        self.refresh_slots_ui()

        name = simpledialog.askstring("Traveler", "What is your name?", parent=self) or "Traveler"
        self.runtime.state["playerName"] = name
        self.refresh()

    def show_tab(self, name: str):
        if name == "story":
            self.settings_frame.grid_forget()
            self.story_frame.grid(row=1, column=0, sticky="nsew")
        else:
            self.story_frame.grid_forget()
            self.settings_frame.grid(row=1, column=0, sticky="nsew")
            self.refresh_slots_ui()

    def refresh_slots_ui(self):
        for child in self.slots_frame.winfo_children():
            child.destroy()
        for info in self.runtime.list_save_slots():
            row = tk.Frame(self.slots_frame, bg="#1a0f2e")
            row.pack(fill="x", pady=2)
            slot = info["slot"]
            empty = info.get("empty")
            corrupt = info.get("corrupt")
            if empty:
                summary = "Empty"
            elif corrupt:
                summary = "Corrupt"
            else:
                title = info.get("label") or f"Slot {slot}"
                summary = f"{title} — {info.get('playerName') or '—'} · {info.get('currentScene') or '?'}"
            tk.Label(row, text=f"Slot {slot}: {summary}", bg="#1a0f2e", fg="#f3e8ff",
                     font=("Georgia", 9), anchor="w").pack(side="left", padx=6, pady=4, fill="x", expand=True)
            tk.Button(row, text="Save", command=lambda s=slot: self.save_slot(s),
                      bg="#7c3aed", fg="#faf5ff", relief="flat").pack(side="right", padx=2, pady=2)
            tk.Button(row, text="Load", command=lambda s=slot: self.load_slot(s),
                      bg="#3b0764", fg="#f3e8ff", relief="flat",
                      state=("disabled" if empty or corrupt else "normal")).pack(side="right", padx=2, pady=2)
            tk.Button(row, text="Rename", command=lambda s=slot: self.rename_slot(s),
                      bg="#3b0764", fg="#f3e8ff", relief="flat",
                      state=("disabled" if empty or corrupt else "normal")).pack(side="right", padx=2, pady=2)
            tk.Button(row, text="Export", command=lambda s=slot: self.export_slot(s),
                      bg="#3b0764", fg="#f3e8ff", relief="flat",
                      state=("disabled" if empty or corrupt else "normal")).pack(side="right", padx=2, pady=2)
            tk.Button(row, text="Import", command=lambda s=slot: self.import_slot(s),
                      bg="#3b0764", fg="#f3e8ff", relief="flat").pack(side="right", padx=2, pady=2)
            tk.Button(row, text="Clear", command=lambda s=slot: self.clear_slot(s),
                      bg="#4c1d4a", fg="#f3e8ff", relief="flat",
                      state=("disabled" if empty else "normal")).pack(side="right", padx=2, pady=2)

    def save_slot(self, slot: int):
        try:
            suggested = f"{self.runtime.state.get('playerName') or ''} — {self.runtime.state.get('currentScene') or ''}".strip(" —")
            label = simpledialog.askstring("Save", f"Label for slot {slot}:",
                                           initialvalue=suggested or f"Slot {slot}", parent=self)
            if label is None:
                return
            self.runtime.save_to_slot(slot, label=label.strip() or f"Slot {slot}")
            messagebox.showinfo("Saved", f"Wrote slot {slot}", parent=self)
            self.refresh_slots_ui()
        except Exception as err:
            messagebox.showerror("Save failed", str(err), parent=self)

    def rename_slot(self, slot: int):
        try:
            save = self.runtime.read_save_slot(slot)
            if not save:
                messagebox.showinfo("Rename", "That slot is empty", parent=self)
                return
            label = simpledialog.askstring("Rename", f"Rename slot {slot}:",
                                           initialvalue=save.get("label") or f"Slot {slot}", parent=self)
            if label is None:
                return
            self.runtime.import_save_slot(slot, {**save, "label": label.strip() or f"Slot {slot}"})
            self.refresh_slots_ui()
        except Exception as err:
            messagebox.showerror("Rename failed", str(err), parent=self)

    def export_slot(self, slot: int):
        try:
            save = self.runtime.read_save_slot(slot)
            if not save:
                messagebox.showinfo("Export", "That slot is empty", parent=self)
                return
            dest = filedialog.asksaveasfilename(
                parent=self, title=f"Export slot {slot}",
                defaultextension=".json", initialfile=f"slot-{slot}.json",
                filetypes=[("Save JSON", "*.json")])
            if not dest:
                return
            Path(dest).write_text(json.dumps(save, indent=2), encoding="utf-8")
            messagebox.showinfo("Exported", f"Wrote {dest}", parent=self)
        except Exception as err:
            messagebox.showerror("Export failed", str(err), parent=self)

    def import_slot(self, slot: int):
        try:
            src = filedialog.askopenfilename(
                parent=self, title=f"Import into slot {slot}",
                filetypes=[("Save JSON", "*.json"), ("All files", "*.*")])
            if not src:
                return
            data = json.loads(Path(src).read_text(encoding="utf-8"))
            self.runtime.import_save_slot(slot, data)
            messagebox.showinfo("Imported", f"Imported into slot {slot}", parent=self)
            self.refresh_slots_ui()
        except Exception as err:
            messagebox.showerror("Import failed", str(err), parent=self)

    def load_slot(self, slot: int):
        try:
            self.runtime.load_from_slot(slot)
            self.refresh()
            self.refresh_slots_ui()
            messagebox.showinfo("Loaded", f"Loaded slot {slot}", parent=self)
        except Exception as err:
            messagebox.showerror("Load failed", str(err), parent=self)

    def clear_slot(self, slot: int):
        if not messagebox.askyesno("Clear slot", f"Clear save slot {slot}?", parent=self):
            return
        try:
            self.runtime.clear_save_slot(slot)
            self.refresh_slots_ui()
        except Exception as err:
            messagebox.showerror("Clear failed", str(err), parent=self)

    def toggle_art(self):
        self.art_hidden = not self.art_hidden
        if self.art_hidden:
            self.art.grid_remove()
            self.columnconfigure(0, weight=0)
            self.columnconfigure(1, weight=1)
        else:
            self.art.grid()
            self.columnconfigure(0, weight=3)
            self.columnconfigure(1, weight=2)

    def rollback(self):
        try:
            self.runtime.rollback()
            self.refresh()
        except Exception as err:
            messagebox.showinfo("Back", str(err), parent=self)

    def toggle_skip(self):
        self.skip_mode = not self.skip_mode
        self.btn_skip.configure(text="Skip read ✓" if self.skip_mode else "Skip read")
        if self.skip_mode:
            self._run_skip()

    def _run_skip(self):
        hops = 0
        while self.skip_mode:
            nxt = self.runtime.skip_if_read()
            if nxt is None:
                if hops == 0:
                    messagebox.showinfo("Skip read", "Stopped — unread scene or branching choice.", parent=self)
                self.skip_mode = False
                self.btn_skip.configure(text="Skip read")
                break
            hops += 1
            if hops > 200:
                self.skip_mode = False
                self.btn_skip.configure(text="Skip read")
                break
        self.refresh()

    def restart(self):
        self.runtime.state["abilities"] = []
        self.runtime.state["history"] = []
        self.runtime.state["vars"] = {}
        self.runtime.show(self.runtime.project["start"])
        self.refresh()

    def show_abilities(self):
        abs_ = self.runtime.state["abilities"] or ["(none yet)"]
        messagebox.showinfo("Abilities", "\\n".join(abs_), parent=self)

    def choose(self, index: int):
        self.runtime.choose(index)
        self.refresh()
        if self.skip_mode:
            self._run_skip()

    def refresh(self):
        scene = self.runtime.scenes[self.runtime.state["currentScene"]]
        speaker = scene.get("speaker") or ""
        self.speaker.configure(text=self.runtime.interpolate(speaker) if speaker else " ")
        self.text.delete("1.0", "end")
        self.text.insert("1.0", self.runtime.interpolate(scene.get("text", "")))
        state = "normal" if self.runtime.can_rollback() else "disabled"
        self.btn_back.configure(state=state)
        for child in self.choices.winfo_children():
            child.destroy()
        visible = self.runtime.visible_choices()
        if not visible:
            tk.Label(self.choices, text="The story path ends here for now.",
                     bg="#12081c", fg="#a78bba").grid(row=0, column=0, sticky="w")
            return
        for i, choice in enumerate(visible):
            r, c = divmod(i, 2)
            tk.Button(
                self.choices,
                text=choice["text"],
                command=lambda idx=i: self.choose(idx),
                bg="#7c3aed",
                fg="#faf5ff",
                relief="flat",
                wraplength=180,
                justify="center",
            ).grid(row=r, column=c, sticky="ew", padx=3, pady=3)
            self.choices.columnconfigure(c, weight=1)


def main():
    import sys
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        root = Path(sys._MEIPASS)
    else:
        root = Path(__file__).resolve().parent
    project = root / "project"
    if not project.is_dir():
        messagebox.showerror("Missing project", f"Could not find project folder at:\\n{project}")
        return
    IllustratedIfApp(project).mainloop()


if __name__ == "__main__":
    main()
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

  copyDir(path.join(studioRoot, "engine-python", "if_engine"), path.join(staging, "if_engine"));
  copyDir(projectDir, path.join(staging, "project"));
  fs.writeFileSync(path.join(staging, "app.py"), TK_APP);
  fs.writeFileSync(
    path.join(staging, "requirements.txt"),
    `# Illustrated IF Python package — stdlib only for the desktop UI (tkinter).
# Optional later: pygame
`
  );
  fs.writeFileSync(
    path.join(staging, "README.md"),
    `# ${project.title}

Python source package for an **illustrated text-based RPG**.

## Windows — first time

1. Double-click \`SETUP-ADMIN.bat\` (UAC elevation) — installs **Python 3.12** via winget if missing (includes tkinter).
2. Double-click \`PLAY.bat\` to launch the desktop app.

## Run (desktop UI)

\`\`\`bash
python app.py
\`\`\`

## Run (headless / terminal)

\`\`\`bash
python -m if_engine project
\`\`\`

## Project data

Story JSON + assets live in \`project/\`. Edit those files or re-export from Illustrated IF Studio.

## Build a standalone exe (Windows)

1. Run \`SETUP-ADMIN.bat\` once if Python is missing.
2. Double-click \`BUILD-EXE.bat\` — installs PyInstaller and produces \`dist-exe\\<id>.exe\`.

Or manually:

\`\`\`bash
pip install pyinstaller
pyinstaller --onefile --windowed --add-data "project;project" --add-data "if_engine;if_engine" app.py
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
