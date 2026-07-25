import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../lib/fs-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(__dirname, "..", "templates", "windows");

/** Copy shared + target-specific Windows setup/play scripts into staging dir. */
export function installWindowsScripts(stagingDir, target) {
  ensureDir(stagingDir);
  fs.copyFileSync(path.join(TPL, "_common.ps1"), path.join(stagingDir, "_common.ps1"));
  fs.copyFileSync(path.join(TPL, "SETUP-ADMIN.bat"), path.join(stagingDir, "SETUP-ADMIN.bat"));

  const setupSrc = path.join(TPL, `${target}-SETUP-ADMIN.ps1`);
  const playSrc = path.join(TPL, `${target}-PLAY.bat`);
  if (!fs.existsSync(setupSrc)) throw new Error(`Missing template: ${setupSrc}`);
  if (!fs.existsSync(playSrc)) throw new Error(`Missing template: ${playSrc}`);

  fs.copyFileSync(setupSrc, path.join(stagingDir, "SETUP-ADMIN.ps1"));
  fs.copyFileSync(playSrc, path.join(stagingDir, "PLAY.bat"));

  if (target === "python") {
    const buildPs1 = path.join(TPL, "python-BUILD-EXE.ps1");
    const buildBat = path.join(TPL, "python-BUILD-EXE.bat");
    if (fs.existsSync(buildPs1)) fs.copyFileSync(buildPs1, path.join(stagingDir, "BUILD-EXE.ps1"));
    if (fs.existsSync(buildBat)) fs.copyFileSync(buildBat, path.join(stagingDir, "BUILD-EXE.bat"));
  }
}
