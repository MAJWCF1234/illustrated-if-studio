#!/usr/bin/env node
/** Verify the upload-ready static website export boots under a plain HTTP host. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { exportStaticHtml } from "../server/exporters/static-html.mjs";
import { removeDir } from "../server/lib/fs-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const projectDir = path.join(studioRoot, "projects", "sample-project");
const outRoot = path.join(studioRoot, "dist");

function mustExist(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing export file: ${file}`);
}

function startStaticHost(root) {
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    const requested = rel === "/" ? "index.html" : rel.replace(/^[/\\]+/, "");
    const file = path.resolve(root, requested);
    if (file !== root && !file.startsWith(rootPrefix)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const result = exportStaticHtml({ studioRoot, projectDir, outRoot });
  if (!result.ok) throw new Error((result.errors || []).join("; "));

  try {
    for (const file of ["index.html", "css/theme.css", "js/main.js", "js/config.js", "project/project.json", "README.txt"]) {
      mustExist(path.join(result.folder, file));
    }
    for (const forbidden of [
      "start-server.mjs",
      "Play the Game.vbs",
      "PLAY.bat",
      "project/saves",
      "project/story/scenes.json.bak",
      "project/theme/theme.json.bak",
    ]) {
      if (fs.existsSync(path.join(result.folder, forbidden))) {
        throw new Error(`Static site should not ship ${forbidden}`);
      }
    }
    const config = fs.readFileSync(path.join(result.folder, "js", "config.js"), "utf8");
    if (!config.includes("Static website build") || !config.includes("../project/")) {
      throw new Error("Static site config is not pinned to its bundled project");
    }

    const server = await startStaticHost(result.folder);
    const port = server.address().port;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const failures = [];
    page.on("pageerror", (err) => failures.push(String(err)));
    page.on("response", (res) => {
      if (res.status() >= 400) failures.push(`${res.status()} ${res.url()}`);
    });
    try {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
      await page.waitForSelector("#gate:not([hidden])", { timeout: 15000 });
      await page.fill("#player-name", "WebHost");
      await page.click('#gate-form button[type="submit"]');
      await page.waitForSelector("#novel:not([hidden])", { timeout: 10000 });
      if ((await page.locator("#choices button").count()) < 1) throw new Error("Static site has no start choices");
      await page.locator("#choices button").first().click();
      if (!(await page.locator("#story-text").innerText()).trim()) throw new Error("Static site story is empty after a choice");
      if (failures.length) throw new Error(`Static host errors: ${failures.join("; ")}`);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
    console.log(`Static site export OK: ${result.folder}`);
  } finally {
    removeDir(result.folder);
  }
}

main().catch((err) => {
  console.error("Static site export failed:", err.message || err);
  process.exit(1);
});
