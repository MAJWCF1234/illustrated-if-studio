import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const importedId = "cli-import-test";
const sampleStoryPath = path.join(studioRoot, "projects", "sample-project", "story", "scenes.json");
const sampleThemePath = path.join(studioRoot, "projects", "sample-project", "theme", "theme.json");
const originalStoryRaw = fs.readFileSync(sampleStoryPath, "utf8");
const originalThemeRaw = fs.readFileSync(sampleThemePath, "utf8");
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

// The assertions below expect the sample project to be active. Pin it rather
// than inheriting whatever project an earlier smoke left selected.
await fetch(`${base}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
});

const originalProject = await (await fetch(`${base}/api/project`)).json();
const originalStory = originalProject.scenes;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));
page.on("response", (r) => {
  // Ignore known missing-art content gaps (104 missing scene images).
  if (r.status() >= 400 && !/\/assets\/(scene_images|characters)\//.test(r.url())) {
    bug(`HTTP ${r.status()} ${r.url()}`);
  }
});

await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle" });
await page.click("#mode-cli");
await page.waitForSelector("#workspace-cli:not([hidden])");

// The command deck teaches without making a change until the creator presses
// Run, and Tab fills the first matching real command.
await page.getByRole("button", { name: "add scene attic", exact: true }).click();
if ((await page.inputValue("#cli-input")) !== "add scene attic") bug("command deck ran instead of loading an example");
await page.fill("#cli-input", "se");
await page.press("#cli-input", "Tab");
if ((await page.inputValue("#cli-input")) !== "select ") bug("Tab did not complete select command");
await page.fill("#cli-input", "");

async function run(cmd) {
  const before = await page.locator("#cli-out .cli-line").count();
  await page.fill("#cli-input", cmd);
  await page.click('#cli-form button[type="submit"]');
  // wait for at least the echoed command + a response line
  await page.waitForFunction(
    (n) => document.querySelectorAll("#cli-out .cli-line").length > n + 1,
    before,
    { timeout: 15000 }
  );
  await page.waitForTimeout(150);
  const lines = await page.locator("#cli-out .cli-line").allInnerTexts();
  return lines.slice(before).join("\n");
}

// help
let out = await run("help");
if (!/Illustrated IF Studio CLI/.test(out)) bug("help missing header");

// status
out = await run("status");
if (!/sample-project/.test(out)) bug("status missing active project");

// projects
out = await run("projects");
if (!/\* sample-project/.test(out)) bug("projects missing active marker");

// scenes
out = await run("scenes");
if (!/6 scenes/.test(out) || !/start=start/.test(out)) bug("scenes count/start wrong: " + out);

// scene peek
out = await run("scene start");
if (!/# start/.test(out) || !/Step into the workshop/.test(out)) bug("scene start peek wrong");

out = await run("scene nope_missing");
if (!/No scene/.test(out)) bug("missing scene not reported");

// Console authoring commands: create, write, and link a small playable beat.
// Restore the exact fixture immediately afterward so this test remains safe to
// run against a developer's ordinary sample project.
out = await run("add scene cli_attic");
if (!/\[CREATED\] Scene: cli_attic/.test(out) || !/\[SAVED\]/.test(out)) bug("add scene failed: " + out);

out = await run('write cli_attic "Rain rattles the attic window."');
if (!/\[WROTE\] cli_attic/.test(out) || !/\[SAVED\]/.test(out)) bug("write scene failed: " + out);

out = await run('choice start "Climb to the attic" -> cli_attic');
if (!/\[LINKED\] start -> cli_attic/.test(out) || !/\[SAVED\]/.test(out)) bug("choice link failed: " + out);

out = await run("select cli_attic");
if (!/\[FOCUS\] Scene: cli_attic/.test(out)) bug("select scene failed: " + out);

const restore = await fetch(`${base}/api/scenes`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ start: originalStory.start, scenes: originalStory.scenes }),
});
if (!restore.ok) bug("could not restore sample story after CLI authoring test");

// dest get
out = await run("dest");
if (!/resolved/.test(out)) bug("dest get failed");

// dest set + verify
const testDest = path.join(studioRoot, "dist", "cli-test-dest");
out = await run(`dest ${testDest}`);
if (!/Destination set/.test(out) || !/cli-test-dest/.test(out)) bug("dest set failed: " + out);

// export raw to that dest
out = await run("export raw");
if (!/Exported raw/.test(out) || !/cli-test-dest/.test(out)) bug("export raw did not use saved dest: " + out);

// export raw with inline --dest flag
const testDest2 = path.join(studioRoot, "dist", "cli-test-dest2");
out = await run(`export raw --dest ${testDest2}`);
if (!/cli-test-dest2/.test(out)) bug("export raw --dest inline failed: " + out);

// export html (zip)
out = await run("export html");
if (!/Exported html/.test(out) && !/Export/.test(out)) bug("export html failed: " + out);

// import folder round-trip from cli-test-dest2/sample-project
out = await run(`import folder "${path.join(testDest2, "sample-project")}" --id ${importedId} --overwrite`);
if (!new RegExp(importedId).test(out)) bug("import folder failed: " + out);

// verify it appears + active switched
out = await run("projects");
if (!new RegExp(importedId).test(out)) bug("imported project not listed");

// switch back
out = await run("use sample-project");
if (!/sample-project/.test(out)) bug("use switch failed: " + out);

// unknown command
out = await run("frobnicate");
if (!/Unknown command/.test(out)) bug("unknown command not handled");

// npm helper
out = await run("npm");
if (!/npm run playtest/.test(out)) bug("npm helper missing");

// reset dest to default
await run("dest clear");

await browser.close();

// Synchronous teardown only: an HTTP request still settling when process.exit()
// runs trips a libuv assertion on Windows. "use sample-project" above already
// restored the active project. Saving through the editor normalizes JSON
// formatting, so restore the exact fixture bytes as well as its data.
fs.writeFileSync(sampleStoryPath, originalStoryRaw);
fs.writeFileSync(sampleThemePath, originalThemeRaw);
fs.rmSync(path.join(studioRoot, "projects", importedId), { recursive: true, force: true });
fs.rmSync(testDest, { recursive: true, force: true });
fs.rmSync(testDest2, { recursive: true, force: true });

console.log("\nCLI tab smoke bugs:", bugs.length);
bugs.forEach((b) => console.log("-", b));
process.exit(bugs.length ? 1 : 0);
