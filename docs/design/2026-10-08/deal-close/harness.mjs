// Stage-strip harness for the built deal card (/dev/deal-close), served by
// `next start` with CQ_DEV_PREVIEW=1 on BASE (default :3123). Asserts the
// strip both sides see at each stage and the final states, then saves
// screenshots next to the design mockup's. Exits non-zero on a failure.
// Run: NODE_PATH=<repo>/node_modules/.pnpm/playwright@<v>/node_modules node harness.mjs
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(
  require.resolve("playwright", {
    paths: (process.env.NODE_PATH ?? "").split(":").filter(Boolean),
  }),
);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "shots");
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? "http://127.0.0.1:3123";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
};

const cases = [
  { stage: "terms", side: "investor", current: "TERMS", final: null },
  { stage: "ready", side: "founder", current: "FUNDS_RECEIVED", final: null },
  { stage: "closed", side: "founder", current: null, final: "CLOSED" },
  { stage: "closed", side: "investor", current: null, final: "CLOSED" },
  { stage: "passed", side: "investor", current: null, final: "PASSED" },
];

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  for (const item of cases) {
    const page = await browser.newPage({ viewport });
    const url = `${base}/dev/deal-close?stage=${item.stage}&side=${item.side}`;
    const response = await page.goto(url, { waitUntil: "load" });
    const label = `${device} ${item.stage}/${item.side}`;
    // The first visit plays the brand splash; skip it, as a person would.
    await page.waitForTimeout(800);
    const skip = page.getByText("Tap to skip");
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.waitForTimeout(1_200);
    check(`${label}: page served`, response?.status() === 200);
    const strip = page.getByRole("list", { name: "Where this deal is" });
    await strip.waitFor({ timeout: 15_000 });
    const currentStage = await strip
      .locator('[aria-current="step"]')
      .getAttribute("data-stage")
      .catch(() => null);
    if (item.final === "PASSED") {
      check(
        `${label}: strip ends at Not proceeding`,
        currentStage === "PASSED",
      );
      check(
        `${label}: archived, never deleted, is said`,
        await page.getByText(/archived, never deleted/).isVisible(),
      );
      check(
        `${label}: the private pass report is listed`,
        await page.locator('[data-report="PASS"]').isVisible(),
      );
    } else if (item.final === "CLOSED") {
      check(`${label}: strip ends at Closed`, currentStage === "CLOSED");
      check(
        `${label}: final state is shown`,
        await page.locator('[data-deal-final="CLOSED"]').isVisible(),
      );
      check(
        `${label}: onboarding checklist present`,
        (await page.locator("[data-deal-checklist] li").count()) >= 3,
      );
      check(
        `${label}: the founder never sees the investor's memo`,
        item.side === "investor" ||
          (await page.locator('[data-report="INVESTMENT_MEMO"]').count()) === 0,
      );
    } else {
      check(
        `${label}: current stage is ${item.current}`,
        currentStage === item.current,
      );
    }
    check(
      `${label}: no horizontal overflow`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    if (item.stage === "ready") {
      check(
        `${label}: close is offered`,
        await page
          .getByRole("button", { name: "Close the investment" })
          .isVisible(),
      );
    }
    if (item.stage === "terms") {
      // The approval card states exactly what is recorded.
      await page.getByRole("button", { name: "Record as signed" }).isVisible();
      check(
        `${label}: terms line shows exact money`,
        await page
          .getByText("USD 250,000", { exact: false })
          .first()
          .isVisible(),
      );
    }
    await page.screenshot({
      path: join(out, `built-${item.stage}-${item.side}-${device}.png`),
      fullPage: true,
    });
    await page.close();
  }
}
await browser.close();
console.log(failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
