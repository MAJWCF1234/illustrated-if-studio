/**
 * High-level Illustrated IF Studio CLI — runs against studio APIs (no shell).
 */

const HELP = `Illustrated IF Studio CLI — high-level commands

  help                         Show this help
  clear                        Clear the terminal
  status                       Studio + active project health
  projects | ls                List projects in /projects
  new [--id name] [--title T]  Create a starter project and open it
  use <id>                     Switch active project and reload editor
  dest [path]                  Get or set export destination folder (HTML/Python/C++/raw)
  validate                     Validate the active project
  save                         Save unsaved scene edits (if any)
  scenes                       Scene count + start id
  scene <id>                   Peek a scene (text / choices)
  export <html|python|cpp|raw|all> [--dest path]
                               Build packages (raw uses dest)
  import folder <path> [--id name] [--overwrite]
  import html <path> [--id name] [--title "Title"] [--overwrite]
                               Bring a project into /projects
  play                         Open player in a new tab
  preview [sceneId]            Open preview (optional start scene)
  npm                          Show equivalent npm / node CLI lines

Tips: Click chips for shortcuts · ↑/↓ command history · quotes for paths with spaces
`;

function tokenize(line) {
  const tokens = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) {
    tokens.push((m[1] ?? m[2] ?? m[3]).replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const val = args[i + 1];
  args.splice(i, val != null && !String(val).startsWith("--") ? 2 : 1);
  return val != null && !String(val).startsWith("--") ? val : true;
}

/**
 * Grab a flag whose value may contain spaces (e.g. Windows paths without quotes).
 * Captures every token after the flag up to the next --flag, mutating args.
 */
function takeGreedyFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  let end = i + 1;
  while (end < args.length && !String(args[end]).startsWith("--")) end += 1;
  const val = args.slice(i + 1, end).join(" ").trim();
  args.splice(i, end - i);
  return val || true;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function fmtList(items, mapFn) {
  if (!items?.length) return "(none)";
  return items.map(mapFn).join("\n");
}

/**
 * @param {object} ctx
 * @param {string} line
 * @returns {Promise<{ text: string, ok?: boolean, action?: string, payload?: any }>}
 */
export async function runCliCommand(line, ctx) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return { text: "", ok: true };

  const tokens = tokenize(trimmed);
  const cmd = (tokens.shift() || "").toLowerCase();
  const args = tokens;

  switch (cmd) {
    case "help":
    case "?":
      return { text: HELP, ok: true };

    case "clear":
    case "cls":
      return { text: "", ok: true, action: "clear" };

    case "status":
    case "health": {
      const [h, s] = await Promise.all([api("/api/health"), api("/api/settings")]);
      if (!h.ok) return { text: `health failed (${h.status})`, ok: false };
      const lines = [
        `studio     ${h.data.name || "illustrated-if-studio"}`,
        `project    ${h.data.activeProjectId}`,
        `path       ${h.data.projectDir}`,
        `exports    ${(h.data.exports || []).join(", ")}`,
        `export dest ${s.data?.resolvedExportDestination || "(default)"}`,
        s.data?.exportDestination ? `saved dest ${s.data.exportDestination}` : null,
      ].filter(Boolean);
      return { text: lines.join("\n"), ok: true };
    }

    case "projects":
    case "ls":
    case "list": {
      const { ok, data } = await api("/api/projects");
      if (!ok) return { text: data?.error || "failed", ok: false };
      const body = fmtList(data.projects, (p) => {
        const mark = p.id === data.activeProjectId ? "*" : " ";
        return `${mark} ${p.id.padEnd(22)} ${p.title || ""}${p.author ? ` — ${p.author}` : ""}`;
      });
      return { text: `Projects (* = active)\n${body}`, ok: true };
    }

    case "use":
    case "open":
    case "switch": {
      const id = args[0];
      if (!id) return { text: "usage: use <project-id>", ok: false };
      const { ok, data } = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ activeProjectId: id }),
      });
      if (!ok) return { text: data?.error || "switch failed", ok: false };
      return {
        text: `Active → ${data.settings?.activeProjectId || id}\n${data.settings?.projectDir || ""}`,
        ok: true,
        action: "reload",
      };
    }

    case "dest":
    case "destination": {
      if (!args.length) {
        const { ok, data } = await api("/api/settings");
        if (!ok) return { text: "failed", ok: false };
        return {
          text: [
            `saved     ${data.exportDestination || "(empty)"}`,
            `resolved  ${data.resolvedExportDestination}`,
            `default   ${data.defaultExportDestination}`,
          ].join("\n"),
          ok: true,
        };
      }
      const path = args.join(" ").trim();
      const { ok, data } = await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ exportDestination: path === "-" || path === "clear" ? "" : path }),
      });
      if (!ok) return { text: data?.error || "failed", ok: false };
      return {
        text: `Destination set → ${data.settings?.resolvedExportDestination || path}`,
        ok: true,
      };
    }

    case "validate": {
      if (ctx.saveFirst) await ctx.saveFirst();
      const { ok, data } = await api("/api/validate", { method: "POST" });
      return { text: data?.output || data?.error || JSON.stringify(data, null, 2), ok: data?.ok !== false && ok };
    }

    case "save": {
      if (!ctx.saveFirst) return { text: "save unavailable", ok: false };
      const saved = await ctx.saveFirst();
      return { text: saved ? "Saved." : "Save failed or nothing to write.", ok: Boolean(saved) };
    }

    case "scenes": {
      const { ok, data } = await api("/api/project");
      if (!ok) return { text: data?.error || "failed", ok: false };
      const ids = Object.keys(data.scenes?.scenes || data.scenes || {});
      const start = data.scenes?.start || data.project?.story?.start || "?";
      return {
        text: `${ids.length} scenes · start=${start}\n${ids.slice(0, 40).join(", ")}${ids.length > 40 ? "…" : ""}`,
        ok: true,
      };
    }

    case "scene": {
      const id = args[0];
      if (!id) return { text: "usage: scene <id>", ok: false };
      const { ok, data } = await api("/api/project");
      if (!ok) return { text: data?.error || "failed", ok: false };
      const scene = (data.scenes?.scenes || data.scenes || {})[id];
      if (!scene) return { text: `No scene "${id}"`, ok: false };
      const choices = (scene.choices || []).map((c, i) => `  ${i + 1}. ${c.text} → ${c.next}`).join("\n");
      return {
        text: [
          `# ${id}`,
          `speaker: ${scene.speaker ?? "(none)"}`,
          `image:   ${scene.sceneImage || "(none)"}`,
          "",
          String(scene.text || "").slice(0, 600),
          choices ? `\nchoices:\n${choices}` : "\n(no choices)",
        ].join("\n"),
        ok: true,
      };
    }

    case "export": {
      if (ctx.saveFirst) await ctx.saveFirst();
      const dest = takeGreedyFlag(args, "--dest");
      const target = (args[0] || "").toLowerCase();
      if (!["html", "python", "cpp", "raw", "all"].includes(target)) {
        return { text: "usage: export <html|python|cpp|raw|all> [--dest path]", ok: false };
      }
      const endpoint = target === "all" ? "/api/export-all" : "/api/export";
      const body =
        target === "all"
          ? {}
          : {
              target,
              ...(target === "raw" && dest
                ? { destination: dest, saveDestination: true }
                : dest
                  ? { destination: dest }
                  : {}),
            };
      const { ok, data } = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      let text = data?.output || data?.error || "";
      if (data?.downloadUrl) text += `\nDownload: ${location.origin}${data.downloadUrl}`;
      if (data?.folder) text += `\nFolder: ${data.folder}`;
      if (data?.results) {
        text =
          data.output ||
          data.results.map((r) => `[${r.target}] ${r.ok ? "OK" : "FAIL"} ${r.folder || r.downloadUrl || ""}`).join("\n");
      }
      return { text, ok: Boolean(ok && data?.ok !== false) };
    }

    case "new":
    case "create": {
      const idFlag = takeGreedyFlag(args, "--id");
      const titleFlag = takeGreedyFlag(args, "--title");
      const authorFlag = takeGreedyFlag(args, "--author");
      const overwrite = args.includes("--overwrite");
      if (overwrite) {
        const i = args.indexOf("--overwrite");
        if (i >= 0) args.splice(i, 1);
      }
      const title = titleFlag || args.join(" ").trim();
      if (!title && !idFlag) return { text: "usage: new [--id name] [--title Title] [--author Name]", ok: false };
      const { ok, data, status } = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          title: title || idFlag,
          projectId: idFlag || undefined,
          author: authorFlag || undefined,
          activate: true,
          overwrite: Boolean(overwrite),
        }),
      });
      if (data?.needsOverwrite || status === 409) {
        return {
          text: `${(data?.errors || []).join("\n")}\nRe-run with --overwrite to replace it.`,
          ok: false,
        };
      }
      return {
        text: data?.output || data?.error || "",
        ok: Boolean(ok && data?.ok !== false),
        action: ok && data?.ok !== false ? "reload" : undefined,
      };
    }

    case "import": {
      const kind = (args.shift() || "").toLowerCase();
      if (kind !== "folder" && kind !== "html") {
        return { text: "usage: import folder <path> [--id name] [--overwrite]\n       import html <path> [--id name] [--title Title] [--overwrite]", ok: false };
      }
      const idFlag = takeGreedyFlag(args, "--id");
      const titleFlag = takeGreedyFlag(args, "--title");
      const overwrite = args.includes("--overwrite");
      if (overwrite) {
        const i = args.indexOf("--overwrite");
        if (i >= 0) args.splice(i, 1);
      }
      const sourcePath = args.join(" ").trim().replace(/^["']|["']$/g, "");
      if (!sourcePath) return { text: "path required", ok: false };
      const { ok, data, status } = await api("/api/import", {
        method: "POST",
        body: JSON.stringify({
          kind,
          sourcePath,
          projectId: idFlag || undefined,
          title: titleFlag || undefined,
          activate: true,
          overwrite: Boolean(overwrite),
        }),
      });
      if (data?.needsOverwrite || status === 409) {
        return {
          text: `${(data?.errors || []).join("\n") || "Project already exists."}\nRe-run with --overwrite to replace it.`,
          ok: false,
        };
      }
      return {
        text: data?.output || (data?.errors || []).join("\n") || data?.error || "",
        ok: Boolean(ok && data?.ok !== false),
        action: ok && data?.ok !== false ? "reload" : undefined,
      };
    }

    case "play":
      window.open("/engine-html/", "_blank", "noopener");
      return { text: "Opened player → /engine-html/", ok: true };

    case "preview": {
      const scene = args[0] || ctx.startId || "start";
      if (ctx.openPreview) await ctx.openPreview(scene);
      else {
        const params = new URLSearchParams({ preview: "1", name: "Author", scene, t: String(Date.now()) });
        window.open(`/engine-html/?${params}`, "_blank", "noopener");
      }
      return { text: `Preview → scene ${scene}`, ok: true };
    }

    case "npm":
    case "shell":
      return {
        text: [
          "Host shell equivalents (run in studio folder):",
          "  npm start",
          "  npm run playtest",
          "  npm run export:html | export:python | export:cpp | export:raw | export:all",
          "  node server/cli.mjs export raw [projectDir]",
          "",
          "This CLI tab talks to the running studio API — no Node spawn from the browser.",
        ].join("\n"),
        ok: true,
      };

    default:
      return {
        text: `Unknown command: ${cmd}\nType help for the command list.`,
        ok: false,
      };
  }
}

export const CLI_CHIPS = [
  "help",
  "status",
  "projects",
  "new --title Demo",
  "validate",
  "export raw",
  "export all",
  "dest",
  "scenes",
  "play",
  "npm",
];

export { HELP };
