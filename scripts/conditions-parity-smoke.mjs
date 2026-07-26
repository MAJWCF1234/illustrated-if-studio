#!/usr/bin/env node
/**
 * Condition parity across engines.
 *
 * A misspelled or unset story variable is the most common beginner mistake, and
 * every engine must treat it as "condition not met" rather than crashing the
 * game. This compares the JS engine against the Python one; the same table is
 * run against the compiled C++ header by scripts/cpp-parity-smoke.mjs.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evalWhen } from "../engine-html/js/conditions.js";
import { state, cases } from "../tests/fixtures/condition-cases.mjs";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];

// --- JS side: must never throw, and gives the reference answers.
const jsResults = cases.map(([label, when]) => {
  try {
    return Boolean(evalWhen(when, state));
  } catch (err) {
    failures.push(`JS threw on "${label}": ${err.message}`);
    return null;
  }
});

console.log("JS results:");
cases.forEach(([label], i) => console.log(`  ${String(jsResults[i]).padEnd(5)} ${label}`));

// --- Python side: same table, compared against JS.
function findPython() {
  for (const py of [process.env.PYTHON, "py", "python3", "python"].filter(Boolean)) {
    const probe = spawnSync(py, ["--version"], { encoding: "utf8", shell: true });
    if (probe.status === 0 && /Python 3/i.test((probe.stdout || "") + (probe.stderr || ""))) return py;
  }
  return null;
}

const py = findPython();
if (!py) {
  console.warn("\nPython comparison skipped (no usable Python 3 on PATH).");
} else {
  const script = `
import json, sys
from if_engine.runtime import eval_when
payload = json.loads(sys.stdin.read())
state = payload["state"]
out = []
for when in payload["cases"]:
    try:
        out.append(bool(eval_when(when, state)))
    except Exception as err:
        out.append("CRASH: %s: %s" % (type(err).__name__, err))
print(json.dumps(out))
`;
  const r = spawnSync(py, ["-c", script], {
    cwd: path.join(studioRoot, "engine-python"),
    input: JSON.stringify({ state, cases: cases.map(([, when]) => when) }),
    encoding: "utf8",
  });
  if (r.status !== 0) {
    failures.push(`Python runner failed: ${(r.stderr || "").trim().split("\n").slice(-3).join(" ")}`);
  } else {
    let pyResults;
    try {
      pyResults = JSON.parse((r.stdout || "").trim().split("\n").pop());
    } catch {
      failures.push(`Python output not JSON: ${(r.stdout || "").slice(0, 200)}`);
      pyResults = [];
    }
    console.log("\nPython vs JS:");
    cases.forEach(([label], i) => {
      const got = pyResults[i];
      const want = jsResults[i];
      const same = got === want;
      if (!same) failures.push(`"${label}": JS=${want} Python=${JSON.stringify(got)}`);
      console.log(`  ${same ? "ok  " : "DIFF"} ${label}: JS=${want} Python=${JSON.stringify(got)}`);
    });
  }
}

console.log(`\nCondition parity failures: ${failures.length}`);
failures.forEach((f) => console.log("-", f));
process.exit(failures.length ? 1 : 0);
