import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./fs-utils.mjs";

/** Zip a folder's contents to zipPath (Windows: Compress-Archive; else: tar fallback). */
export function zipDirectory(sourceDir, zipPath) {
  ensureDir(path.dirname(zipPath));
  fs.rmSync(zipPath, { force: true });

  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8" }
    );
    if (ps.status !== 0 || !fs.existsSync(zipPath)) {
      throw new Error(ps.stderr || ps.stdout || "Compress-Archive failed");
    }
    return zipPath;
  }

  const tar = spawnSync("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], { encoding: "utf8" });
  if (tar.status !== 0 || !fs.existsSync(zipPath)) {
    throw new Error(tar.stderr || "tar zip failed");
  }
  return zipPath;
}
