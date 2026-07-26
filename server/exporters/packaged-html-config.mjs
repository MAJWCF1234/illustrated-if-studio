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
 * Uses path.resolve + stripped relative paths so Windows paths with spaces work
 * and leading "/" segments do not escape the package root.
 */
export const PACKAGED_START_SERVER_JS = `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
const port = Number(process.env.PORT) || 8080;
const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".mp3":"audio/mpeg",".ogg":"audio/ogg",".wav":"audio/wav"};
http.createServer((req,res)=>{
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
}).listen(port,"127.0.0.1",()=>console.log("Play at http://127.0.0.1:"+port+"/"));
`;
