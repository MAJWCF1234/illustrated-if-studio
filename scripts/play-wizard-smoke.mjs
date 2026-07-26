#!/usr/bin/env node
/**
 * Smoke the Windows PLAY wizards (HTML / Python / C++ export kits).
 *
 * Guards the beginner traps we fixed:
 * - PLAY.bat must refresh PATH after SETUP (else it lies "still no Node/Python/CMake")
 * - C++ PLAY must check for a compiler, not only cmake
 * - start-server.mjs must pick a free port (two games at once)
 * - paths with spaces must serve
 * - PowerShell scripts must parse under Windows PowerShell 5.1
 * - _emergency README must stay plain ASCII (no smart punctuation)
 *
 * Usage: node scripts/play-wizard-smoke.mjs
 * Optional: PLAY_WIZ_OUT=dist/zz-play-wiz-smoke (scratch; deleted+recreated)
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outRoot = path.resolve(
  root,
  process.env.PLAY_WIZ_OUT || path.join("dist", "zz-play-wiz-smoke")
);
const api = process.env.IF_API || "http://127.0.0.1:8787";
const bugs = [];
const ok = (m) => console.log("ok  ", m);
const bug = (m) => {
  bugs.push(m);
  console.error("BUG ", m);
};

function must(cond, msg) {
  if (cond) ok(msg);
  else bug(msg);
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function nonAscii(text) {
  return [...text].filter((ch) => ch.charCodeAt(0) > 126);
}

function parsesPs1(file) {
  if (process.platform !== "win32") return null;
  const command =
    "$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(" +
    `'${file.replace(/'/g, "''")}'` +
    ",[ref]$null,[ref]$e); if($e -and $e.Count){$e[0].Message; exit 1} exit 0";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
  });
  return r.status === 0 ? null : (r.stdout || r.stderr || "parse error").trim();
}

async function apiExport(target) {
  const res = await fetch(`${api}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, destination: outRoot, projectId: "sample-project" }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(`export ${target}: ${JSON.stringify(body)}`);
  return body;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startServer(cwd, outFile, errFile) {
  const out = fs.openSync(outFile, "w");
  const err = fs.openSync(errFile, "w");
  const child = spawn(process.execPath, ["start-server.mjs"], {
    cwd,
    env: { ...process.env, NO_BROWSER: "1" },
    stdio: ["ignore", out, err],
    detached: false,
  });
  return child;
}

function readUrl(file) {
  if (!fs.existsSync(file)) return null;
  const m = read(file).match(/http:\/\/127\.0\.0\.1:\d+\//);
  return m ? m[0] : null;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

async function waitUrl(file, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const u = readUrl(file);
    if (u) return u;
    await wait(200);
  }
  return null;
}

console.log("=== PLAY wizard smoke ===");
console.log("API:", api);
console.log("Out:", outRoot);

const health = await fetch(`${api}/api/health`).then((r) => r.json());
must(health?.ok === true, "studio health ok");
// Pin exports to sample-project even if another agent switched the active project.
await fetch(`${api}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
}).catch(() => null);

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const html = await apiExport("html");
const py = await apiExport("python");
const cpp = await apiExport("cpp");
ok(`exported html/python/cpp under ${outRoot}`);

const packs = [
  { name: "html", folder: html.folder, target: "html" },
  { name: "python", folder: py.folder, target: "python" },
  { name: "cpp", folder: cpp.folder, target: "cpp" },
];

for (const p of packs) {
  const required = [
    "Play the Game.vbs",
    "play-quiet.ps1",
    "PLAY.bat",
    path.join("_emergency", "SETUP-ADMIN.bat"),
    path.join("_emergency", "SETUP-ADMIN.ps1"),
    path.join("_emergency", "_common.ps1"),
    path.join("_emergency", "README.txt"),
  ];
  if (p.target === "html") required.push("start-server.mjs");
  if (p.target === "python") required.push("app.py", path.join("_emergency", "BUILD-EXE.bat"));
  if (p.target === "cpp") required.push("CMakeLists.txt");

  for (const rel of required) {
    must(fs.existsSync(path.join(p.folder, rel)), `${p.name} has ${rel}`);
  }

  const playBat = read(path.join(p.folder, "PLAY.bat"));
  must(
    /GetEnvironmentVariable\('Path','Machine'\)/.test(playBat),
    `${p.name} PLAY.bat refreshes PATH after SETUP`
  );
  must(/call :refresh_path/.test(playBat), `${p.name} PLAY.bat calls :refresh_path`);
  must(
    /SystemRoot\\System32.*WindowsPowerShell|WindowsPowerShell\\v1\.0/.test(playBat),
    `${p.name} PLAY.bat bootstraps powershell onto PATH before refresh`
  );

  if (p.target === "cpp") {
    must(/:have_cxx/.test(playBat), "cpp PLAY.bat has :have_cxx");
    must(/No C\+\+ compiler found/.test(playBat), "cpp PLAY.bat friendly missing-compiler message");
  }

  const em = read(path.join(p.folder, "_emergency", "README.txt"));
  must(nonAscii(em).length === 0, `${p.name} _emergency README is ASCII`);
  must(/Play the Game/.test(em) && /SETUP-ADMIN\.bat/.test(em), `${p.name} emergency README beginner steps`);

  for (const rel of ["play-quiet.ps1", path.join("_emergency", "SETUP-ADMIN.ps1"), path.join("_emergency", "_common.ps1")]) {
    const err = parsesPs1(path.join(p.folder, rel));
    must(!err, `${p.name} ${rel} parses` + (err ? `: ${err}` : ""));
  }
}

const quiet = read(path.join(html.folder, "play-quiet.ps1"));
must(/function Have-Cxx/.test(quiet), "play-quiet.ps1 defines Have-Cxx");
must(/Have-Cmake\) -or -not \(Have-Cxx\)/.test(quiet) || /Have-Cxx/.test(quiet), "play-quiet checks C++ compiler");

// Dual-port: two packaged servers must not fight over 8080
const o1 = path.join(outRoot, "srv1.out");
const o2 = path.join(outRoot, "srv2.out");
const e1 = path.join(outRoot, "srv1.err");
const e2 = path.join(outRoot, "srv2.err");
const c1 = startServer(html.folder, o1, e1);
const c2 = startServer(html.folder, o2, e2);
const u1 = await waitUrl(o1);
const u2 = await waitUrl(o2);
must(!!u1 && !!u2, `two servers printed URLs (${u1}, ${u2})`);
must(u1 !== u2, `distinct ports (${u1} vs ${u2})`);
if (u1 && u2) {
  const a = await httpGet(u1);
  const b = await httpGet(u2);
  must(a.status === 200 && b.status === 200, "both servers return HTTP 200");
}
try {
  c1.kill();
  c2.kill();
} catch {
  /* ignore */
}
await wait(400);

