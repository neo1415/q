// Screenshot gallery of the Relationship Hub prototype (design phase only).
// Usage (from the repo root, with a static server on :4321 serving the repo root):
//   python3 -m http.server 4321 --bind 127.0.0.1 &
//   node design/relationship-hub/scripts/shots.mjs [outDir]
// Resolves Playwright from the main checkout's node_modules (no new dependency).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const pw = require(require.resolve("@playwright/test", { paths: [process.cwd(), "/home/user/q"] }));
const BASE = process.env.HUB_URL ?? "http://127.0.0.1:4321/design/relationship-hub/index.html";
const OUT = process.argv[2] ?? "/home/user/q/design-deliverables/relationship-hub/screens";
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ["inv-overview", "#investor/overview"],
  ["inv-pipeline-table", "#investor/pipeline?view=table"],
  ["inv-pipeline-board", "#investor/pipeline?view=board"],
  ["inv-gateq", "#investor/gateq"],
  ["inv-record", "#investor/record/halden/overview"],
  ["inv-evidence", "#investor/record/halden/evidence", "compare"],
  ["inv-transcript", "#investor/record/halden/meetings?t=2205"],
  ["inv-document-p7", "#investor/record/halden/documents?page=7"],
  ["inv-work-running", "#investor/work/w1"],
  ["inv-approval", "#investor/work/w2"],
  ["inv-reports", "#investor/reports"],
  ["inv-q-failed", "#investor/record/halden/overview", "qfail"],
  ["fnd-overview", "#founder/overview"],
  ["fnd-investors", "#founder/investors?view=table"],
  ["fnd-record", "#founder/record/northgate/overview"],
  ["fnd-requests", "#founder/record/northgate/requests"],
  ["fnd-fundraising", "#founder/fundraising"],
  ["fnd-updates", "#founder/updates"],
  ["fnd-q-recommend", "#founder/overview", "qnext"],
];
const DEVICES = { desktop: { width: 1440, height: 900, isMobile: false }, mobile: { width: 390, height: 844, isMobile: true } };

const browser = await pw.chromium.launch({ executablePath: process.env.CQ_CHROMIUM ?? "/opt/pw-browsers/chromium" });
for (const [dev, vp] of Object.entries(DEVICES)) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.isMobile, hasTouch: vp.isMobile, colorScheme: theme });
    const page = await ctx.newPage();
    for (const [name, hash, extra] of SHOTS) {
      await page.goto(`${BASE}?theme=${theme}${hash}`);
      await page.waitForTimeout(250);
      if (extra === "compare") await page.evaluate(() => window.HUB.handle("compare"));
      if (extra === "qfail") await page.evaluate(() => window.HUB.runCommand("Open the term sheet"));
      if (extra === "qnext") await page.evaluate(() => window.HUB.runCommand("What should I do next?"));
      if (extra === "compare") await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${name}-${dev}-${theme}.png`) });
    }
    await ctx.close();
  }
}
await browser.close();
console.log("wrote", SHOTS.length * 4, "screenshots to", OUT);
