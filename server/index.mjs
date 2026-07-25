import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listImageFiles, readJson, writeJson, ensureDir } from "./lib/fs-utils.mjs";
import { validateProject } from "./lib/validate.mjs";
import { mergeTheme } from "./lib/theme-defaults.mjs";
import { loadSettings, saveSettings, resolveExportDestination, listProjects } from "./lib/settings.mjs";
import { exportHtml } from "./exporters/html.mjs";
import { exportPython } from "./exporters/python.mjs";
import { exportCpp } from "./exporters/cpp.mjs";
import { exportRawProject, importProjectFolder } from "./exporters/raw.mjs";
import { importLegacyHtml } from "./lib/import-legacy.mjs";
import { createProject } from "./lib/create-project.mjs";
import { listSaveSlots, readSaveSlot, writeSaveSlot, deleteSaveSlot } from "./lib/saves.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT) || 8787;
const outRoot = path.join(studioRoot, "dist");
const envProject = process.env.IF_PROJECT
  ? path.resolve(process.env.IF_PROJECT)
  : process.env.VN_PROJECT
    ? path.resolve(process.env.VN_PROJECT)
    : null;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function getActiveProjectId() {
  if (envProject) return path.basename(envProject);
  const s = loadSettings(studioRoot);
  return s.activeProjectId || "sample-project";
}

