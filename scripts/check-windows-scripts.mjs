#!/usr/bin/env node
/**
 * Keep Windows launcher scripts ASCII-only, and make sure every .ps1 still parses.
 *
 * Why: powershell.exe (5.1, the one every Windows box has) reads a BOM-less .ps1
 * as Windows-1252. A UTF-8 em dash arrives as `â€"` — and that trailing byte is a
 * smart quote, which closes the string early and turns the whole script into a
 * parse error. A non-coder then double-clicks the emergency repair script and
 * gets a wall of red text, which is exactly what these scripts exist to avoid.
 *
 *   node scripts/check-windows-scripts.mjs         # report
 *   node scripts/check-windows-scripts.mjs --fix   # rewrite typography as ASCII
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fix = process.argv.includes("--fix");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);
const EXTENSIONS = new Set([".ps1", ".bat", ".cmd", ".vbs"]);

/** Typography that shows up in generated copy, mapped to its ASCII equivalent. */
const REPLACEMENTS = [
  [/[\u2014\u2013]/g, "-"],
  [/[\u2018\u2019\u201b]/g, "'"],
  [/[\u201c\u201d\u201e]/g, '"'],
  [/\u2026/g, "..."],
  [/[\u00a0\u202f]/g, " "],
  [/\u2022/g, "*"],
  [/[\u2192\u21d2]/g, "->"],
  [/\u00d7/g, "x"],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function scrub(text) {
  let out = text;
  for (const [pattern, ascii] of REPLACEMENTS) out = out.replace(pattern, ascii);
  return out;
}

/** Ask PowerShell itself whether the file parses — catches more than encoding slips. */
function parses(file) {
  if (process.platform !== "win32") return null;
  const command =
    "$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(" +
    `'${file.replace(/'/g, "''")}'` +
    ",[ref]$null,[ref]$e); if($e -and $e.Count){$e[0].Message; exit 1} exit 0";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  return r.status === 0 ? null : (r.stdout || r.stderr || "parse error").trim();
}

const files = walk(root);
let problems = 0;
let fixed = 0;

for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  const text = fs.readFileSync(file, "utf8");
  const offenders = [...text].filter((ch) => ch.charCodeAt(0) > 126);

  if (offenders.length) {
    if (fix) {
      const cleaned = scrub(text);
      const left = [...cleaned].filter((ch) => ch.charCodeAt(0) > 126);
      fs.writeFileSync(file, cleaned);
      fixed++;
      console.log(`fixed  ${rel}  (${offenders.length} non-ASCII)`);
      if (left.length) {
        problems++;
        console.error(`  still non-ASCII: ${[...new Set(left)].join(" ")}`);
      }
    } else {
      problems++;
      const unique = [...new Set(offenders)].slice(0, 8).join(" ");
      const line = text.slice(0, text.indexOf(offenders[0])).split("\n").length;
      console.error(`non-ASCII  ${rel}:${line}  ${unique}`);
    }
  }

  if (path.extname(file).toLowerCase() === ".ps1") {
    const error = parses(file);
    if (error) {
      problems++;
      console.error(`parse      ${rel}  ${error}`);
    }
  }
}

console.log(
  `\nChecked ${files.length} Windows scripts — ${problems ? problems + " problem(s)" : "all clean"}` +
    (fixed ? `, ${fixed} rewritten` : "")
);
if (problems) {
  if (!fix) console.error("Run: node scripts/check-windows-scripts.mjs --fix");
  process.exit(1);
}