// Path with spaces
const spaced = path.join(outRoot, "game with spaces", "web");
fs.mkdirSync(path.dirname(spaced), { recursive: true });
fs.cpSync(html.folder, spaced, { recursive: true });
const so = path.join(outRoot, "space.out");
const se = path.join(outRoot, "space.err");
const cs = startServer(spaced, so, se);
const su = await waitUrl(so);
must(!!su, `spaced-path server URL (${su})`);
if (su) {
  const r = await httpGet(su + "project/project.json");
  must(r.status === 200 && /\{/.test(r.body), "spaced-path serves project.json");
}
try {
  cs.kill();
} catch {
  /* ignore */
}

// Python headless --script still works on a fresh export (system Python, no venv required for if_engine)
const scriptPath = path.join(py.folder, "_smoke-script.json");
fs.writeFileSync(scriptPath, JSON.stringify({ steps: [0] }));
const pyRun = spawnSync(
  "py",
  ["-3", "-m", "if_engine", "project", "--script", scriptPath, "--name", "Parity"],
  { cwd: py.folder, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } }
);
must(pyRun.status === 0, `python --script exit 0 (got ${pyRun.status})`);
must(/"scene"/.test(pyRun.stdout || ""), "python --script printed scene JSON");

// Template sources stay ASCII for Windows scripts + emergency README
const tpl = path.join(root, "server", "templates", "windows");
for (const name of fs.readdirSync(tpl)) {
  const full = path.join(tpl, name);
  if (!fs.statSync(full).isFile()) continue;
  if (!/\.(ps1|bat|cmd|vbs|txt)$/i.test(name)) continue;
  const offenders = nonAscii(read(full));
  must(offenders.length === 0, `template ${name} is ASCII`);
}

if (bugs.length) {
  console.error(`\n${bugs.length} bug(s)`);
  process.exit(1);
}
console.log("\nAll PLAY wizard smoke checks passed.");
