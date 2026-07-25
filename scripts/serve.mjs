#!/usr/bin/env node
/** @deprecated Prefer `npm start` or `RUN-EDITOR.bat` → server/index.mjs / Electron */
console.warn("[deprecated] scripts/serve.mjs — use `npm start` or RUN-EDITOR.bat instead");
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
