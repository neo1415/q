/* global PerformanceObserver -- read inside the page */
// W4-C (enterprise audit finding 6): production server speed, read-only.
// Signs in as a FICTIONAL account in headless Chromium (phone profile, no
// throttling: this measures the server, not the phone), loads each page
// cold RUNS times and reports TTFB (responseStart) and LCP per page, median
// and all runs. Nothing is asked of Q and nothing is written.
//
//   EMAIL=investor.savanna-seed@fictional.capitalq.local CQ_SEED_ACCOUNT_PASSWORD=... \
//   NODE_USE_ENV_PROXY=1 node scripts/handoff/live/server-timing.mjs [runs] [/a,/b]
const { chromium, devices } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const EMAIL = process.env.EMAIL ?? "";
if (!EMAIL.endsWith("@fictional.capitalq.local"))
  throw new Error("live checks run on fictional accounts only");
const RUNS = Number(process.argv[2] ?? 3);
const PAGES = (
  process.argv[3] ?? "/home,/discover,/settings,/organisation,/settings/plan"
).split(",");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: ["--ignore-certificate-errors"],
});
const phone = { ...devices["Pixel 7"] };
delete phone.defaultBrowserType;
const signIn = await browser.newContext({ ...phone, ignoreHTTPSErrors: true });
await signIn.addInitScript(() => {
  try {
    sessionStorage.setItem("cq.splash.seen", "1");
  } catch {
    // The splash then just shows.
  }
});
const first = await signIn.newPage();
await first.goto(`${WEB}/auth/sign-in`, { waitUntil: "domcontentloaded" });
await first.fill("input[type=email]", EMAIL);
await first.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  first.waitForURL((u) => !u.pathname.includes("sign-in"), {
    waitUntil: "commit",
  }),
  first.keyboard.press("Enter"),
]);
const state = await signIn.storageState();
await signIn.close();

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const out = {};
for (const path of PAGES) {
  const ttfb = [];
  const lcp = [];
  let landed = "";
  for (let i = 0; i < RUNS; i += 1) {
    const ctx = await browser.newContext({
      ...phone,
      ignoreHTTPSErrors: true,
      storageState: state,
    });
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem("cq.splash.seen", "1");
      } catch {
        // The splash then just shows.
      }
      window.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const page = await ctx.newPage();
    await page.goto(`${WEB}${path}`, { waitUntil: "load", timeout: 120_000 });
    await page.waitForTimeout(3000);
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        ttfb: Math.round(nav.responseStart - nav.requestStart),
        lcp: Math.round(window.__lcp),
      };
    });
    landed = new URL(page.url()).pathname;
    ttfb.push(timing.ttfb);
    lcp.push(timing.lcp);
    await ctx.close();
  }
  out[path] = {
    landed,
    ttfbMedian: median(ttfb),
    lcpMedian: median(lcp),
    ttfb,
    lcp,
  };
  console.log(JSON.stringify({ path, ...out[path] }));
}
await browser.close();
