// Usage: node scripts/seed/flagship/deck/build.mjs <kuuza|songscribe|capital-q|zino-aviation> [previewDir]
// Writes docs/flagship/<slug>/deck/{<slug>-investor-deck.html,.pdf,README.md}. Offline only.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render, verify, writeHtml, writeReadme } from "./lib.mjs";

const slug = process.argv[2];
if (!slug) throw new Error("usage: build.mjs <slug> [previewDir]");
const { default: deck } = await import(`./companies/${slug}.mjs`);
const { outDir, htmlPath } = writeHtml(deck);
const pdfPath = join(outDir, `${slug}-investor-deck.pdf`);
const problems = await render(htmlPath, pdfPath);
const n = deck.slides.length;
const previewDir = process.argv[3] || join(tmpdir(), `deck-preview-${slug}`);
const result = await verify(pdfPath, n, previewDir, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].filter((p) => p <= n));
writeReadme(deck, outDir, result);
console.log(JSON.stringify({ pdfPath, previewDir, ...result, layoutProblems: problems }, null, 1));
if (!result.ok || problems.length) process.exitCode = 1;
