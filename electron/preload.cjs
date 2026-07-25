/**
 * Preload bridge — keep Node out of the page; expose a tiny read-only marker.
 * CommonJS so Electron can load it under sandbox without ESM hassle.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("ifStudioDesktop", {
  isElectron: true,
  platform: process.platform,
});
