/**
 * Export destinations: block system trees, allow everyday folders.
 *
 * Exporters clear their target folder before writing, so a destination inside a
 * system tree is a delete-and-overwrite there. The guard has to be strict about
 * those and relaxed about Desktop/Documents, or it blocks normal use instead.
 */
import path from "node:path";
import os from "node:os";
import { describeUnsafeDestination } from "../server/lib/settings.mjs";

const home = os.homedir();
const allow = [
  path.join(home, "Desktop"),
  path.join(home, "Desktop", "My Games"),
  path.join(home, "Documents", "Illustrated IF"),
  path.join(home, "Downloads"),
  home,
  "D:\\illustrated-if-studio\\dist",
  "D:\\Games\\my-story",
  "E:\\",
].filter(Boolean);

const block = [
  "C:\\Windows",
  "C:\\Windows\\System32",
  "C:\\Windows\\System32\\drivers",
  "C:\\Program Files",
  "C:\\Program Files (x86)\\Something",
  "C:\\ProgramData",
  "C:\\Users",
  "C:\\",
  "D:\\",
];

let bad = 0;
console.log("Should be ALLOWED:");
for (const p of allow) {
  const reason = describeUnsafeDestination(p);
  // A bare drive root is expected to be refused even in this list.
  const expectBlocked = path.parse(path.resolve(p)).root === path.resolve(p);
  const ok = expectBlocked ? Boolean(reason) : !reason;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${p}${reason ? "  -> " + reason.slice(0, 60) : ""}`);
}

console.log("\nShould be BLOCKED:");
for (const p of block) {
  const reason = describeUnsafeDestination(p);
  if (!reason) bad++;
  console.log(`  ${reason ? "ok  " : "FAIL"} ${p}${reason ? "" : "  -> allowed!"}`);
}

console.log("\nMisclassifications:", bad);
process.exit(bad ? 1 : 0);
