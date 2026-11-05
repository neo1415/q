// Live check of the ChatGPT-style Q home on production. Fictional account only.
const { chromium } = require("playwright");
const WEB = "https://capital-qweb-production.up.railway.app";
const EMAIL = "investor.savanna-seed@fictional.capitalq.local";
const OUT = process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const results = {};
  for (const [w, h, send] of [[1440, 900, true], [390, 844, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: "light" });
    await ctx.addInitScript(() => { try { sessionStorage.setItem("cq.splash.seen", "1"); } catch {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${WEB}/auth/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("input[type=email]", { timeout: 60000 });
    await page.fill("input[type=email]", EMAIL);
    await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 45000, waitUntil: "commit" }), page.keyboard.press("Enter")]);
    await page.goto(`${WEB}/home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${OUT}/empty-${w}.png` });
    const r = {
      url: page.url(),
      roomPresence: await page.locator("[data-q-room-presence]").count(),
      cornerPresence: await page.locator('[data-q-presence="corner"]').count(),
      scopeChip: await page.locator("[data-q-scope]").count(),
      talkButtonOld: await page.locator('[data-q-control="talk"]').count(),
      talkToQ: await page.getByRole("button", { name: "Talk to Q" }).count(),
      starters: await page.locator("main li button, [data-q-starters] button").count(),
      heading: (await page.locator("main h1, main h2").first().innerText().catch(() => "")).slice(0, 80),
    };
    if (send) {
      const box = page.locator("textarea").first();
      await box.fill("What is my mandate?");
      await page.waitForTimeout(500);
      r.sendVisibleWhenTyping = await page.getByRole("button", { name: "Send" }).count();
      await page.screenshot({ path: `${OUT}/typed-${w}.png` });
      await box.press("Enter");
      await page.waitForTimeout(25000);
      await page.screenshot({ path: `${OUT}/sent-${w}.png` });
      const boxBox = await box.boundingBox();
      r.composerTopAfterSend = boxBox ? Math.round(boxBox.y) : null;
      r.answerTail = (await page.locator("main").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(-400);
    }
    r.pageErrors = errors;
    results[w] = r;
    await ctx.close();
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error("FAILED", String(e).slice(0, 300)); process.exit(1); });
