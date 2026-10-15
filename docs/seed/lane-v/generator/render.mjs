// node render.mjs <jobs.json> — HTML → PDF in one local Chromium (no network).
import { existsSync, readFileSync } from "node:fs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs"
);
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
let n = 0;
for (const j of jobs) {
  if (existsSync(j.pdf) && !process.env.FORCE) continue;
  await page.goto(`file://${j.html}`);
  await page.pdf(
    j.deck
      ? { path: j.pdf, width: "297mm", height: "167mm", printBackground: true }
      : { path: j.pdf, format: "A4", printBackground: true },
  );
  n += 1;
}
console.log("rendered", n);
await browser.close();
