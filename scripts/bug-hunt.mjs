#!/usr/bin/env node
/**
 * Ad-hoc bug hunt against a running Illustrated IF Studio server.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findings = [];

function find(sev, msg, detail = "") {
  findings.push({ sev, msg, detail });
  const tag = sev.toUpperCase();
  console.log(`[${tag}] ${msg}${detail ? " — " + detail : ""}`);
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

async function main() {
  console.log("Bug hunt against", base);

  // Health
  {
    const { res, body } = await json(`${base}/api/health`);
    if (!res.ok || !body.ok) find("error", "Health endpoint failed");
    else if (body.name !== "illustrated-if-studio") find("warn", "Unexpected health name", String(body.name));
  }

  // Project load + theme shape
  let project, theme, scenes;
  {
    const { res, body } = await json(`${base}/api/project`);
    if (!res.ok) find("error", "/api/project failed");
    else {
      project = body.project;
      theme = body.theme;
      scenes = body.scenes.scenes || body.scenes;
      if (!theme?.templates?.scene) find("error", "Theme missing templates.scene");
      if (!theme?.templates?.menu) find("error", "Theme missing templates.menu");
      if (!theme?.colors?.accent) find("error", "Theme missing colors");
      if (JSON.stringify(theme).includes("VN Studio")) find("error", "Theme still mentions VN Studio");
      const n = Object.keys(scenes).length;
      if (n < 50) find("warn", "Unexpectedly few scenes", String(n));
      if (!scenes[project.start]) find("error", "Start scene missing", project.start);
    }
  }

  // Broken next links
  {
    let broken = 0;
    for (const [id, sc] of Object.entries(scenes || {})) {
      for (const c of sc.choices || []) {
        if (c.next && !scenes[c.next]) {
          broken++;
          if (broken <= 5) find("error", "Broken choice link", `${id} → ${c.next}`);
        }
      }
    }
    if (broken > 5) find("error", `…and ${broken - 5} more broken links`);
  }

  // Theme roundtrip
  {
    const before = structuredClone(theme);
    const patched = structuredClone(theme);
    patched.templates.scene.artPosition = patched.templates.scene.artPosition === "left" ? "right" : "left";
    const { res, body } = await json(`${base}/api/theme`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: patched }),
    });
    if (!res.ok) find("error", "Theme PUT failed", JSON.stringify(body));
    else {
      const reload = await json(`${base}/api/project`);
      if (reload.body.theme.templates.scene.artPosition !== patched.templates.scene.artPosition) {
        find("error", "Theme change did not persist");
      }
      // restore
      await json(`${base}/api/theme`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: before }),
      });
    }
  }

  // Validate API
  {
    const { res, body } = await json(`${base}/api/validate`, { method: "POST" });
    if (!res.ok) find("error", "Validate API HTTP fail");
    else if (!body.ok) find("error", "Validate reported errors", (body.errors || []).slice(0, 3).join("; "));
  }

  // Static assets for editor design CSS override of [hidden]
  {
    const css = await (await fetch(`${base}/editor-web/css/editor.css`)).text();
    if (!/\.design-workspace\[hidden\]/.test(css) && !/\.workspace\[hidden\]/.test(css)) {
      find("error", "Editor CSS missing [hidden] override for design workspace");
    }
    if (!/mode-switch/.test(css)) find("warn", "mode-switch styles missing");
  }

  // Player pages
  {
    const html = await (await fetch(`${base}/engine-html/`)).text();
    if (/VN Studio/i.test(html)) find("error", "Player HTML still says VN Studio");
    const js = await (await fetch(`${base}/engine-html/js/main.js`)).text();
    if (/vn-studio\/scripts\/serve/.test(js)) find("warn", "Player boot error still points at old serve path");
  }

  // Editor JS: XSS via choice.innerHTML
  {
    const eng = await (await fetch(`${base}/engine-html/js/engine.js`)).text();
    if (/btn\.innerHTML\s*=\s*`\$\{hot\}\$\{choice\.text\}`/.test(eng) || /innerHTML = `\$\{hot\}\$\{choice\.text\}`/.test(eng)) {
      find("warn", "Choice labels use innerHTML — story text with < > can break the UI / inject markup");
    }
  }

  // Export html + verify package
  {
    const { res, body } = await json(`${base}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "python" }),
    });
    if (!res.ok || !body.ok) find("error", "Python export failed", body.output || body.error);
    else {
      const folder = body.folder;
      if (!fs.existsSync(path.join(folder, "if_engine", "runtime.py"))) {
        find("error", "Python export missing if_engine/");
      }
      if (fs.existsSync(path.join(folder, "vn_engine"))) {
        find("error", "Python export still contains vn_engine/");
      }
      const app = fs.readFileSync(path.join(folder, "app.py"), "utf8");
      if (/vn_engine/.test(app)) find("error", "Exported app.py still imports vn_engine");
      if (!/from if_engine/.test(app)) find("error", "Exported app.py missing if_engine import");
    }
  }

  // Export all quickly via CLI for cpp include path
  {
    const { res, body } = await json(`${base}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "cpp" }),
    });
    if (!res.ok || !body.ok) find("error", "C++ export failed");
    else {
      const folder = body.folder;
      if (!fs.existsSync(path.join(folder, "include", "if", "conditions.hpp")) &&
          !fs.existsSync(path.join(folder, "include", "conditions.hpp"))) {
        find("warn", "C++ package missing include stub copy (ok if only root headers)");
      }
      if (fs.existsSync(path.join(folder, "include", "vn"))) {
        find("error", "C++ export still has include/vn/");
      }
    }
  }

  // HTML export config path
  {
    const { res, body } = await json(`${base}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "html" }),
    });
    if (!res.ok || !body.ok) find("error", "HTML export failed");
    else {
      const cfg = fs.readFileSync(path.join(body.folder, "js", "config.js"), "utf8");
      if (!cfg.includes("../project/")) find("error", "HTML export config.js not rewritten");
      for (const f of [
        "Play the Game.vbs",
        "play-quiet.ps1",
        "PLAY.bat",
        path.join("_emergency", "SETUP-ADMIN.bat"),
        path.join("_emergency", "SETUP-ADMIN.ps1"),
        path.join("_emergency", "_common.ps1"),
      ]) {
        if (!fs.existsSync(path.join(body.folder, f))) find("error", `HTML export missing ${f}`);
      }
    }
  }

  // Packaged HTML smoke: boot + first choice via playwright-less fetch of scenes
  {
    const { body } = await json(`${base}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "html" }),
    });
    if (body?.folder) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(body.folder, "start-server.mjs")], {
          cwd: body.folder,
          env: { ...process.env, PORT: "18082" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let ready = false;
        const on = (buf) => {
          if (!ready && String(buf).includes("Play at")) {
            ready = true;
            resolve(child);
          }
        };
        child.stdout.on("data", on);
        child.stderr.on("data", on);
        child.on("exit", (c) => {
          if (!ready) reject(new Error("server exit " + c));
        });
        setTimeout(() => {
          if (!ready) reject(new Error("timeout"));
        }, 8000);
      })
        .then(async (child) => {
          try {
            const page = await (await fetch("http://127.0.0.1:18082/")).text();
            if (!/game-title|illustrated-if/.test(page)) find("error", "Packaged player HTML unexpected");
            const pj = await (await fetch("http://127.0.0.1:18082/project/project.json")).json();
            const sc = await (await fetch(`http://127.0.0.1:18082/project/${pj.story.scenes}`)).json();
            const map = sc.scenes || sc;
            if (!map[pj.start]?.choices?.length) find("error", "Packaged start scene has no choices");
          } finally {
            child.kill();
          }
        })
        .catch((e) => find("error", "Packaged HTML server failed", String(e.message || e)));
    }
  }

  // Ability-gated path sanity (emmalee)
  {
    const startChoices = (scenes.start?.choices || []).map((c) => c.next);
    if (!startChoices.includes("temple") && !startChoices.length) find("error", "Start has no exits");
  }

  // Editor static
  {
    const ed = await (await fetch(`${base}/editor-web/`)).text();
    if (!/id="mode-design"/.test(ed)) find("error", "Editor missing Design top tab");
    if (!/id="workspace-design"/.test(ed)) find("error", "Editor missing design workspace root");
    if (/VN Studio/.test(ed)) find("error", "Editor HTML says VN Studio");
  }

  // Source: run-checks python path (cwd engine-python)
  {
    const checks = fs.readFileSync(path.join(root, "scripts", "run-checks.mjs"), "utf8");
    if (!checks.includes("if_engine")) find("error", "run-checks still references vn_engine module name incorrectly");
  }

  console.log("\n—— Summary ——");
  const errors = findings.filter((f) => f.sev === "error");
  const warns = findings.filter((f) => f.sev === "warn");
  console.log(`Errors: ${errors.length}  Warnings: ${warns.length}`);
  if (!findings.length) console.log("No issues found by this probe.");
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
