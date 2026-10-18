// Flagship investor-deck builder: HTML (one <section> per 1280x720 slide) -> Chromium print -> PDF.
// Offline only: no network, no provider calls. Fonts are local OFL files in ./fonts or system fonts.
// Follows the docs/seed/tavus-20/generator/assets approach (HTML then Chromium print to 1280x720 PDF).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "../../../..");
const PW =
  "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright";
const PDFLIB =
  "/home/user/q/node_modules/.pnpm/pdf-lib@1.17.1/node_modules/pdf-lib";

/** Escape text for HTML. Content modules call this for every fact string. */
export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Status vocabulary shared by all four decks (matches research.md / facts.json). */
export const STATUS = {
  VP: { key: "VERIFIED_PUBLIC", label: "Verified public" },
  SR: { key: "SELF_REPORTED", label: "Self-reported" },
  OP: { key: "OWNER_PROVIDED", label: "Owner-provided" },
  AS: { key: "ASSUMPTION", label: "Assumption" },
  UN: { key: "UNKNOWN", label: "Unknown" },
  PT: { key: "SELF_REPORTED", label: "Published testimonial" },
};

/** Inline status marker: text, not colour alone. */
export const st = (code, extra = "") =>
  `<span class="st st-${code}">${esc(STATUS[code].label)}${extra ? ` · ${esc(extra)}` : ""}</span>`;

