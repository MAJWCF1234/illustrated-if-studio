#!/usr/bin/env node
/** Run validate + JS parity (+ optional Python if available). */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd || studio, shell: opts.shell });
  if (r.status) process.exit(r.status ?? 1);
}

run(process.execPath, ["scripts/validate-project.mjs", "projects/sample-project"]);
run(process.execPath, ["scripts/check-windows-scripts.mjs"]);
run(process.execPath, ["scripts/parity-test.mjs"]);
run(process.execPath, ["scripts/conditions-parity-smoke.mjs"]);
run(process.execPath, ["scripts/export-destination-smoke.mjs"]);

const pyCandidates = [
  process.env.PYTHON,
  "py",
  "python3",
  "python",
  String.raw`C:\Users\majwc\AppData\Local\Programs\Python\Python311\python.exe`,
  String.raw`C:\Users\majwc\AppData\Local\Programs\Python\Python39\python.exe`,
].filter(Boolean);

let pyOk = false;
for (const py of pyCandidates) {
  const probe = spawnSync(py, ["--version"], { encoding: "utf8", shell: true });
  if (probe.status === 0 && /Python 3/i.test((probe.stdout || "") + (probe.stderr || ""))) {
    console.log(`\n> ${py} -m if_engine (parity fixture)`);
    const r = spawnSync(
      py,
      [
        "-m",
        "if_engine",
        "../projects/sample-project",
        "--script",
        "../tests/fixtures/sample-path.json",
        "--name",
        "Parity",
      ],
      { cwd: path.join(studio, "engine-python"), encoding: "utf8", shell: true }
    );
    process.stdout.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
    if (r.status === 0 && /"scene":\s*"ending"/.test(r.stdout || "")) {
      pyOk = true;
      break;
    }
  }
}
if (!pyOk) console.warn("\nPython parity skipped (no usable Python 3 on PATH).");

console.log("\n> node scripts/cpp-parity-smoke.mjs (export; build if cmake present)");
{
  const r = spawnSync(process.execPath, ["scripts/cpp-parity-smoke.mjs"], {
    stdio: "inherit",
    cwd: studio,
  });
  if (r.status) process.exit(r.status ?? 1);
}

console.log("\nAll requested checks finished.");
