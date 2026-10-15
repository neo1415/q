const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const WEB = "https://capital-qweb-production.up.railway.app";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--ignore-certificate-errors"],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1300, height: 900 },
});
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem("cq.splash.seen", "1");
  } catch {
    // Storage can be blocked in a fresh context; the splash then just shows.
  }
});
const page = await ctx.newPage();
await page.goto(`${WEB}/auth/sign-in`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector("input[type=email]", { timeout: 60000 });
await page.fill("input[type=email]", process.env.EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), {
    timeout: 30000,
    waitUntil: "commit",
  }),
  page.keyboard.press("Enter"),
]);
await page.goto(`${WEB}/home`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
console.log("at", page.url());
const box = page.locator("textarea").first();
await box.fill(process.env.ASK);
await box.press("Enter");
await page.waitForTimeout(40000);
const text = (
  await page
    .locator("main")
    .innerText()
    .catch(() => "")
).replace(/\n+/g, " | ");
console.log(text.slice(-1500));
await browser.close();
