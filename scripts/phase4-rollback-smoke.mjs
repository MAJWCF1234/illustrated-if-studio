/**
 * Phase 4 smoke: rollback (Back) + skip-read in the HTML player.
 */
import { chromium } from "playwright";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PHASE4_ROLLBACK_PORT) || 8796;
const base = `http://127.0.0.1:${port}`;
const bugs = [];
const bug = (m) => {
  bugs.push(m);
  console.log("BUG:", m);
};

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(studioRoot, "server", "index.mjs")], {
      cwd: studioRoot,
      env: {
        ...process.env,
        PORT: String(port),
        IF_PROJECT: path.join(studioRoot, "projects", "sample-project"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const onData = (buf) => {
      if (!ready && buf.toString().includes("Player")) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server exited early: ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error("server start timeout"));
    }, 10000);
  });
}

async function storyText(page) {
  return (await page.locator("#story-text").innerText()).trim();
}

async function clickChoice(page, label) {
  const btn = page.locator("#choices button.choice", { hasText: label });
  await btn.first().click();
  await page.waitForTimeout(150);
}

const server = await startServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => bug("pageerror: " + e.message));

try {
  await page.goto(`${base}/engine-html/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.fill("#player-name", "Skipper");
  await page.click('#gate-form button[type="submit"]');
  await page.waitForSelector("#novel:not([hidden])");

  const startStory = await storyText(page);
  if (!/tiny demo story/i.test(startStory)) bug("expected start scene text");

  // Back disabled on first scene
  const backDisabled = await page.locator("#btn-rollback").isDisabled();
  if (!backDisabled) bug("Back should be disabled on first scene");

  await clickChoice(page, "Step into the workshop");
  const lookStory = await storyText(page);
  if (!/brass key/i.test(lookStory)) bug("expected workshop scene");

  // Rollback to start
  await page.click("#btn-rollback");
  await page.waitForTimeout(200);
  const afterBack = await storyText(page);
  if (!/tiny demo story/i.test(afterBack)) bug("rollback did not return to start");
  const histLen = await page.evaluate(() => {
    const raw = localStorage.getItem("ifstudio:sample-project:history");
    return raw ? JSON.parse(raw).length : -1;
  });
  if (histLen !== 1) bug(`history length after rollback expected 1, got ${histLen}`);

  // Re-walk and remember a branch choice
  await clickChoice(page, "Step into the workshop");
  await clickChoice(page, "Read the notes on the wall");
  const midStory = await storyText(page);
  if (!/notes describe/i.test(midStory)) {
    bug("expected to reach archive after second choice");
  }

  // Soft rewind to start
  await page.click("#btn-rollback");
  await page.waitForTimeout(120);
  await page.click("#btn-rollback");
  await page.waitForTimeout(120);
  if (!/tiny demo story/i.test(await storyText(page))) bug("double rollback should reach start");

  // Skip read should auto-advance through seen scenes using remembered choices
  await page.click("#btn-skip");
  await page.waitForTimeout(800);
  const skippedStory = await storyText(page);
  if (/tiny demo story/i.test(skippedStory)) bug("skip-read did not leave start");
  const skipPressed = await page.locator("#btn-skip").getAttribute("aria-pressed");
  // Either still skipping through a chain, or stopped at a branch/unread with toggle off
  console.log("After skip, story:", skippedStory.slice(0, 80).replace(/\s+/g, " "));
  console.log("Skip aria-pressed:", skipPressed);

  // Review path jump should not duplicate history
  await page.click("#btn-history");
  await page.waitForSelector(".history-item");
  const beforeJump = await page.evaluate(() => {
    const raw = localStorage.getItem("ifstudio:sample-project:history");
    return raw ? JSON.parse(raw).length : -1;
  });
  await page.locator(".history-item button", { hasText: "Return to this point" }).first().click();
  await page.waitForTimeout(200);
  const afterJump = await page.evaluate(() => {
    const raw = localStorage.getItem("ifstudio:sample-project:history");
    return raw ? JSON.parse(raw).length : -1;
  });
  if (afterJump !== 1) bug(`history jump to first beat should leave length 1, got ${afterJump} (was ${beforeJump})`);
  if (!/tiny demo story/i.test(await storyText(page))) bug("history jump did not show start");

  console.log("Phase4 rollback/skip smoke OK");
} catch (err) {
  bug(String(err.message || err));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

console.log("\nPhase4 rollback smoke bugs:", bugs.length);
for (const b of bugs) console.log("-", b);
process.exit(bugs.length ? 1 : 0);