/** @font-face block for local OFL fonts, path relative to the HTML file's folder. */
export function fontFaces(htmlDir, faces) {
  return faces
    .map(([family, file, weight = 400, style = "normal"]) => {
      const rel = relative(htmlDir, join(HERE, "fonts", file));
      return `@font-face{font-family:"${family}";src:url("${rel}");font-weight:${weight};font-style:${style};font-display:block}`;
    })
    .join("\n");
}

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1280px 720px;margin:0}
html,body{width:1280px;background:#777}
.slide{width:1280px;height:720px;position:relative;overflow:hidden;page-break-after:always;break-after:page}
.slide:last-child{page-break-after:auto;break-after:auto}
ul{list-style:none}
table{border-collapse:collapse}
`;

/**
 * deck = { slug, company, title, lang?, fonts: [[family,file,weight,style]], css, slides: [{id,title,html,uses:[...]}],
 *          sources: [{label,url,fetched}], readme: {direction, notes:[...] , omitted:[...]}}
 */
export function writeHtml(deck) {
  const outDir = join(REPO, "docs/flagship", deck.slug, "deck");
  mkdirSync(outDir, { recursive: true });
  const n = deck.slides.length;
  const body = deck.slides
    .map(
      (s, i) =>
        `<section class="slide s-${s.id}" data-slide="${i + 1}" aria-label="${esc(s.title)}">${s.html({ i: i + 1, n })}</section>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="${deck.lang || "en"}"><head><meta charset="utf-8">
<title>${esc(deck.title)}</title>
<meta name="description" content="${esc(deck.company)} investor deck. Generated offline from docs/flagship/${deck.slug}/research.md, facts.json and brand.json.">
<style>
${fontFaces(outDir, deck.fonts)}
${BASE_CSS}
${deck.css}
</style></head><body>
${body}
</body></html>`;
  const htmlPath = join(outDir, `${deck.slug}-investor-deck.html`);
  writeFileSync(htmlPath, html);
  return { outDir, htmlPath };
}

/** Print to PDF and run layout checks (overflow / clipping) in the same Chromium. */
export async function render(htmlPath, pdfPath) {
  const { chromium } = require(PW);
  const browser = await chromium
    .launch({ args: ["--allow-file-access-from-files"] })
    .catch(() =>
      chromium.launch({
        executablePath: "/opt/pw-browsers/chromium",
        args: ["--allow-file-access-from-files"],
      }),
    );
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("file://" + htmlPath, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const problems = await page.evaluate(() => {
    const out = [];
    const fontsLoaded = [...document.fonts]
      .filter((f) => f.status !== "loaded")
      .map((f) => f.family);
    if (fontsLoaded.length)
      out.push(`fonts not loaded: ${[...new Set(fontsLoaded)].join(", ")}`);
    // Content boxes must contain their children too (catches text running into the footer).
    for (const box of document.querySelectorAll(
      ".slide .box, .slide .main, .slide .full",
    )) {
      const r = box.getBoundingClientRect();
      for (const el of box.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (b.width && b.height && b.bottom > r.bottom + 1)
          out.push(
            `slide ${box.closest(".slide").dataset.slide}: <${el.tagName.toLowerCase()} class="${el.className}"> below its content box by ${Math.round(b.bottom - r.bottom)}px`,
          );
      }
    }
    for (const s of document.querySelectorAll(".slide")) {
      const r = s.getBoundingClientRect();
      for (const el of s.querySelectorAll("*")) {
        if (el.closest("[data-allow-bleed]")) continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        if (
          b.right > r.right + 0.5 ||
          b.bottom > r.bottom + 0.5 ||
          b.left < r.left - 0.5 ||
          b.top < r.top - 0.5
        )
          out.push(
            `slide ${s.dataset.slide}: <${el.tagName.toLowerCase()} class="${el.className}"> outside slide`,
          );
        if (
          el.scrollHeight > el.clientHeight + 2 &&
          el.ownerDocument.defaultView.getComputedStyle(el).overflow ===
            "hidden"
        )
          out.push(
            `slide ${s.dataset.slide}: <${el.tagName.toLowerCase()} class="${el.className}"> clipped`,
          );
      }
    }
    return out;
  });
  await page.pdf({
    path: pdfPath,
    width: "1280px",
    height: "720px",
    printBackground: true,
    preferCSSPageSize: true,
  });
  await browser.close();
  return problems;
}

/** Verify: page count, page size, extractable text per page, size < 15 MB; PNG previews. */
export async function verify(pdfPath, expectedPages, previewDir, previewPages) {
  const { PDFDocument } = require(PDFLIB);
  const doc = await PDFDocument.load(readFileSync(pdfPath));
  const pages = doc.getPages();
  const sizes = [
    ...new Set(
      pages.map(
        (p) =>
          `${Math.round(p.getWidth() / 0.75)}x${Math.round(p.getHeight() / 0.75)}`,
      ),
    ),
  ];
  const bytes = statSync(pdfPath).size;
  const emptyText = [];
  for (let i = 1; i <= pages.length; i++) {
    const t = execFileSync(
      "pdftotext",
      ["-f", String(i), "-l", String(i), "-layout", pdfPath, "-"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (t.replace(/\s/g, "").length < 40) emptyText.push(i);
  }
  mkdirSync(previewDir, { recursive: true });
  for (const p of previewPages) {
    execFileSync("pdftoppm", [
      "-f",
      String(p),
      "-l",
      String(p),
      "-r",
      "72",
      "-png",
      "-singlefile",
      pdfPath,
      join(previewDir, `p${String(p).padStart(2, "0")}`),
    ]);
  }
  return {
    pages: pages.length,
    expectedPages,
    sizesPx: sizes,
    bytes,
    mb: +(bytes / 1048576).toFixed(2),
    emptyTextPages: emptyText,
    ok:
      pages.length === expectedPages &&
      sizes.length === 1 &&
      sizes[0] === "1280x720" &&
      !emptyText.length &&
      bytes < 15 * 1048576,
  };
}

/** README.md: slide list with facts and statuses each slide uses. */
export function writeReadme(deck, outDir, result) {
  const lines = [
    `# ${deck.company} — investor deck`,
    "",
    `- **PDF:** [\`${deck.slug}-investor-deck.pdf\`](${deck.slug}-investor-deck.pdf) — ${result.pages} slides, 1280×720 px, ${result.mb} MB, text selectable.`,
    `- **Source:** [\`${deck.slug}-investor-deck.html\`](${deck.slug}-investor-deck.html), generated by \`scripts/seed/flagship/deck/build.mjs ${deck.slug}\` (offline; Chromium print).`,
    `- **Facts:** only from [\`../research.md\`](../research.md), [\`../facts.json\`](../facts.json) and [\`../brand.json\`](../brand.json). Statuses: VERIFIED_PUBLIC · SELF_REPORTED · OWNER_PROVIDED · ASSUMPTION · UNKNOWN. Unknown stays unknown; it is never shown as zero.`,
    `- **Design direction:** ${deck.readme.direction}`,
    "",
    "## Brand use",
    "",
    ...deck.readme.brand.map((b) => `- ${b}`),
    "",
    "## Slides",
    "",
    "| # | Slide | Facts used (status) |",
    "| - | ----- | ------------------- |",
    ...deck.slides.map(
      (s, i) => `| ${i + 1} | ${s.title} | ${s.uses.join("; ")} |`,
    ),
    "",
    "## Left out on purpose",
    "",
    ...deck.readme.omitted.map((o) => `- ${o}`),
    "",
    "## Rebuild",
    "",
    "```bash",
    `node scripts/seed/flagship/deck/build.mjs ${deck.slug}`,
    "```",
    "",
  ];
  writeFileSync(join(outDir, "README.md"), lines.join("\n"));
}
