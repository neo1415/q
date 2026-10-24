/* global navigator -- read inside the page */
// QA QO-46 (privacy): loading /home must never open the microphone or a
// voice line by itself. Signs in as a fictional demo account in headless
// Chromium, with the site's microphone already granted (the case that used
// to open a live line on load), loads /home, waits, and fails if the page
// asked for the microphone or opened a voice session. Read-only: no Q turn
// is asked, nothing is spent.
//
//   EMAIL=founder.maji-loop@fictional.capitalq.local CQ_SEED_ACCOUNT_PASSWORD=... \
//   NODE_USE_ENV_PROXY=1 node scripts/handoff/live/home-no-auto-voice.mjs
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: [
    "--ignore-certificate-errors",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
await ctx.grantPermissions(["microphone"], { origin: WEB });
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem("cq.splash.seen", "1");
  } catch {
    // The splash then just shows.
  }
  window.__mic = 0;
  const media = navigator.mediaDevices;
  if (media?.getUserMedia) {
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = (constraints) => {
      window.__mic += 1;
      return original(constraints);
    };
  }
});
const page = await ctx.newPage();
await page.goto(`${WEB}/auth/sign-in`, { waitUntil: "domcontentloaded" });
await page.fill("input[type=email]", process.env.EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), {
    waitUntil: "commit",
  }),
  page.keyboard.press("Enter"),
]);
const opened = [];
page.on("request", (request) => {
  const url = request.url();
  if (/\/api\/q-voice-live\/open|\/api\/q-voice-duplex\/[^/]+\/turn/u.test(url))
    opened.push(url);
});
await page.goto(`${WEB}/home`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(15_000);
const mic = await page.evaluate(() => window.__mic);
await browser.close();
const ok = mic === 0 && opened.length === 0;
console.log(
  JSON.stringify({ ok, micRequests: mic, voiceOpened: opened.length }),
);
process.exit(ok ? 0 : 1);
