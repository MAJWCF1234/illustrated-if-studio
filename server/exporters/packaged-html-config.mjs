/**
 * Packaged HTML player config.js body.
 * Must stay in sync with engine-html/js/main.js imports:
 *   import { PROJECT_BASE, initProjectBase } from "./config.js";
 * Studio builds resolve PROJECT_BASE via /api/settings; packaged builds pin ../project/.
 */
export const PACKAGED_HTML_CONFIG_JS = `/** Packaged build — project shipped beside the engine. */
export let PROJECT_BASE = new URL("../project/", import.meta.url);

/** No-op for packaged builds (studio uses /api/settings). */
export async function initProjectBase() {
  return PROJECT_BASE;
}
`;

/**
 * Tiny static server shipped with HTML exports.
 *
 * Uses path.resolve + stripped relative paths so Windows paths with spaces work
 * and leading "/" segments do not escape the package root.
 *
 * It claims the first free port rather than insisting on 8080, and opens the
 * browser itself once listening. Two exported games (or one launched twice)
 * would otherwise fight over 8080: the second server died with an EADDRINUSE
 * stack trace while the browser cheerfully showed the first game instead.
 */
export const PACKAGED_START_SERVER_JS = `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".mp3":"audio/mpeg",".ogg":"audio/ogg",".wav":"audio/wav"};
const server = http.createServer((req,res)=>{
  let rel = decodeURIComponent((req.url||"/").split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const safeRel = rel.replace(/^[/\\\\]+/, "");
  let file = path.resolve(root, safeRel);
  if (file !== root && !file.startsWith(rootPrefix)) { res.writeHead(403); return res.end("Forbidden"); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file,(err,data)=>{
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200,{"Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream"});
    res.end(data);
  });
});

function openBrowser(url) {
  if (process.env.NO_BROWSER) return;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* the printed address still works */
  }
}

const requested = Number(process.env.PORT) || 0;
const candidates = requested ? [requested] : Array.from({ length: 20 }, (_, i) => 8080 + i);

// Reported once, from the port actually bound: a per-attempt callback would
// survive its failed attempt and later announce a port another game owns.
server.on("listening", () => {
  const url = "http://127.0.0.1:" + server.address().port + "/";
  console.log("Play at " + url);
  console.log("Keep this window open while you play. Close it to stop the game.");
  openBrowser(url);
});

function listenOn(index) {
  if (index >= candidates.length) {
    console.error("Could not find a free port between " + candidates[0] + " and " + candidates[candidates.length - 1] + ".");
    console.error("Close any other running games and try again.");
    process.exit(1);
  }
  server.once("error", (err) => {
    if (err && err.code === "EADDRINUSE") return listenOn(index + 1);
    console.error("Could not start the game server: " + (err && err.message ? err.message : err));
    process.exit(1);
  });
  server.listen(candidates[index], "127.0.0.1");
}

listenOn(0);
`;
