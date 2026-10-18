// Captures the Work page prototype's screens as PNGs.
// node design/work-page/capture/screens.mjs  (PLAYWRIGHT_PATH may point at playwright's index.mjs)
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "..");
const out = join(site, "deliverables", "screens");
mkdirSync(out, { recursive: true });

const pwPath =
  process.env.PLAYWRIGHT_PATH ??
  "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(pwPath).href);
const browser = await chromium.launch({
  executablePath: process.env.CQ_CHROMIUM ?? "/opt/pw-browsers/chromium",
});

const url = (file, q) => `${pathToFileURL(join(site, file)).href}?${q}`;
const desk = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

const shots = [
  ["01-desktop-tasks-investor-light", "index.html", "tab=tasks", desk],
  ["02-desktop-tasks-investor-dark", "index.html", "tab=tasks&theme=dark", desk],
  ["02b-desktop-tasks-founder-light", "index.html", "tab=tasks&role=founder", desk],
  ["03a-desktop-documents", "index.html", "tab=documents", desk],
  ["03b-desktop-documents-reader-open", "index.html", "tab=documents&reader=1", desk],
  ["04-desktop-pitch-founder", "index.html", "tab=pitch&role=founder", desk],
  ["04b-desktop-pitch-founder-dark", "index.html", "tab=pitch&role=founder&theme=dark", desk],
  ["05a-desktop-rehearsals", "index.html", "tab=rehearsals", desk],
  ["05b-desktop-q-daily", "index.html", "tab=daily", desk],
  ["06a-desktop-tasks-empty", "index.html", "tab=tasks&state=empty", desk],
  ["06b-desktop-tasks-loading", "index.html", "tab=tasks&state=loading&motion=reduced", desk],
  ["06c-desktop-tasks-error", "index.html", "tab=tasks&state=error", desk],
  ["07a-phone-tabs-strip", "index.html", "tab=documents&nav=a", phone],
  ["07b-phone-option-a-more-sheet", "index.html", "tab=tasks&nav=a&sheet=more", phone],
  ["07c-phone-option-b-work-in-bar", "index.html", "tab=tasks&nav=b", phone],
  ["07d-phone-founder-pitch", "index.html", "tab=pitch&role=founder&nav=a", phone],
  ["07e-phones-side-by-side", "phones.html", "", desk],
  ["08a-sidebar-before-after-investor", "index.html", "view=compare", { width: 1440, height: 900 }],
  ["08b-sidebar-before-after-founder", "index.html", "view=compare&role=founder", { width: 1440, height: 900 }],
];

for (const [name, file, q, viewport] of shots) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: viewport.width < 500 ? 2 : 1,
  });
  await page.goto(url(file, q));
  await page.waitForTimeout(file === "phones.html" ? 900 : 350);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.close();
  console.log("shot", name);
}
await browser.close();
