#!/usr/bin/env node
/** Find a Python 3 and run scripts/python-saves-smoke.py */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(__dirname, "..");
const script = path.join(studio, "scripts", "python-saves-smoke.py");

const candidates = [
  process.env.PYTHON,
  process.platform === "win32" ? null : "python3",
  "python",
].filter(Boolean);

function tryRun(cmd, args) {
  const probeArgs = cmd === "py" ? ["-3", "--version"] : ["--version"];
  const probe = spawnSync(cmd, probeArgs, { encoding: "utf8", windowsHide: true });
  const out = (probe.stdout || "") + (probe.stderr || "");
  if (probe.status !== 0 || !/Python 3/i.test(out)) return null;
  console.log(`Using ${cmd}: ${out.trim()}`);
  const runArgs = cmd === "py" ? ["-3", script, ...args] : [script, ...args];
  return spawnSync(cmd, runArgs, { cwd: studio, stdio: "inherit", windowsHide: true });
}

// Prefer Windows py launcher with -3, then python
if (process.platform === "win32") {
  const r = tryRun("py", []);
  if (r) process.exit(r.status ?? 1);
}
for (const py of candidates) {
  const r = tryRun(py, []);
  if (r) process.exit(r.status ?? 1);
}
console.error("No Python 3 on PATH — skipped python saves smoke.");
process.exit(0);
