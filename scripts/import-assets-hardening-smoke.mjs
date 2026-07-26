/**
 * Smoke checks for import + asset-upload hardening:
 * - malformed / non-object project.json must not 500 or leave junk under projects/
 * - overlong asset filenames must 400 (not 500 ENOENT)
 * - Windows reserved asset names are renamed (CON.png → file-CON.png)
 * - legacy HTML VM eval rejects hangs via timeout; oversized files rejected
 *
 * Requires a live server: node server/index.mjs
 * Run: node scripts/import-assets-hardening-smoke.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importLegacyHtml } from "../server/lib/import-legacy.mjs";
import { importProjectFolder } from "../server/exporters/raw.mjs";
import { safeAssetFilename } from "../server/lib/fs-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:8787";
const SCRATCH = path.join(ROOT, "dist", "zz-import-assets-smoke");
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
    const payload = body == null ? null : JSON.stringify(body);
    const headers = {};
    if (payload != null) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method, headers },
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

function rmQuiet(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function setupScratch() {
  rmQuiet(SCRATCH);
  fs.mkdirSync(SCRATCH, { recursive: true });

  const badJson = path.join(SCRATCH, "bad-json");
  fs.mkdirSync(badJson, { recursive: true });
  fs.writeFileSync(path.join(badJson, "project.json"), "{ not json");

  const arrayJson = path.join(SCRATCH, "array-json");
  fs.mkdirSync(arrayJson, { recursive: true });
  fs.writeFileSync(path.join(arrayJson, "project.json"), '["not","an","object"]');

  fs.writeFileSync(
    path.join(SCRATCH, "valid.html"),
    `const scenes = {\n  start: { text: "hi", choices: [] }\n};`
  );

  fs.writeFileSync(
    path.join(SCRATCH, "hang.html"),
    `const scenes = {\n  start: { text: (function () { for (;;) {} })(), choices: [] }\n};`
  );

  fs.writeFileSync(
    path.join(SCRATCH, "getter.html"),
    `const scenes = {\n  get boom() { for (;;) {} return { text: "x", choices: [] }; },\n  start: { text: "ok", choices: [] }\n};`
  );

  const huge = path.join(SCRATCH, "huge.html");
  const fd = fs.openSync(huge, "w");
  fs.writeSync(fd, `const scenes = {\n  start: { text: "x", choices: [] }\n};\n`);
  const chunk = Buffer.alloc(1024 * 1024, 0x41);
  for (let i = 0; i < 9; i++) fs.writeSync(fd, chunk);
  fs.closeSync(fd);

  return { badJson, arrayJson, huge };
}

async function main() {
  const unit = safeAssetFilename("CON.png");
  if (unit.ok && unit.filename === "file-CON.png") ok("unit safeAssetFilename renames CON.png");
  else fail(`unit CON.png => ${JSON.stringify(unit)}`);

  const long = safeAssetFilename(`${"a".repeat(300)}.png`);
  if (!long.ok && /too long/i.test(long.error)) ok("unit rejects overlong filename");
  else fail(`unit long => ${JSON.stringify(long)}`);

  const trav = safeAssetFilename("../../../etc/passwd.png");
  if (trav.ok && trav.filename === "passwd.png") ok("unit basename strips traversal");
  else fail(`unit trav => ${JSON.stringify(trav)}`);

  const health = await req("GET", "/api/health");
  if (!health.json?.ok) {
    fail("server not healthy — start node server/index.mjs");
    process.exit(1);
  }
  await req("PUT", "/api/settings", { activeProjectId: "sample-project" });

  const { badJson, arrayJson, huge } = setupScratch();
  const killIds = ["zz-smoke-bad", "zz-smoke-array", "zz-smoke-ok"];

  for (const id of killIds) rmQuiet(path.join(ROOT, "projects", id));

  // Direct: malformed must not throw
  let threw = false;
  let badResult;
  try {
    badResult = importProjectFolder({
      studioRoot: ROOT,
      sourcePath: badJson,
      projectId: "zz-smoke-bad",
      overwrite: true,
    });
  } catch (e) {
    threw = true;
    fail(`importProjectFolder threw on malformed JSON: ${e.message}`);
  }
  if (!threw) {
    if (!badResult.ok && /invalid project\.json/i.test(String(badResult.errors))) {
      ok("direct malformed project.json rejected");
    } else fail(`malformed unexpected: ${JSON.stringify(badResult)}`);
  }
  if (fs.existsSync(path.join(ROOT, "projects", "zz-smoke-bad"))) {
    fail("malformed import left projects/zz-smoke-bad");
  } else ok("malformed import left no project dir");

  // Direct: array must not copy junk
  const arrResult = importProjectFolder({
    studioRoot: ROOT,
    sourcePath: arrayJson,
    projectId: "zz-smoke-array",
    overwrite: true,
  });
  if (!arrResult.ok && /must be a JSON object/i.test(String(arrResult.errors))) {
    ok("direct array project.json rejected");
  } else fail(`array unexpected: ${JSON.stringify(arrResult)}`);
  if (fs.existsSync(path.join(ROOT, "projects", "zz-smoke-array"))) {
    fail("array import left projects/zz-smoke-array");
  } else ok("array import left no project dir");

  // API: malformed → 400 not 500
  const apiBad = await req("POST", "/api/import", {
    kind: "folder",
    sourcePath: badJson,
    projectId: "zz-smoke-bad",
    activate: false,
    overwrite: true,
  });
  if (apiBad.status === 400 && apiBad.json?.ok === false) ok("API malformed folder → 400");
  else fail(`API malformed status=${apiBad.status} body=${apiBad.raw.slice(0, 200)}`);

  const apiArr = await req("POST", "/api/import", {
    kind: "folder",
    sourcePath: arrayJson,
    projectId: "zz-smoke-array",
    activate: false,
    overwrite: true,
  });
  if (apiArr.status === 400 && apiArr.json?.ok === false) ok("API array folder → 400");
  else fail(`API array status=${apiArr.status} body=${apiArr.raw.slice(0, 200)}`);
  if (fs.existsSync(path.join(ROOT, "projects", "zz-smoke-array"))) {
    fail("API array import left project dir");
  }

  // Legacy: oversized file
  const hugeResult = importLegacyHtml({
    studioRoot: ROOT,
    sourcePath: huge,
    projectId: "zz-smoke-huge",
    overwrite: true,
  });
  if (!hugeResult.ok && /too large/i.test(String(hugeResult.errors))) ok("legacy rejects oversized HTML");
  else fail(`huge unexpected: ${JSON.stringify(hugeResult)}`);

  // Legacy: VM hang timeout (loop during eval)
  const t0 = Date.now();
  const hangResult = importLegacyHtml({
    studioRoot: ROOT,
    sourcePath: path.join(SCRATCH, "hang.html"),
    projectId: "zz-smoke-hang",
    overwrite: true,
  });
  const elapsed = Date.now() - t0;
  if (!hangResult.ok && /timed out|Script execution timed out/i.test(String(hangResult.errors))) {
    ok(`legacy VM timeout (${elapsed}ms)`);
  } else fail(`hang unexpected after ${elapsed}ms: ${JSON.stringify(hangResult)}`);
  if (elapsed > 8000) fail(`VM timeout too slow: ${elapsed}ms`);

  // Legacy: accessor scenes must be skipped (not invoke getters / hang)
  const t1 = Date.now();
  const getterResult = importLegacyHtml({
    studioRoot: ROOT,
    sourcePath: path.join(SCRATCH, "getter.html"),
    projectId: "zz-smoke-getter",
    overwrite: true,
  });
  const getterElapsed = Date.now() - t1;
  if (getterResult.ok && getterResult.sceneCount === 1 && getterElapsed < 3000) {
    ok(`legacy skips getter scenes (${getterElapsed}ms, scenes=${getterResult.sceneCount})`);
  } else {
    fail(`getter unexpected after ${getterElapsed}ms: ${JSON.stringify(getterResult)}`);
  }
  rmQuiet(path.join(ROOT, "projects", "zz-smoke-getter"));

  // Upload: overlong → 400
  await req("PUT", "/api/settings", { activeProjectId: "sample-project" });
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const upLong = await req("POST", "/api/assets/upload", {
    filename: `${"a".repeat(300)}.png`,
    folder: "scene_images",
    dataUrl: png,
  });
  if (upLong.status === 400 && /too long/i.test(upLong.json?.error || "")) ok("upload overlong → 400");
  else fail(`upload long status=${upLong.status} body=${upLong.raw.slice(0, 200)}`);

  const upCon = await req("POST", "/api/assets/upload", {
    filename: "CON.png",
    folder: "scene_images",
    dataUrl: png,
  });
  if (upCon.status === 200 && upCon.json?.filename === "file-CON.png") {
    ok("upload renames CON.png");
    const p = path.join(ROOT, "projects", "sample-project", "assets", "scene_images", "file-CON.png");
    if (fs.existsSync(p)) {
      ok("renamed asset on disk");
      fs.unlinkSync(p);
    } else fail("file-CON.png missing on disk");
  } else fail(`upload CON status=${upCon.status} body=${upCon.raw.slice(0, 200)}`);

  const upTrav = await req("POST", "/api/assets/upload", {
    filename: "..\\..\\zz-smoke-escape.png",
    folder: "scene_images",
    dataUrl: png,
  });
  const expectedDir = path.resolve(ROOT, "projects", "sample-project", "assets", "scene_images");
  if (
    upTrav.status === 200 &&
    upTrav.json?.filename === "zz-smoke-escape.png" &&
    path.dirname(path.resolve(upTrav.json.path)) === expectedDir
  ) {
    ok("upload traversal stays in scene_images");
    rmQuiet(path.join(expectedDir, "zz-smoke-escape.png"));
  } else fail(`upload trav status=${upTrav.status} body=${upTrav.raw.slice(0, 250)}`);

  // Restore active project
  await req("PUT", "/api/settings", { activeProjectId: "sample-project" });
  for (const id of [...killIds, "zz-smoke-huge", "zz-smoke-hang", "zz-smoke-getter"]) {
    rmQuiet(path.join(ROOT, "projects", id));
  }
  rmQuiet(SCRATCH);

  // Cleanup any leftover smoke assets from earlier runs
  for (const name of ["file-CON.png", "file-NUL.jpg", "zz-smoke-escape.png"]) {
    rmQuiet(path.join(ROOT, "projects", "sample-project", "assets", "scene_images", name));
  }

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nimport-assets-hardening-smoke: all ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
