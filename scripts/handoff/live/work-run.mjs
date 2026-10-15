// AUTO live check: one delegated outreach, driven as a person would.
// MODE=investor: ask Home Q to handle outreach (ASK), approve the card.
// MODE=founder: accept the investor's interest (INVESTOR_NAME) on /company/interest.
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
const t = () => new Date().toISOString();
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
console.log(t(), "signed in", page.url());
try {
  if (process.env.MODE === "investor") {
    await page.goto(`${WEB}/home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const box = page.locator("textarea").first();
    await box.fill(process.env.ASK);
    await box.press("Enter");
    console.log(t(), "asked");
    const approve = page.getByRole("button", { name: /^Approve/ }).first();
    await approve.waitFor({ state: "visible", timeout: 120000 });
    console.log(
      t(),
      "card shown:",
      (await page.locator("main").innerText())
        .replace(/\n+/g, " | ")
        .slice(-900),
    );
    await approve.click();
    console.log(t(), "approved");
    await page.waitForTimeout(15000);
    console.log(
      t(),
      (await page.locator("main").innerText())
        .replace(/\n+/g, " | ")
        .slice(-400),
    );
  } else {
    await page.goto(`${WEB}/company/interest`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(4000);
    const row = page
      .locator("li")
      .filter({ hasText: process.env.INVESTOR_NAME })
      .first();
    await row
      .getByRole("button", { name: /^Accept/ })
      .first()
      .click();
    console.log(t(), "accept pressed");
    await page
      .getByRole("button", { name: /^Accept$/ })
      .last()
      .click();
    console.log(t(), "accept confirmed");
    await page.waitForTimeout(8000);
    console.log(
      t(),
      (await page.locator("main").innerText())
        .replace(/\n+/g, " | ")
        .slice(0, 600),
    );
  }
} catch (error) {
  console.log(t(), "FAILED", String(error).slice(0, 400));
  await page
    .screenshot({
      path: `${process.env.SHOTS ?? "/tmp"}/work-${process.env.MODE}.png`,
    })
    .catch(() => {});
}
await browser.close();
