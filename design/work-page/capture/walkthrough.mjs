// Records the Work page walkthrough (WebM), then the caller converts it to MP4.
// node design/work-page/capture/walkthrough.mjs
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const raw = join(site, "deliverables", ".raw");
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

// Served over http so the phone frames are same-origin with the stage.
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(site)) return res.writeHead(403).end();
  let body;
  try {
    body = readFileSync(path);
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  res.end(body);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const pwPath =
  process.env.PLAYWRIGHT_PATH ??
  "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(pwPath).href);
const browser = await chromium.launch({
  executablePath: process.env.CQ_CHROMIUM ?? "/opt/pw-browsers/chromium",
});
const size = { width: 1440, height: 900 };
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: raw, size },
});
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const url = (file, q) => `${origin}/${file}?${q}`;
const go = async (q, file = "index.html") => {
  await page.goto(url(file, q));
  await wait(150);
};
const cap = (text, sub = "") =>
  page.evaluate(([t, s]) => window.cq.setCaption(t, s), [text, sub]);
const hover = async (sel, steps = 8) => {
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
};
const click = async (sel) => {
  await hover(sel);
  await wait(250);
  await page.locator(sel).first().click();
};

// 1. Before and after
await go("view=compare");
await cap("Proposal: the Workspace folder becomes one Work entry", "Sidebar today (left) and proposed (right)");
await wait(3000);

// 2. Sidebar entries, hover and active
await go("tab=tasks");
await cap("Sidebar: Discover · Explore · Q · CRM · Work", "Hover is a quiet fill; the open area keeps its accent bar and count");
for (const name of ["Discover", "Explore", "Q", "CRM", "Work"]) {
  await hover(`[data-nav="${name}"]`, 6);
  await wait(280);
}
await page.mouse.move(700, 60, { steps: 6 });
await wait(600);

// 3. Tasks and an approval
await cap("Work › Tasks (default)", "Give Q a task · what needs your yes · what runs · what's done");
await wait(2000);
await cap("Approving: the exact message Q will send", "Pending at once; “Approved” only after the server confirms");
await click("[data-approve]");
await wait(2000);
await cap("Done: it leaves Needs you and lands in Done", "Counts update on the tab and in the sidebar");
await page.mouse.wheel(0, 420);
await wait(1900);
await page.mouse.wheel(0, -420);
await wait(400);

// 4. Tab switch and the reader sheet
await cap("Tab switch: the underline slides (140 ms), content crossfades", "Each tab keeps its own address: /work · /documents · /rehearsals · /daily");
await wait(800);
await click('[data-tab="documents"]');
await wait(1800);
await cap("Work › Documents · opened in the in-app reader", "The sheet slides in from the right (360 ms)");
await click("[data-open-doc]");
await wait(2500);
await click("[data-close]");
await wait(900);

// 5. Rehearsals and The Q Daily
await cap("Work › Rehearsals", "Practice calls, what's left this month, past scores");
await click('[data-tab="rehearsals"]');
await wait(1900);
await cap("Work › The Q Daily", "Today's edition, every story sourced");
await click('[data-tab="daily"]');
await wait(2100);

// 6. Reduced motion
await go("tab=tasks&motion=reduced");
await cap("Reduced motion: tabs switch instantly", "No sliding, no crossfade; Q's work indicator stops moving");
await wait(900);
for (const t of ["documents", "rehearsals", "daily", "tasks"]) {
  await click(`[data-tab="${t}"]`);
  await wait(450);
}
await wait(500);

// 7. Founder: Pitch
await go("tab=tasks&role=founder");
await cap("Founder: Work adds a Pitch tab", "Pitch video, deck and data room in one place (/pitch)");
await wait(900);
await click('[data-tab="pitch"]');
await wait(2600);

// 8. States
await go("tab=tasks&state=empty");
await cap("Empty: one calm line and a Q prompt");
await wait(1200);
await click("[data-prompt]");
await wait(1000);
await go("tab=tasks&state=error");
await cap("Error: says what did not happen, offers Try again");
await wait(1600);
await cap("Loading: the strip stays; the content shows a skeleton", "Then the content arrives");
await click("[data-retry]");
await wait(2100);

// 9. Dark
await go("tab=tasks&theme=dark");
await cap("Dark: the sidebar turns black, gold accent", "Same tokens, Black and gold preset");
await wait(2200);

// 10. Phone
await go("", "phones.html");
await page.evaluate(() => document.body.classList.add("recording"));
await wait(600);
await cap("Phone: the Work tabs scroll sideways", "Bottom bar Discover · Explore · Q · CRM, then More or Work");
await wait(1800);
await page.evaluate(() => {
  const w = window.cq.frame("tabs");
  w.cq.switchTab("daily");
});
await wait(1000);
await page.evaluate(() => {
  const w = window.cq.frame("tabs");
  w.cq.switchTab("tasks");
});
await wait(800);
await cap("Option A: Work is the first item in More");
await page.evaluate(() => window.cq.frame("a").cq.openMore(false));
await wait(2400);
await cap("Option B: Work replaces More in the bar", "Profile and Settings move to the avatar");
await page.evaluate(() => window.cq.frame("a").cq.closeMore());
await wait(2400);
await cap("Decisions: approve one Work entry · choose phone option A or B");
await wait(2800);

await context.close();
await browser.close();
server.close();
const file = readdirSync(raw).find((f) => f.endsWith(".webm"));
renameSync(join(raw, file), join(site, "deliverables", "work-page-walkthrough.webm"));
rmSync(raw, { recursive: true, force: true });
console.log("recorded");
