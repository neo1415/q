// Live check for the parallel web search (S8). Signs in as a fictional demo
// account, asks each prompt in a fresh Home conversation, and records time to
// the first streamed word, completion, external source links and pictures.
// No secrets are printed.
const { chromium } =
  await import("/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs");
const WEB = "https://capital-qweb-production.up.railway.app";
const EMAIL = process.env.EMAIL ?? "founder.maji-loop@fictional.capitalq.local";
const PROMPTS = [
  "Tell me about Zino Aviation and its team",
  "Who is Captain Zino Mario?",
  "Find the latest news on Flutterwave",
];

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
  } catch {}
});
const page = await ctx.newPage();
await page.goto(`${WEB}/auth/sign-in`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector("input[type=email]", { timeout: 60000 });
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), {
    timeout: 30000,
    waitUntil: "commit",
  }),
  page.keyboard.press("Enter"),
]);

const results = [];
for (const ask of PROMPTS) {
  await page.goto(`${WEB}/home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const mainText = async () =>
    (
      await page
        .locator("main")
        .innerText()
        .catch(() => "")
    ).trim();
  const box = page.locator("textarea").first();
  await box.fill(ask);
  const before = await mainText();
  const started = Date.now();
  await box.press("Enter");
  let firstWordMs = null;
  let lastChange = Date.now();
  let last = before;
  while (Date.now() - started < 90000) {
    await page.waitForTimeout(200);
    const now = await mainText();
    if (now !== last) {
      lastChange = Date.now();
      last = now;
    }
    // The first change beyond the echoed question.
    // Q's reply: the text after the "Q:" label that follows the question.
    if (firstWordMs === null) {
      const at = now.lastIndexOf(ask);
      const label = at < 0 ? -1 : now.indexOf("Q:", at + ask.length);
      const reply = label < 0 ? "" : now.slice(label + 2).trim();
      if (reply.length > 3) firstWordMs = Date.now() - started;
    }
    if (firstWordMs !== null && Date.now() - lastChange > 8000) break;
  }
  const doneMs = lastChange - started;
  const links = await page
    .locator("main a[href^='http']")
    .evaluateAll((as) =>
      [...new Set(as.map((a) => a.href))].filter(
        (h) => !h.includes("capital-q"),
      ),
    );
  const pictures = await page
    .locator("main [data-q-picture] img")
    .evaluateAll((imgs) =>
      imgs.map((i) => ({ src: i.src, loaded: i.naturalWidth > 0 })),
    );
  const answer = last.replace(before, "").slice(0, 1400).replace(/\n+/g, " | ");
  results.push({ ask, firstWordMs, doneMs, links, pictures, answer });
  console.log(JSON.stringify(results.at(-1), null, 1));
}
await browser.close();
