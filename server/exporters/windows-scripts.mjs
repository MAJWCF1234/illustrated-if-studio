import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../lib/fs-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.join(__dirname, "..", "templates", "windows");

/**
 * Copy Windows play/setup scripts into an export staging dir.
 *
 * Package root (boyfriend-facing):
 *   Play the Game.vbs  — primary double-click (hidden console + MsgBox wizard)
 *   play-quiet.ps1     — orchestrator
 *   PLAY.bat           — technical / Maddie path
 *   README.txt         — short how-to (exporters may also write their own)
 *
 * _emergency/ (out of sight):
 *   SETUP-ADMIN.bat / SETUP-ADMIN.ps1 / _common.ps1 / README.txt
 *   BUILD-EXE.* (python only)
 */
export function installWindowsScripts(stagingDir, target) {
  ensureDir(stagingDir);
  const emergency = path.join(stagingDir, "_emergency");
  ensureDir(emergency);

  fs.copyFileSync(path.join(TPL, "_common.ps1"), path.join(emergency, "_common.ps1"));
  fs.copyFileSync(path.join(TPL, "SETUP-ADMIN.bat"), path.join(emergency, "SETUP-ADMIN.bat"));
  fs.copyFileSync(path.join(TPL, "_emergency-README.txt"), path.join(emergency, "README.txt"));

  const setupSrc = path.join(TPL, `${target}-SETUP-ADMIN.ps1`);
  const playSrc = path.join(TPL, `${target}-PLAY.bat`);
  if (!fs.existsSync(setupSrc)) throw new Error(`Missing template: ${setupSrc}`);
  if (!fs.existsSync(playSrc)) throw new Error(`Missing template: ${playSrc}`);

  fs.copyFileSync(setupSrc, path.join(emergency, "SETUP-ADMIN.ps1"));
  fs.copyFileSync(playSrc, path.join(stagingDir, "PLAY.bat"));

  fs.copyFileSync(path.join(TPL, "Play the Game.vbs"), path.join(stagingDir, "Play the Game.vbs"));
  fs.copyFileSync(path.join(TPL, "play-quiet.ps1"), path.join(stagingDir, "play-quiet.ps1"));

  if (target === "python") {
    const buildPs1 = path.join(TPL, "python-BUILD-EXE.ps1");
    const buildBat = path.join(TPL, "python-BUILD-EXE.bat");
    if (fs.existsSync(buildPs1)) fs.copyFileSync(buildPs1, path.join(emergency, "BUILD-EXE.ps1"));
    if (fs.existsSync(buildBat)) fs.copyFileSync(buildBat, path.join(emergency, "BUILD-EXE.bat"));
  }
}
