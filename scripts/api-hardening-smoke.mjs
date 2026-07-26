/**
 * Smoke checks for API hardening from the stress hunt:
 * - unsafe export destinations (relative / \\?\ / UNC / other-drive \Windows)
 * - activeProjectId path tricks
 * - scenes array / null scene rejection
 * - validate does not 500 on corrupt scenes already on disk
 *
 * Run against a live server: node scripts/api-hardening-smoke.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeUnsafeDestination } from "../server/lib/settings.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:8787";
let failed = 0;

function fail(msg) {
  failed++;
  console.log("FAIL:", msg);
}
function ok(msg) {
  console.log("ok  ", msg);
}

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE);
    const payload = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    const headers = {};
    if (payload != null) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, raw, json });
        });
      }
    );
    r.on("error", reject);
    if (payload != null) r.write(payload);
    r.end();
  });
}

async function main() {
  const unitBlock = [
    path.resolve("..", "..", "..", "Windows"),
    "D:\\Windows",
    "\\\\?\\C:\\Windows",
    "\\\\localhost\\C$\\Windows",
  ];
  for (const d of unitBlock) {
    const reason = describeUnsafeDestination(d);
    if (reason) ok(`unit block ${d}`);
    else fail(`unit allowed ${d}`);
  }

  const health = await req("GET", "/api/health");
  if (!health.json?.ok) {
    fail("server not healthy — start node server/index.mjs");
    process.exit(1);
  }

  await req("PUT", "/api/settings", { activeProjectId: "sample-project" });

  for (const id of ["sample-project/../finding-secrets", "../x", "foo/bar"]) {
    const r = await req("PUT", "/api/settings", { activeProjectId: id });
    if (r.status === 400) ok(`reject project id ${JSON.stringify(id)}`);
    else fail(`accepted project id ${JSON.stringify(id)} status=${r.status}`);
  }

  for (const dest of [
    "..\\..\\..\\Windows",
    "\\\\?\\C:\\Windows",
    "\\\\localhost\\C$\\Windows",
    "D:\\Windows",
    path.join(ROOT, "projects"),
    path.join(ROOT, "projects", "finding-secrets"),
  ]) {
    const r = await req("POST", "/api/export", {
      target: "raw",
      destination: dest,
      folderName: "should-not-exist",
    });
    if (r.status === 400 && r.json?.ok === false) ok(`reject dest ${dest}`);
    else fail(`export allowed ${dest} status=${r.status} body=${r.raw.slice(0, 160)}`);
  }

  const arr = await req("PUT", "/api/scenes", { start: "start", scenes: [{ text: "nope" }] });
  if (arr.status === 400) ok("reject scenes array");
  else fail(`scenes array status=${arr.status}`);

  const nul = await req("PUT", "/api/scenes", { start: "start", scenes: { start: null } });
  if (nul.status === 400) ok("reject null scene");
  else fail(`null scene status=${nul.status}`);

  const badChoices = await req("PUT", "/api/scenes", {
    start: "start",
    scenes: { start: { text: "t", choices: "nope" } },
  });
  if (badChoices.status === 400) ok("reject non-array choices");
  else fail(`choices string status=${badChoices.status}`);

  // Ensure sample still healthy
  const v = await req("POST", "/api/validate", {});
  if (v.status === 200 && v.json?.ok) ok("sample-project still validates");
  else fail(`validate status=${v.status} ok=${v.json?.ok} err=${v.raw.slice(0, 200)}`);

  const h = await req("GET", "/api/health");
  if (h.json?.activeProjectId === "sample-project") ok("active project sample-project");
  else fail(`active=${h.json?.activeProjectId}`);

  // no scratch Windows folders
  if (fs.existsSync("D:\\Windows\\should-not-exist") || fs.existsSync("D:\\Windows\\stress-probe-tmp")) {
    fail("leftover under D:\\Windows");
  } else ok("no D:\\Windows leftovers");

  console.log(failed ? `\n${failed} failure(s)` : "\nAll hardening checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
