// Print the HTML sources from build_html.py to PDF with Chromium.
// Usage: node print_pdfs.mjs <html_dir> <out_dir>
// The deck is 1280x720 per page with the watermark drawn in each slide;
// the A4 summaries flow across pages and carry it in the page footer.
import { readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";

const WATERMARK =
  "DEMONSTRATION DOCUMENT — illustrative, prepared for the Capital Q product demo. Not a legal or financial record.";
const FOOTER = `<div style="width:100%;margin:0 10mm;padding:2.6mm 4mm;background:#16140f;color:#e2b858;font-family:Inter,sans-serif;font-size:7.6pt;font-weight:600;display:flex;justify-content:space-between;-webkit-print-color-adjust:exact"><span>${WATERMARK}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [htmlDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
const browser = await chromium.launch({
  executablePath: process.env.CQ_CHROMIUM_PATH ?? undefined,
});
const page = await browser.newPage();
for (const file of readdirSync(htmlDir).filter((f) => f.endsWith(".html"))) {
  await page.goto(`file://${join(htmlDir, file)}`);
  await page.evaluate(() => document.fonts.ready);
  const deck = file.includes("pitch-deck");
  await page.pdf({
    path: join(outDir, `${basename(file, ".html")}.pdf`),
    printBackground: true,
    ...(deck
      ? { width: "1280px", height: "720px" }
      : {
          format: "A4",
          margin: { top: "20mm", bottom: "22mm", left: "0", right: "0" },
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: FOOTER,
        }),
  });
}
await browser.close();
