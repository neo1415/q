#!/usr/bin/env node
/**
 * Builds the Capital Q user guide from docs/guide/guide.src.html and the
 * screenshots capture.mjs wrote.
 *
 *   node scripts/handoff/docs/build.mjs --shots /tmp/guide-shots [--out docs/guide]
 *
 * Writes capital-q-guide.html (one self-contained file, images embedded as
 * JPEG data URIs) and capital-q-guide.pdf (A4, printed by Chromium with page
 * numbers). In the source, a screenshot is written as
 *
 *   <shot id="inv-discover" caption="The Discover feed" marks="1:Save,2:Interest"></shot>
 *
 * `marks` puts numbered dots on the picture: each entry is n:text, and the
 * dot sits on the first visible button, link or heading with that exact
 * accessible text, as recorded in the shot's marks file (see capture.mjs).
 * Headings <h2>/<h3> with an id feed the table of contents.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SHOTS = resolve(opt("--shots", "./guide-shots"));
const OUT = resolve(opt("--out", resolve(here, "../../../docs/guide")));
const SRC = resolve(
  opt("--src", resolve(here, "../../../docs/guide/guide.src.html")),
);
const QUALITY = Number(opt("--quality", "0.8"));

async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    "/home/user/q-int/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates)
    if (existsSync(c)) return (await import(pathToFileURL(c).href)).chromium;
  const require = createRequire(
    resolve(here, "../../../apps/web/package.json"),
  );
  return (await import(pathToFileURL(require.resolve("playwright")).href))
    .chromium;
}

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const chromium = await loadChromium();
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : existsSync("/opt/pw-browsers/chromium")
      ? { executablePath: "/opt/pw-browsers/chromium" }
      : {}),
  args: ["--disable-gpu", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();

/** PNG -> JPEG data URI at 1440 px wide, re-encoded by the browser's canvas. */
async function jpeg(path) {
  const png = readFileSync(path).toString("base64");
  return page.evaluate(
    async ({ png, q }) => {
      const img = new window.Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const w = Math.min(1440, img.naturalWidth);
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      return { uri: cv.toDataURL("image/jpeg", q), w, h };
    },
    { png, q: QUALITY },
  );
}

let src = readFileSync(SRC, "utf8");
const missing = [];
const shotRe = /<shot\s+([^>]*)><\/shot>/g;
const attrs = (s) =>
  Object.fromEntries(
    [...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
const parts = [];
let lastIndex = 0;
let figNo = 0;
for (const m of src.matchAll(shotRe)) {
  parts.push(src.slice(lastIndex, m.index));
  lastIndex = m.index + m[0].length;
  const a = attrs(m[1]);
  const file = resolve(SHOTS, `${a.id}.png`);
  if (!existsSync(file)) {
    missing.push(a.id);
    parts.push(`<p class="missing">[Screenshot ${esc(a.id)} not captured]</p>`);
    continue;
  }
  figNo += 1;
  const { uri, w, h } = await jpeg(file);
  const marksFile = resolve(SHOTS, `${a.id}.marks.json`);
  const boxes = existsSync(marksFile)
    ? JSON.parse(readFileSync(marksFile, "utf8"))
    : {};
  const dots = (a.marks ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((entry) => {
      const [n, ...rest] = entry.split(":");
      const box = boxes[rest.join(":")];
      if (!box) return "";
      // Top-left corner of the control, so the dot points at it without hiding its label.
      const left = ((box.x + 2) / 1440) * 100;
      const top = ((box.y + 2) / 900) * 100;
      return `<span class="dot" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%">${esc(n)}</span>`;
    })
    .join("");
  parts.push(
    `<figure class="shot"><div class="frame">` +
      `<img src="${uri}" width="${w}" height="${h}" alt="${esc(a.caption ?? a.id)}" loading="lazy">${dots}</div>` +
      `<figcaption><b>Figure ${figNo}.</b> ${esc(a.caption ?? "")}</figcaption></figure>`,
  );
}
parts.push(src.slice(lastIndex));
let html = parts.join("");

// Table of contents from <h2 id> and <h3 id class="toc">.
const toc = [
  ...html.matchAll(
    /<h2 id="([^"]+)"[^>]*>(.*?)<\/h2>|<h3 id="([^"]+)" class="toc"[^>]*>(.*?)<\/h3>/g,
  ),
].map((m) =>
  m[1]
    ? `<li><a href="#${m[1]}">${m[2]}</a>`
    : `<li class="sub"><a href="#${m[3]}">${m[4]}</a>`,
);
html = html.replace(
  "<!--TOC-->",
  `<ol class="toc-list">${toc.join("</li>")}</li></ol>`,
);
html = html.replace("<!--BUILT-->", new Date().toISOString().slice(0, 10));

const htmlOut = resolve(OUT, "capital-q-guide.html");
writeFileSync(htmlOut, html);
console.log(
  "html",
  htmlOut,
  (statSync(htmlOut).size / 1e6).toFixed(1),
  "MB",
  figNo,
  "figures",
  missing.length ? `missing: ${missing.join(",")}` : "",
);

const pdfPage = await browser.newPage();
await pdfPage.goto(pathToFileURL(htmlOut).href, { waitUntil: "load" });
await pdfPage.evaluate(() =>
  Promise.all(
    [...document.images].map(
      (i) => ((i.loading = "eager"), i.decode().catch(() => {})),
    ),
  ),
);
const pdfOut = resolve(OUT, "capital-q-guide.pdf");
await pdfPage.pdf({
  path: pdfOut,
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
  displayHeaderFooter: true,
  headerTemplate: `<div style="font:8px Helvetica,Arial,sans-serif;color:#777;width:100%;padding:0 16mm;text-align:right">Capital Q: a guide to every feature</div>`,
  footerTemplate: `<div style="font:8px Helvetica,Arial,sans-serif;color:#777;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
});
console.log("pdf", pdfOut, (statSync(pdfOut).size / 1e6).toFixed(1), "MB");
await browser.close();
