// 25-route signed-in smoke on production (no Q turns, no spend).
//   CQ_SEED_ACCOUNT_PASSWORD=... NODE_USE_ENV_PROXY=1 node scripts/handoff/live/browser/routes.mjs
// EMAIL defaults to the fictional LedgerBridge founder. Prints status, ok/BAD, JS errors and redirects.
import { WEB, openBrowser, signIn } from "./common.mjs";
const EMAIL =
  process.env.EMAIL ?? "founder.ledgerbridge@fictional.capitalq.local";
const routes = process.env.ROUTES?.split(",") ?? [
  "/home",
  "/discover",
  "/explore",
  "/relationships",
  "/relationships/import",
  "/work",
  "/analytics",
  "/settings",
  "/settings/plan",
  "/settings/usage",
  "/settings/team",
  "/organisation",
  "/organisation/members",
  "/organisation/roles",
  "/organisation/plan",
  "/organisation/activity",
  "/organisation/privacy",
  "/organisation/brand",
  "/organisation/connections",
  "/organisation/speaking",
  "/organisation/data",
  "/verification",
  "/profile",
  "/documents",
  "/rehearsals",
];
const { ctx, page } = await openBrowser("routes");
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
let bad = 0;
try {
  await signIn(page, EMAIL);
  for (const r of routes) {
    errs.length = 0;
    let status = 0;
    try {
      status =
        (
          await page.goto(WEB + r, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          })
        )?.status() ?? 0;
    } catch {
      status = -1;
    }
    await page.waitForTimeout(3500);
    const t = await page.innerText("body").catch(() => "");
    const isBad =
      status >= 400 ||
      status < 0 ||
      /went wrong|isn't here|Application error|Unhandled/i.test(t);
    if (isBad) bad += 1;
    const landed = new URL(page.url()).pathname;
    console.log(
      String(status).padEnd(4),
      isBad ? "BAD " : "ok  ",
      errs.length ? `jsErr:${errs.length}` : "",
      r,
      landed !== r ? `-> ${landed}` : "",
    );
  }
} finally {
  await ctx.close();
}
process.exit(bad ? 1 : 0);
