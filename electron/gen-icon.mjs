#!/usr/bin/env node
/** Write electron/icon.png — void-violet square with IF mark (no deps). */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const size = 256;
const rgba = Buffer.alloc(size * size * 4);

function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

function fillRect(x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPx(x, y, r, g, b);
  }
}

// Background #050208
fillRect(0, 0, size, size, 5, 2, 8);
// Soft purple disc
const cx = size / 2;
const cy = size / 2;
const rad = 108;
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= rad) {
      const t = d / rad;
      const R = Math.round(88 + (168 - 88) * (1 - t));
      const G = Math.round(28 + (85 - 28) * (1 - t));
      const B = Math.round(135 + (247 - 135) * (1 - t));
      setPx(x, y, R, G, B);
    }
  }
}
// Simple block "IF"
fillRect(78, 70, 28, 116, 243, 232, 255); // I stem
fillRect(70, 70, 44, 22, 243, 232, 255); // I top
fillRect(70, 164, 44, 22, 243, 232, 255); // I bottom
fillRect(130, 70, 28, 116, 243, 232, 255); // F stem
fillRect(130, 70, 70, 22, 243, 232, 255); // F top
fillRect(130, 118, 54, 22, 243, 232, 255); // F mid

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

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
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(dir, "icon.png");
fs.writeFileSync(out, png);
console.log("Wrote", out, png.length, "bytes");
