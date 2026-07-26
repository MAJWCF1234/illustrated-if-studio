#!/usr/bin/env node
/**
 * Save-slot shape hardening (hermetic — no server).
 *
 * A slot is written from whatever the player/editor sends and can also be
 * hand-edited on disk, so the writer must normalize every field and the loader
 * must not choke on a bad one. Arrays are objects in JS, which is the trap here:
 * `vars: [1,2,3]` must not survive as numeric-keyed junk, and a non-string or
 * giant label must not reach the slot-list UI verbatim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeSaveSlot, readSaveSlot } from "../server/lib/saves.mjs";
import { applySnapshot } from "../engine-html/js/saves.js";

let failed = 0;
const ok = (m) => console.log("  ok  ", m);
const bad = (m) => {
  failed++;
  console.log("  FAIL", m);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "if-saves-"));
try {
  // --- writer coercion ---
  let r = writeSaveSlot(dir, "1", { currentScene: "start", vars: [1, 2, 3] });
  Array.isArray(r.save.vars) ? bad(`vars array survived: ${JSON.stringify(r.save.vars)}`) : ok("vars array -> plain object");
  Object.keys(r.save.vars).length === 0 ? ok("vars array became {}") : bad(`vars array became ${JSON.stringify(r.save.vars)}`);

  r = writeSaveSlot(dir, "2", { currentScene: "start", label: { evil: true } });
  typeof r.save.label === "string" ? ok(`object label -> string ${JSON.stringify(r.save.label)}`) : bad("object label not a string");

  r = writeSaveSlot(dir, "2", { currentScene: "start", label: "L".repeat(9999) });
  r.save.label.length <= 120 ? ok(`huge label capped to ${r.save.label.length}`) : bad(`label uncapped ${r.save.label.length}`);

  r = writeSaveSlot(dir, "3", { currentScene: "start", abilities: ["fly", 5, null, "swim"] });
  JSON.stringify(r.save.abilities) === '["fly","swim"]' ? ok("abilities filtered to strings") : bad(`abilities ${JSON.stringify(r.save.abilities)}`);

  r = writeSaveSlot(dir, "4", { currentScene: "start", history: ["not", { id: "a", choice: "x" }, ["nested"]] });
  r.save.history.length === 1 && r.save.history[0].id === "a" ? ok("history keeps only object beats") : bad(`history ${JSON.stringify(r.save.history)}`);

  // __proto__ in vars must not pollute Object.prototype
  r = writeSaveSlot(dir, "5", { currentScene: "start", vars: JSON.parse('{"__proto__":{"polluted":1}}') });
  ({}).polluted ? bad("PROTOTYPE POLLUTION via vars.__proto__") : ok("no prototype pollution via vars");

  for (const s of ["0", "6", "abc", "../1", ""]) {
    const rr = writeSaveSlot(dir, s, { currentScene: "start" });
    rr.ok ? bad(`bogus slot "${s}" accepted`) : ok(`bogus slot "${s}" rejected`);
  }

  // readback stays valid JSON
  const rb = readSaveSlot(dir, "1");
  rb.ok && rb.save.formatVersion === 1 ? ok("slot 1 reads back clean") : bad(`readback ${JSON.stringify(rb)}`);

  // --- loader (applySnapshot) hardening: array vars / bad shapes ---
  const st = {};
  applySnapshot(st, { currentScene: "s", vars: [9, 8], abilities: ["a", 1], history: ["x", { id: "b" }] });
  !Array.isArray(st.vars) && Object.keys(st.vars).length === 0 ? ok("applySnapshot array vars -> {}") : bad(`applySnapshot vars ${JSON.stringify(st.vars)}`);
  JSON.stringify(st.abilities) === '["a"]' ? ok("applySnapshot abilities filtered") : bad(`applySnapshot abilities ${JSON.stringify(st.abilities)}`);
  st.history.length === 1 ? ok("applySnapshot history filtered") : bad(`applySnapshot history ${JSON.stringify(st.history)}`);

  applySnapshot(st, null);
  st.currentScene === "start" && Object.keys(st.vars).length === 0 ? ok("applySnapshot(null) safe defaults") : bad("applySnapshot(null) unsafe");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nSaves hardening smoke bugs: ${failed}`);
process.exit(failed ? 1 : 0);
