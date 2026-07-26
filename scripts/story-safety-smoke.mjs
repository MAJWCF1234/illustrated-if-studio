import { chromium } from "playwright";

const base = process.env.STUDIO_URL || "http://127.0.0.1:8787";
const bugs = [];
const bug = (message) => {
  bugs.push(message);
  console.log("BUG:", message);
};
const ok = (message) => console.log("ok  ", message);

await fetch(`${base}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ activeProjectId: "sample-project" }),
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (error) => bug(`page error: ${error.message}`));

await page.goto(`${base}/editor-web/`, { waitUntil: "networkidle" });
await page.waitForSelector('#scene-list li[data-id="start"]');
await page.locator('#scene-list li[data-id="start"]').click();
await page.click('[data-insp="actions"]');

// Action labels must remain meaningful: a blank value is restored instead of
// saving an invisible choice the player cannot understand.
const firstActionLabel = page.locator('.action-card [data-k="text"]').first();
const originalLabel = await firstActionLabel.inputValue();
await firstActionLabel.fill("");
await firstActionLabel.press("Tab");
if ((await firstActionLabel.inputValue()) !== originalLabel) {
  bug("blank action label was accepted");
} else {
  ok("blank action label is restored");
}

// Targets are a real select list, not a free-text field that can create a
// broken scene link.
const targets = page.locator('.action-card [data-k="next"]');
const firstTargetValues = await targets.first().locator("option").evaluateAll((options) => options.map((option) => option.value));
if (firstTargetValues.includes("")) bug("action target offers a blank/broken option");
else ok("action targets only offer real scenes");

// A scene with inbound choices cannot be deleted. This blocks a destructive
// click before it can clear other scenes' links.
await page.locator('#scene-list li[data-id="workshop"]').click();
await page.click("#btn-delete");
if (!(await page.locator('#scene-list li[data-id="workshop"]').count())) {
  bug("in-use scene was deleted");
} else if (!/Remove those links first/.test(await page.locator("#toast").innerText())) {
  bug("in-use scene deletion did not explain how to recover");
} else {
  ok("in-use scene deletion is blocked with recovery guidance");
}

// Dismissing a graph-link confirmation leaves the story exactly as it was.
await page.locator('#scene-list li[data-id="start"]').click();
let sawLinkConfirm = false;
page.once("dialog", async (dialog) => {
  sawLinkConfirm = /Add a player choice/.test(dialog.message());
  await dialog.dismiss();
});
const port = await page.locator('g.node[data-id="start"] .port').boundingBox();
const destination = await page.locator('g.node[data-id="ending"]').boundingBox();
if (!port || !destination) {
  bug("graph nodes were not available for link safety test");
} else {
  const beforeCount = await page.locator('.action-card').count();
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterCount = await page.locator('.action-card').count();
  if (!sawLinkConfirm) bug("graph link did not require confirmation");
  else if (afterCount !== beforeCount) bug("dismissed graph link still changed actions");
  else ok("dismissed graph link leaves actions unchanged");
}

// A player must always have a way out of the opening scene, even if someone
// repeatedly clicks Remove while experimenting with its actions.
while ((await page.locator('.action-card [data-act="del"]').count()) > 1) {
  await page.locator('.action-card [data-act="del"]').first().click();
}
await page.locator('.action-card [data-act="del"]').first().click();
if ((await page.locator('.action-card [data-act="del"]').count()) !== 1) {
  bug("start scene was allowed to become a dead end");
} else if (!/needs at least one action/.test(await page.locator("#toast").innerText())) {
  bug("last start action guard did not explain why it was blocked");
} else {
  ok("start scene cannot become a dead end");
}

await browser.close();

console.log("\nStory safety bugs:", bugs.length);
bugs.forEach((message) => console.log("-", message));
process.exit(bugs.length ? 1 : 0);
