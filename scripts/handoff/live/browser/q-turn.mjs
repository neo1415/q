// Typed Q turns on production as a seeded fictional account, measuring time to first text.
// Each turn is a real (paid, cents) model run: keep ASKS short (budget $1/test, $5/day).
//   WHO=savanna|thames|halyard ASKS=asks.txt [START_PATH=/home?new=1] [SHOTS=1] \
//   SUPABASE_ACCESS_TOKEN=proxy-injected CQ_SEED_ACCOUNT_PASSWORD=... NODE_USE_ENV_PROXY=1 \
//   node scripts/handoff/live/browser/q-turn.mjs
// ASKS is a file with one question per line. Logs JSON lines to $OUT/q-turn.jsonl (default /tmp/cq-live).
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { WEB, OUT, openBrowser, signIn } from "./common.mjs";
import { emailFor } from "./who.mjs";
mkdirSync(OUT, { recursive: true });
const WHO = process.env.WHO;
const { email } = await emailFor(WHO);
const asks = readFileSync(process.env.ASKS, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const log = (o) => {
  const row = { at: new Date().toISOString(), who: WHO, ...o };
  appendFileSync(`${OUT}/q-turn.jsonl`, JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row).slice(0, 3000));
};
const { ctx, page } = await openBrowser(`q-${WHO}`, { scale: 2 });
const body = () =>
  page
    .locator("body")
    .innerText()
    .catch(() => "");
try {
  await signIn(page, email);
  await page.goto(`${WEB}${process.env.START_PATH ?? "/home?new=1"}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(8000);
  let n = 0;
  for (const ask of asks) {
    n += 1;
    const box = page.getByPlaceholder("Ask Q", { exact: true }).first();
    if (!(await box.isVisible().catch(() => false))) {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(2000);
    }
    await box.waitFor({ timeout: 30000 });
    await box.fill(ask);
    const t0 = Date.now();
    await box.press("Enter");
    await page.waitForTimeout(1500);
    if (!(await body()).includes(ask)) {
      log({ phase: "abort-not-sent", n, ask });
      break;
    }
    let txt = "",
      last = "",
      stable = 0,
      firstText = null;
    for (let i = 0; i < 360; i += 1) {
      await page.waitForTimeout(1000);
      txt = await body();
      const idx = txt.lastIndexOf(ask);
      const tail = idx >= 0 ? txt.slice(idx + ask.length).trim() : "";
      if (firstText === null && tail.length > 60) firstText = Date.now() - t0;
      const busy = /\nStop\n|\nWorking\n|Looking into that now/.test(tail);
      if (txt === last && tail.length > 60 && !busy) {
        if (++stable >= 5) break;
      } else stable = 0;
      last = txt;
    }
    if (process.env.SHOTS)
      await page
        .screenshot({
          path: `${OUT}/${WHO}-t${n}.jpg`,
          type: "jpeg",
          quality: 80,
        })
        .catch(() => {});
    const idx = txt.lastIndexOf(ask);
    const cards = await page.locator("[data-q-approval]").count();
    log({
      phase: "turn",
      n,
      ask,
      msFirstText: firstText,
      msToSettle: Date.now() - t0,
      url: new URL(page.url()).pathname,
      approvalCards: cards,
      answer: txt.slice(idx + ask.length, idx + ask.length + 2500),
    });
  }
} finally {
  await ctx.close();
}
