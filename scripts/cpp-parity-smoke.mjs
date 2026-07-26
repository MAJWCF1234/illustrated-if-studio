#!/usr/bin/env node
/**
 * Export the sample project as C++, optionally cmake-build, run --script fixture.
 * Skips the build step cleanly when CMake / a C++ toolchain is unavailable.
 *
 * Usage: node scripts/cpp-parity-smoke.mjs
 * Env:   IF_CPP_FORCE_BUILD=1  — fail if cmake/build missing
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exportCpp } from "../server/exporters/cpp.mjs";
import { evalWhen } from "../engine-html/js/conditions.js";
import { state, cases } from "../tests/fixtures/condition-cases.mjs";

const HARNESS_CPP = `#include <iostream>
#include <sstream>
#include <string>
#include <nlohmann/json.hpp>
#include "conditions.hpp"

int main() {
  std::ostringstream buf;
  buf << std::cin.rdbuf();
  const auto payload = nlohmann::json::parse(buf.str());
  ifs::State state;
  for (const auto& a : payload["state"].value("abilities", nlohmann::json::array())) {
    state.abilities.insert(a.get<std::string>());
  }
  const auto vars = payload["state"].value("vars", nlohmann::json::object());
  for (auto it = vars.begin(); it != vars.end(); ++it) state.vars[it.key()] = it.value();

  nlohmann::json out = nlohmann::json::array();
  for (const auto& when : payload["cases"]) {
    try {
      out.push_back(ifs::eval_when(when, state));
    } catch (const std::exception& err) {
      out.push_back(std::string("CRASH: ") + err.what());
    }
  }
  std::cout << out.dump() << std::endl;
  return 0;
}
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const projectDir = path.join(studioRoot, "projects", "sample-project");
const outRoot = path.join(studioRoot, "dist");
const fixture = path.join(studioRoot, "tests", "fixtures", "sample-path.json");
const forceBuild = process.env.IF_CPP_FORCE_BUILD === "1";

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
    shell: true,
  });
  return r.status === 0;
}

function findExe(buildDir) {
  const candidates = [
    path.join(buildDir, "illustrated_if"),
    path.join(buildDir, "Release", "illustrated_if.exe"),
    path.join(buildDir, "Debug", "illustrated_if.exe"),
    path.join(buildDir, "illustrated_if.exe"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: opts.shell ?? false,
    cwd: opts.cwd,
    windowsHide: true,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r;
}

const result = exportCpp({ studioRoot, projectDir, outRoot });
if (!result.ok) {
  console.error("C++ export failed:", result.errors);
  process.exit(1);
}

const must = [
  "CMakeLists.txt",
  "include/conditions.hpp",
  "include/saves.hpp",
  "include/runtime.hpp",
  "src/saves.cpp",
  "src/runtime.cpp",
  "src/main.cpp",
  "project/project.json",
];
for (const f of must) {
  const p = path.join(result.folder, f);
  if (!fs.existsSync(p)) {
    console.error("Missing from export:", f);
    process.exit(1);
  }
}
console.log("Export OK:", result.folder);

if (!which("cmake")) {
  const msg = "CMake not on PATH — export verified; build/parity skipped.";
  if (forceBuild) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

const buildDir = path.join(result.folder, "build");
// Do not use shell:true — paths may contain spaces ("needs help").
const cfg = run("cmake", ["-S", result.folder, "-B", buildDir]);
if (cfg.status !== 0) {
  if (forceBuild) process.exit(cfg.status ?? 1);
  console.warn("cmake configure failed — skipping build (set IF_CPP_FORCE_BUILD=1 to fail).");
  process.exit(0);
}

const build = run("cmake", ["--build", buildDir, "--config", "Release"]);
if (build.status !== 0) {
  if (forceBuild) process.exit(build.status ?? 1);
  console.warn("cmake build failed — skipping run.");
  process.exit(0);
}

const exe = findExe(buildDir);
if (!exe) {
  console.error("Built binary not found under", buildDir);
  process.exit(1);
}

const play = run(exe, [
  "--script",
  fixture,
  "--name",
  "Parity",
  "--project",
  path.join(result.folder, "project"),
]);
if (play.status !== 0) {
  console.error("C++ script run failed with status", play.status);
  process.exit(play.status ?? 1);
}
if (!/"scene":\s*"ending"/.test(play.stdout || "")) {
  console.error("Expected scene ending in C++ output:", play.stdout);
  process.exit(1);
}

if (!checkConditions(buildDir)) process.exit(1);

console.log("C++ parity smoke OK.");

/**
 * Run the shared condition table through the compiled C++ header.
 *
 * The happy-path fixture above never touches an unset variable or a type
 * mismatch, so a crash in eval_when could ride along unnoticed. This builds a
 * tiny harness against the exported header, reusing the nlohmann/json headers
 * that CMake already fetched for the game itself.
 */
function checkConditions(buildDirPath) {
  const jsonInclude = [
    path.join(buildDirPath, "_deps", "json-src", "include"),
    path.join(buildDirPath, "_deps", "json-src", "single_include"),
  ].find((p) => fs.existsSync(path.join(p, "nlohmann", "json.hpp")));
  const compiler = readCmakeCache(buildDirPath, "CMAKE_CXX_COMPILER");

  if (!jsonInclude || !compiler || !fs.existsSync(compiler)) {
    const msg = "C++ condition parity skipped (no json headers or compiler from the build).";
    if (forceBuild) {
      console.error(msg);
      return false;
    }
    console.warn(msg);
    return true;
  }

  const src = path.join(buildDirPath, "condition_parity.cpp");
  const exeOut = path.join(buildDirPath, process.platform === "win32" ? "condition_parity.exe" : "condition_parity");
  fs.writeFileSync(src, HARNESS_CPP, "utf8");

  const compile = run(compiler, [
    "-std=c++17",
    "-I",
    path.join(result.folder, "include"),
    "-I",
    jsonInclude,
    src,
    "-o",
    exeOut,
  ]);
  if (compile.status !== 0) {
    console.error("Condition harness failed to compile.");
    return false;
  }

  const probe = spawnSync(exeOut, [], {
    encoding: "utf8",
    input: JSON.stringify({ state, cases: cases.map(([, when]) => when) }),
    windowsHide: true,
  });
  if (probe.status !== 0) {
    console.error("Condition harness crashed:", (probe.stderr || "").trim());
    return false;
  }

  let cppResults;
  try {
    cppResults = JSON.parse((probe.stdout || "").trim().split("\n").pop());
  } catch {
    console.error("Condition harness output not JSON:", (probe.stdout || "").slice(0, 200));
    return false;
  }

  const failures = [];
  console.log("\nC++ conditions vs JS:");
  cases.forEach(([label, when], i) => {
    const want = Boolean(evalWhen(when, state));
    const got = cppResults[i];
    const same = got === want;
    if (!same) failures.push(`"${label}": JS=${want} C++=${JSON.stringify(got)}`);
    console.log(`  ${same ? "ok  " : "DIFF"} ${label}: JS=${want} C++=${JSON.stringify(got)}`);
  });

  console.log(`C++ condition parity failures: ${failures.length}`);
  failures.forEach((f) => console.log("-", f));
  return failures.length === 0;
}

function readCmakeCache(buildDirPath, key) {
  const cache = path.join(buildDirPath, "CMakeCache.txt");
  if (!fs.existsSync(cache)) return null;
  const line = fs
    .readFileSync(cache, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(line.indexOf("=") + 1).trim() : null;
}
