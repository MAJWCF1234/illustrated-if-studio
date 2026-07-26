/**
 * Guards the backup launcher ordering: optional export-tools prompt must never
 * run before Electron is started (README + Illustrated IF Studio.exe contract).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

const ps1Path = path.join(studioRoot, "tools", "launch-studio.ps1");
const ps1 = fs.readFileSync(ps1Path, "utf8");

if (/if \(Test-Path \$electronExe\) \{\s*Offer-ExportTools\s*& \$electronExe \$Root/s.test(ps1)) {
  bug("fast path still calls Offer-ExportTools before launching Electron");
}

// After Electron install path: Offer must not sit immediately before a blocking & launch
if (/Offer-ExportTools\s*\r?\n\s*(try \{\s*)?if \(Test-Path \$electronExe\) \{ & \$electronExe/s.test(ps1)) {
  bug("node-install path still offers export tools before Electron launch");
}

if (!/function Launch-ThenOfferExportTools/.test(ps1)) {
  bug("Launch-ThenOfferExportTools helper missing");
}
if (!/Start-ElectronStudio[\s\S]*?Offer-ExportTools/.test(ps1) && !/Wait-StudioAnswering[\s\S]*?Offer-ExportTools/.test(ps1)) {
  bug("offer is not sequenced after studio start/wait helpers");
}

// Offer should only appear inside Launch-ThenOfferExportTools (plus its definition),
// not as a naked pre-launch call site.
const callSites = [...ps1.matchAll(/^\s*Offer-ExportTools\s*$/gm)];
if (callSites.length !== 1) {
  bug(`expected exactly 1 Offer-ExportTools call site, found ${callSites.length}`);
} else {
  const idx = ps1.indexOf("Offer-ExportTools\n");
  const alt = ps1.indexOf("Offer-ExportTools\r\n");
  const at = idx >= 0 ? idx : alt;
  const before = ps1.slice(Math.max(0, at - 200), at);
  if (!/Wait-StudioAnswering|Launch-ThenOfferExportTools/.test(before) && !before.includes("function Offer-ExportTools")) {
    // The single call should be after Wait-StudioAnswering inside Launch-ThenOfferExportTools
    const launchFn = ps1.match(/function Launch-ThenOfferExportTools \{[\s\S]*?\n\}/);
    if (!launchFn || !/Wait-StudioAnswering[\s\S]*Offer-ExportTools/.test(launchFn[0])) {
      bug("Offer-ExportTools call is not after Wait-StudioAnswering in Launch-ThenOfferExportTools");
    }
  }
}

const launchFn = ps1.match(/function Launch-ThenOfferExportTools \{[\s\S]*?\n\}/);
if (!launchFn) {
  bug("could not parse Launch-ThenOfferExportTools");
} else if (!/Start-ElectronStudio[\s\S]*Wait-StudioAnswering[\s\S]*Offer-ExportTools/.test(launchFn[0])) {
  bug("Launch-ThenOfferExportTools must Start → Wait → Offer (got wrong order)");
} else {
  console.log("ok   Launch-ThenOfferExportTools order: Start → Wait → Offer");
}

// C# launcher still asks after StudioAnswering
const cs = fs.readFileSync(path.join(studioRoot, "scripts", "launcher", "Launcher.cs"), "utf8");
if (!/if \(Studio\.StudioAnswering\(\)\) Setup\.OfferExportToolsOnce\(\)/.test(cs)) {
  bug("Launcher.cs lost after-studio OfferExportToolsOnce");
} else {
  console.log("ok   Illustrated IF Studio.exe still offers after StudioAnswering");
}

console.log("\nlaunch-studio order smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
