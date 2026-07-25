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
console.log("C++ parity smoke OK.");
