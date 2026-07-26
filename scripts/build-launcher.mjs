#!/usr/bin/env node
/**
 * Build "Illustrated IF Studio.exe" — the double-click launcher that lives in the
 * studio root.
 *
 * Uses the C# compiler that ships inside Windows (.NET Framework 4.x), so there is
 * nothing to install and the resulting .exe runs on any Windows 10/11 machine with
 * no runtime of its own.
 *
 *   npm run build:launcher
 *
 * Also writes scripts/launcher/icon.ico from the same void-violet mark as the
 * Electron window icon.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcDir = path.join(here, "launcher");
const exeName = "Illustrated IF Studio.exe";

// ---------------------------------------------------------------- icon pixels

/** Void-violet disc with a block "IF" mark, drawn at any size. */
function renderRGBA(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 256;
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const rect = (x0, y0, w, h, r, g, b) => {
    const X0 = Math.round(x0 * s);
    const Y0 = Math.round(y0 * s);
    const X1 = Math.max(X0 + 1, Math.round((x0 + w) * s));
    const Y1 = Math.max(Y0 + 1, Math.round((y0 + h) * s));
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) set(x, y, r, g, b);
  };

  rect(0, 0, 256, 256, 5, 2, 8);

  const c = size / 2;
  const rad = 108 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d > rad + 1) continue;
      const t = Math.min(1, d / rad);
      const edge = Math.max(0, Math.min(1, rad + 0.5 - d)); // cheap antialias
      const R = Math.round(88 + (168 - 88) * (1 - t));
      const G = Math.round(28 + (85 - 28) * (1 - t));
      const B = Math.round(135 + (247 - 135) * (1 - t));
      const i = (y * size + x) * 4;
      px[i] = Math.round(px[i] * (1 - edge) + R * edge);
      px[i + 1] = Math.round(px[i + 1] * (1 - edge) + G * edge);
      px[i + 2] = Math.round(px[i + 2] * (1 - edge) + B * edge);
      px[i + 3] = 255;
    }
  }

  const ink = [243, 232, 255];
  rect(78, 70, 28, 116, ...ink);
  rect(70, 70, 44, 22, ...ink);
  rect(70, 164, 44, 22, ...ink);
  rect(130, 70, 28, 116, ...ink);
  rect(130, 70, 70, 22, ...ink);
  rect(130, 118, 54, 22, ...ink);
  return px;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function toPNG(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 32-bit bottom-up DIB + empty AND mask, the classic ICO payload. */
function toDIB(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  header.writeUInt32LE(xor.length + mask.length, 20);
  return Buffer.concat([header, xor, mask]);
}

function buildIco(sizes) {
  const images = sizes.map((size) => {
    const rgba = renderRGBA(size);
    return { size, data: size >= 256 ? toPNG(rgba, size) : toDIB(rgba, size) };
  });
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map((img) => {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

// ------------------------------------------------------------------ compiler

function findCsc() {
  const roots = [
    process.env.WINDIR ? path.join(process.env.WINDIR, "Microsoft.NET", "Framework64") : null,
    process.env.WINDIR ? path.join(process.env.WINDIR, "Microsoft.NET", "Framework") : null,
  ].filter(Boolean);
  const found = [];
  for (const base of roots) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base)) {
      const csc = path.join(base, entry, "csc.exe");
      if (fs.existsSync(csc)) found.push({ csc, version: entry });
    }
  }
  found.sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }));
  return found.length ? found[0].csc : null;
}

function main() {
  if (process.platform !== "win32") {
    console.error("The launcher .exe can only be built on Windows. Skipping.");
    process.exit(1);
  }

  const icoPath = path.join(srcDir, "icon.ico");
  fs.writeFileSync(icoPath, buildIco([16, 24, 32, 48, 64, 128, 256]));
  console.log("icon  ", path.relative(root, icoPath), fs.statSync(icoPath).size, "bytes");

  const csc = findCsc();
  if (!csc) {
    console.error("No C# compiler found under %WINDIR%\\Microsoft.NET. Install the .NET Framework 4 feature.");
    process.exit(1);
  }
  console.log("csc   ", csc);

  const out = path.join(root, exeName);
  const args = [
    "/nologo",
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    "/warn:4",
    "/out:" + out,
    "/win32icon:" + icoPath,
    "/win32manifest:" + path.join(srcDir, "app.manifest"),
    "/reference:System.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Windows.Forms.dll",
    path.join(srcDir, "Launcher.cs"),
  ];

  try {
    const log = execFileSync(csc, args, { cwd: root, encoding: "utf8" });
    if (log.trim()) console.log(log.trim());
  } catch (err) {
    console.error(String(err.stdout || "") + String(err.stderr || ""));
    process.exit(1);
  }

  console.log("built  " + exeName + "  " + fs.statSync(out).size + " bytes");
}

main();
