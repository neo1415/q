// Renders a list of jobs (HTML/SVG file -> PNG/JPEG/PDF) in ONE Chromium process.
// Usage: node render.mjs jobs.json
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  chromium,
} = require("/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright");

const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = await chromium
  .launch({ args: ["--allow-file-access-from-files"] })
  .catch(() =>
    chromium.launch({
      executablePath: "/opt/pw-browsers/chromium",
      args: ["--allow-file-access-from-files"],
    }),
  );
const page = await browser.newPage();
let n = 0;
for (const j of jobs) {
  await page.setViewportSize({ width: j.w, height: j.h });
  await page.goto("file://" + j.src, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  if (j.kind === "pdf") {
    await page.pdf({
      path: j.out,
      width: j.pw || `${j.w}px`,
      height: j.ph || `${j.h}px`,
      printBackground: true,
      preferCSSPageSize: !!j.css,
      displayHeaderFooter: !!j.footer,
      headerTemplate: "<span></span>",
      footerTemplate: j.footer || "<span></span>",
    });
  } else {
    await page.screenshot({
      path: j.out,
      type: j.kind === "jpg" ? "jpeg" : "png",
      quality: j.kind === "jpg" ? 90 : undefined,
      omitBackground: !!j.transparent,
      clip: { x: 0, y: 0, width: j.w, height: j.h },
    });
  }
  n++;
}
await browser.close();
console.log(`rendered ${n} jobs`);
