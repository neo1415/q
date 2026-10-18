// Usage: node scripts/seed/flagship/deck/build.mjs <kuuza|songscribe|capital-q|zino-aviation> [previewDir]
// Writes docs/flagship/<slug>/deck/{<slug>-investor-deck.html,.pdf,README.md}. Offline only.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { REPO, render, verify, writeHtml, writeReadme } from "./lib.mjs";

const slug = process.argv[2];
if (!slug) throw new Error("usage: build.mjs <slug> [previewDir]");
const { default: deck } = await import(`./companies/${slug}.mjs`);
const { outDir, htmlPath } = writeHtml(deck);
const pdfPath = join(outDir, `${slug}-investor-deck.pdf`);
const problems = await render(htmlPath, pdfPath);
const n = deck.slides.length;
const previewDir = process.argv[3] || join(tmpdir(), `deck-preview-${slug}`);
const result = await verify(
  pdfPath,
  n,
  previewDir,
  Array.from({ length: n }, (_, k) => k + 1),
);
writeReadme(deck, outDir, result);
// Keep the generated README in the repository's Prettier format so `pnpm format:check` stays green.
const prettier = [
  join(REPO, "node_modules/.bin/prettier"),
  "/home/user/q/node_modules/.bin/prettier",
].find(existsSync);
if (prettier)
  execFileSync(
    prettier,
    ["--write", "--log-level", "warn", join(outDir, "README.md")],
    { cwd: REPO },
  );
console.log(
  JSON.stringify(
    { pdfPath, previewDir, ...result, layoutProblems: problems },
    null,
    1,
  ),
);
if (!result.ok || problems.length) process.exitCode = 1;