function getProjectDir() {
  if (envProject) return envProject;
  return path.join(studioRoot, "projects", getActiveProjectId());
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeProjectPath(rel) {
  const projectDir = path.resolve(getProjectDir());
  const full = path.resolve(projectDir, rel);
  const rootWithSep = projectDir.endsWith(path.sep) ? projectDir : projectDir + path.sep;
  if (full !== projectDir && !full.startsWith(rootWithSep)) {
    throw new Error("Path escapes project");
  }
  return full;
}

function isInsideRoot(absPath, root) {
  const resolved = path.resolve(absPath);
  const resolvedRoot = path.resolve(root);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  return resolved === resolvedRoot || resolved.startsWith(rootWithSep);
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw || !String(raw).trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Invalid JSON body: ${err.message}`);
    e.status = 400;
    throw e;
  }
}

function publicPath(abs) {
  return path.relative(studioRoot, abs).split(path.sep).join("/");
}

function runExport(target, opts = {}) {
  const projectDir = getProjectDir();
  const args = { studioRoot, projectDir, outRoot };
  if (target === "html") return exportHtml(args);
  if (target === "python") return exportPython(args);
  if (target === "cpp") return exportCpp(args);
  if (target === "raw") {
    const destination = resolveExportDestination(studioRoot, opts.destination);
    return exportRawProject({
      projectDir,
      destination,
      folderName: opts.folderName,
    });
  }
  throw new Error(`Unknown export target: ${target}`);
}

function formatExportResult(result) {
  if (!result.ok) {
    return {
      ...result,
      output: ["Export failed:", ...(result.errors || [])].join("\n"),
    };
  }
  const lines = [
    `Exported ${result.target} (${result.sceneCount ?? "?"} scenes)`,
    `Folder: ${result.folder}`,
  ];
  if (result.zip) lines.push(`Zip:    ${result.zip}`);
  if (result.warnings?.length) {
    lines.push("", "Warnings:");
    for (const w of result.warnings.slice(0, 40)) lines.push(`- ${w}`);
    if (result.warnings.length > 40) lines.push(`… +${result.warnings.length - 40} more`);
  }
  if (result.notes?.length) {
    lines.push("", "Notes:");
    for (const n of result.notes) lines.push(`- ${n}`);
  }
  const out = {
    ...result,
    folderRel: result.folder ? publicPath(result.folder) : null,
    output: lines.join("\n"),
  };
  if (result.zip) {
    out.zipRel = publicPath(result.zip);
    out.downloadUrl = `/api/download?file=${encodeURIComponent(path.basename(result.zip))}`;
  }
  return out;
}

async function handleApi(req, res, urlPath, searchParams) {
  const projectDir = getProjectDir();

  if (req.method === "GET" && urlPath === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      name: "illustrated-if-studio",
      projectDir,
      activeProjectId: getActiveProjectId(),
      exports: ["html", "python", "cpp", "raw"],
    });
  }

  if (req.method === "GET" && urlPath === "/api/settings") {
    const settings = loadSettings(studioRoot);
    return sendJson(res, 200, {
      ...settings,
      activeProjectId: getActiveProjectId(),
      projectDir,
      projectUrl: `/projects/${getActiveProjectId()}/`,
      defaultExportDestination: path.join(studioRoot, "dist", "raw-projects"),
      resolvedExportDestination: resolveExportDestination(studioRoot),
      envProjectLocked: Boolean(envProject),
    });
  }

  if (req.method === "PUT" && urlPath === "/api/settings") {
    const body = await readJsonBody(req);
    const patch = {};
    if ("exportDestination" in body) patch.exportDestination = String(body.exportDestination || "").trim();
    if ("lastImportPath" in body) patch.lastImportPath = String(body.lastImportPath || "").trim();
    if ("activeProjectId" in body && !envProject) {
      const id = String(body.activeProjectId || "").trim();
      const dir = path.join(studioRoot, "projects", id);
      if (!fs.existsSync(path.join(dir, "project.json"))) {
        return sendJson(res, 400, { error: `Unknown project: ${id}` });
      }
      patch.activeProjectId = id;
      const settings = loadSettings(studioRoot);
      patch.recentProjects = [id, ...(settings.recentProjects || []).filter((x) => x !== id)].slice(0, 12);
    }
    const settings = saveSettings(studioRoot, patch);
    return sendJson(res, 200, {
      ok: true,
      settings: {
        ...settings,
        activeProjectId: getActiveProjectId(),
        projectDir: getProjectDir(),
        resolvedExportDestination: resolveExportDestination(studioRoot),
      },
    });
  }

  if (req.method === "GET" && urlPath === "/api/projects") {
    const settings = loadSettings(studioRoot);
    return sendJson(res, 200, {
      projects: listProjects(studioRoot),
      activeProjectId: getActiveProjectId(),
      recentProjects: settings.recentProjects || [],
    });
  }

  if (req.method === "GET" && urlPath === "/api/assets") {
    return sendJson(res, 200, {
      sceneImages: listImageFiles(safeProjectPath("assets/scene_images")),
      characters: listImageFiles(safeProjectPath("assets/characters")),
    });
  }

  if (req.method === "POST" && urlPath === "/api/assets/upload") {
    const body = await readJsonBody(req);
    const folder = body.folder === "characters" ? "characters" : "scene_images";
    let filename = path.basename(String(body.filename || "").trim());
    if (!filename || !/\.(png|jpe?g|webp|gif|svg)$/i.test(filename)) {
      return sendJson(res, 400, { error: "filename must be an image (png/jpg/webp/gif/svg)" });
    }
    filename = filename.replace(/[^\w.\-]+/g, "_");
    const dataUrl = String(body.dataBase64 || body.dataUrl || "");
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s) || (body.dataBase64 ? [null, null, body.dataBase64] : null);
    if (!m || !m[2]) return sendJson(res, 400, { error: "dataBase64 / dataUrl required" });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 12 * 1024 * 1024) return sendJson(res, 400, { error: "File too large (max 12MB)" });
    const dir = safeProjectPath(`assets/${folder}`);
    ensureDir(dir);
    const outPath = path.join(dir, filename);
    fs.writeFileSync(outPath, buf);
    return sendJson(res, 200, {
      ok: true,
      folder,
      filename,
      path: outPath,
      url: `/projects/${getActiveProjectId()}/assets/${folder}/${encodeURIComponent(filename)}`,
      sceneImages: listImageFiles(safeProjectPath("assets/scene_images")),
      characters: listImageFiles(safeProjectPath("assets/characters")),
    });
  }

  if (req.method === "POST" && urlPath === "/api/projects") {
    if (envProject) return sendJson(res, 400, { error: "IF_PROJECT/VN_PROJECT lock — cannot create projects" });
    const body = await readJsonBody(req);
    const result = createProject({
      studioRoot,
      projectId: body.projectId || body.id,
      title: body.title,
      author: body.author,
      overwrite: Boolean(body.overwrite),
    });
    if (result.needsOverwrite) {
      return sendJson(res, 409, { ...result, ok: false, output: (result.errors || []).join("\n") });
    }
    if (result.ok && body.activate !== false) {
      const settings = loadSettings(studioRoot);
      const recent = [result.projectId, ...(settings.recentProjects || []).filter((x) => x !== result.projectId)].slice(0, 12);
      saveSettings(studioRoot, { activeProjectId: result.projectId, recentProjects: recent });
    }
    return sendJson(res, result.ok ? 200 : 400, {
      ...result,
      activeProjectId: getActiveProjectId(),
      output: result.ok
        ? `Created ${result.projectId} (${result.sceneCount} starter scenes)\n${result.projectDir}`
        : (result.errors || []).join("\n"),
    });
  }

  if (req.method === "GET" && urlPath === "/api/project") {
    const project = readJson(path.join(projectDir, "project.json"));
    const scenes = readJson(path.join(projectDir, project.story.scenes));
    let theme = {};
    try {
      theme = readJson(path.join(projectDir, project.theme || "theme/theme.json"));
    } catch {
      /* optional */
    }
    return sendJson(res, 200, {
      project,
      scenes,
      theme: mergeTheme(theme),
      projectPath: projectDir,
      activeProjectId: getActiveProjectId(),
    });
  }

  if (req.method === "PUT" && urlPath === "/api/theme") {
    const body = await readJsonBody(req);
    const theme = mergeTheme(body.theme || body);
    const project = readJson(path.join(projectDir, "project.json"));
    const themeRel = project.theme || "theme/theme.json";
    const outPath = safeProjectPath(themeRel);
    const bak = outPath + ".bak";
    if (fs.existsSync(outPath)) fs.copyFileSync(outPath, bak);
    writeJson(outPath, theme);
    return sendJson(res, 200, { ok: true, path: outPath, backup: bak, theme });
  }

  if (req.method === "PUT" && urlPath === "/api/scenes") {
    const body = await readJsonBody(req);
    if (!body.scenes || typeof body.scenes !== "object") {
      return sendJson(res, 400, { error: "Body must include scenes object" });
    }
    const project = readJson(path.join(projectDir, "project.json"));
    const outPath = safeProjectPath(project.story.scenes);
    const payload = {
      formatVersion: 1,
      start: body.start || project.start || "start",
      scenes: body.scenes,
    };
    const bak = outPath + ".bak";
    if (fs.existsSync(outPath)) fs.copyFileSync(outPath, bak);
    writeJson(outPath, payload);
    return sendJson(res, 200, {
      ok: true,
      path: outPath,
      backup: bak,
      count: Object.keys(body.scenes).length,
    });
  }

  if (req.method === "POST" && urlPath === "/api/validate") {
    const report = validateProject(projectDir);
    const lines = [];
    if (report.ok) lines.push(`OK — ${report.sceneCount} scenes`);
    else {
      lines.push("ERRORS:");
      for (const e of report.errors) lines.push(`- ${e}`);
    }
    if (report.warnings.length) {
      lines.push("", "WARNINGS:");
      for (const w of report.warnings) lines.push(`- ${w}`);
    }
    if (report.notes?.length) {
      lines.push("", "NOTES:");
      for (const n of report.notes) lines.push(`- ${n}`);
    }
    return sendJson(res, 200, {
      ok: report.ok,
      errors: report.errors,
      warnings: report.warnings,
      notes: report.notes || [],
      artOptional: report.artOptional === true,
      sceneCount: report.sceneCount,
      output: lines.join("\n"),
    });
  }

  if (req.method === "POST" && (urlPath === "/api/export" || urlPath === "/api/export-html")) {
    let target = "html";
    let destination = "";
    let folderName = "";
    if (urlPath === "/api/export") {
      try {
        const body = await readJsonBody(req);
        target = body.target || searchParams.get("target") || "html";
        destination = body.destination || "";
        folderName = body.folderName || "";
        if (body.saveDestination && body.destination) {
          saveSettings(studioRoot, { exportDestination: String(body.destination).trim() });
        }
      } catch (err) {
        if (err.status === 400) return sendJson(res, 400, { error: err.message });
        target = searchParams.get("target") || "html";
      }
    }
    try {
      const result = formatExportResult(runExport(target, { destination, folderName }));
      return sendJson(res, result.ok ? 200 : 400, result);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err.message || err) });
    }
  }

  if (req.method === "POST" && urlPath === "/api/export-all") {
    try {
      const results = ["html", "python", "cpp", "raw"].map((t) => formatExportResult(runExport(t)));
      const ok = results.every((r) => r.ok);
      const output = results.map((r) => r.output).join("\n\n---\n\n");
      return sendJson(res, ok ? 200 : 400, { ok, results, output });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err.message || err) });
    }
  }

  if (req.method === "POST" && urlPath === "/api/import") {
    const body = await readJsonBody(req);
    const sourcePath = String(body.sourcePath || "").trim();
    if (!sourcePath) return sendJson(res, 400, { error: "sourcePath required" });

    const kind = body.kind || (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory() ? "folder" : "html");
    let result;
    if (kind === "html" || /\.(html?|txt)$/i.test(sourcePath)) {
      result = importLegacyHtml({
        studioRoot,
        sourcePath,
        projectId: body.projectId,
        title: body.title,
        author: body.author,
        overwrite: Boolean(body.overwrite),
      });
    } else {
      result = importProjectFolder({
        studioRoot,
        sourcePath,
        projectId: body.projectId,
        overwrite: Boolean(body.overwrite),
      });
    }

    if (result.needsOverwrite) {
      return sendJson(res, 409, {
        ...result,
        ok: false,
        activeProjectId: getActiveProjectId(),
        output: (result.errors || []).join("\n"),
      });
    }

    if (result.ok && body.activate !== false && !envProject) {
      saveSettings(studioRoot, {
        activeProjectId: result.projectId,
        lastImportPath: sourcePath,
      });
    } else {
      saveSettings(studioRoot, { lastImportPath: sourcePath });
    }

    return sendJson(res, result.ok ? 200 : 400, {
      ...result,
      activeProjectId: getActiveProjectId(),
      output: result.ok
        ? `Imported ${result.projectId} (${result.sceneCount} scenes)\n${result.projectDir}`
        : (result.errors || []).join("\n"),
    });
  }

  if (req.method === "GET" && urlPath === "/api/saves") {
    return sendJson(res, 200, {
      ok: true,
      projectId: getActiveProjectId(),
      slots: listSaveSlots(projectDir),
    });
  }

  if (req.method === "GET" && urlPath.startsWith("/api/saves/")) {
    const slot = urlPath.slice("/api/saves/".length);
    const result = readSaveSlot(projectDir, slot);
    return sendJson(res, result.ok ? 200 : result.empty ? 404 : 400, result);
  }

  if (req.method === "PUT" && urlPath.startsWith("/api/saves/")) {
    const slot = urlPath.slice("/api/saves/".length);
    const body = await readJsonBody(req);
    const result = writeSaveSlot(projectDir, slot, body.save || body);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (req.method === "DELETE" && urlPath.startsWith("/api/saves/")) {
    const slot = urlPath.slice("/api/saves/".length);
    const result = deleteSaveSlot(projectDir, slot);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (req.method === "GET" && urlPath === "/api/download") {
    const name = path.basename(searchParams.get("file") || "");
    if (!name || !/^[\w.-]+\.zip$/i.test(name)) {
      return sendJson(res, 400, { error: "Provide ?file=name.zip" });
    }
    const filePath = path.join(outRoot, name);
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: "File not found" });
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": data.length,
    });
    return res.end(data);
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const urlPath = decodeURIComponent(u.pathname);

    if (urlPath.startsWith("/api/")) {
      await handleApi(req, res, urlPath, u.searchParams);
      return;
    }

    let rel = urlPath;
    if (rel === "/" || rel === "/editor" || rel === "/editor/") {
      res.writeHead(302, { Location: "/editor-web/" });
      res.end();
      return;
    }
    if (rel === "/play" || rel === "/play/") {
      res.writeHead(302, { Location: "/engine-html/" });
      res.end();
      return;
    }

    let filePath = path.resolve(path.join(studioRoot, rel.replace(/^\/+/, "")));
    if (!isInsideRoot(filePath, studioRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
      rel = path.relative(studioRoot, filePath).split(path.sep).join("/");
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Not found: ${rel}`);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      res.end(data);
    });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: String(err.message || err) });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    console.error(`Stop the other studio process, or set PORT to a free port.`);
    console.error(`Example: set PORT=8790 && npm start`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`Illustrated IF Studio`);
  console.log(`  Editor  http://127.0.0.1:${port}/editor-web/`);
  console.log(`  Player  http://127.0.0.1:${port}/engine-html/`);
  console.log(`  API     http://127.0.0.1:${port}/api/health`);
  console.log(`  Project ${getProjectDir()}`);
  console.log(`  Raw out ${resolveExportDestination(studioRoot)}`);
});
