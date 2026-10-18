// node scripts/seed/flagship/scenario/run.mjs <slug|all> [--pdf]
// Writes docs/flagship/<slug>/scenario/{inputs.json,result.json,README.md}
// and, with --pdf, <slug>-illustrative-scenario.pdf. Offline only.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHtml, renderReadme } from "./render.mjs";
import { BANNER, runScenario, SCENARIOS } from "./scenario.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const outDir = (slug) => join(ROOT, "docs/flagship", slug, "scenario");
/** Outputs are written prettier-formatted so the repo's format check holds. */
export async function formatted(file, text) {
  const prettier = await import("prettier");
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(text, { ...options, filepath: file });
}
export const json = (file, value) =>
  formatted(file, JSON.stringify(value, null, 2));

async function pdf(slug, html) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    executablePath: process.env.CQ_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  try {
    const page = await browser.newPage();
    // Offline: the HTML is self-contained; block any request just in case.
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    const banner = `<div style="width:100%;margin:0 12mm;padding:5px 8px;border:2px solid #b98a00;background:#fff4d6;color:#5c3d00;font:bold 11.5px Helvetica,Arial,sans-serif;text-align:center;-webkit-print-color-adjust:exact">${BANNER}</div>`;
    const footer = `<div style="width:100%;margin:0 12mm;font:8px Helvetica,Arial,sans-serif;color:#5a6270;display:flex;justify-content:space-between"><span>${BANNER}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const path = join(outDir(slug), `${slug}-illustrative-scenario.pdf`);
    await page.pdf({
      path,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: banner,
      footerTemplate: footer,
      margin: { top: "24mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    return path;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [target, flag] = process.argv.slice(2);
  const slugs = target === "all" ? Object.keys(SCENARIOS) : [target];
  for (const slug of slugs) {
    const scenario = SCENARIOS[slug];
    if (scenario === undefined) throw new Error(`Unknown scenario ${slug}`);
    const { inputs, result } = runScenario(slug);
    mkdirSync(outDir(slug), { recursive: true });
    const dir = outDir(slug);
    for (const [name, text] of [
      ["inputs.json", await json(join(dir, "inputs.json"), inputs)],
      ["result.json", await json(join(dir, "result.json"), result)],
      [
        "README.md",
        await formatted(join(dir, "README.md"), renderReadme(scenario, result)),
      ],
    ])
      writeFileSync(join(dir, name), text);
    if (flag === "--pdf") await pdf(slug, renderHtml(scenario, result));
    const u = result.unicornPotential;
    console.log(
      `${slug}: ${u.overallScore} ${u.band} ${u.confidence} coverage=${u.coverage}`,
    );
  }
}
