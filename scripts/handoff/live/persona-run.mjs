// Real-entity onboarding bench (founder direction 2026-09-30).
//
// Drives one persona through the live typed onboarding: signs in, picks the
// journey, sends the persona's scripted lines (monologues, corrections,
// sarcasm, off-list answers), then answers whatever Q asks from the
// persona's fact table until the interview completes or TURNS runs out.
// Q's latest question is read from the hosted DB, never guessed from the
// page. Test accounts only (@fictional.capitalq.local); secrets from env.
//
//   PERSONA=scripts/handoff/live/personas/<name>.json TURNS=30 \
//   CQ_SEED_ACCOUNT_PASSWORD=... SUPABASE_ACCESS_TOKEN=... \
//   NODE_USE_ENV_PROXY=1 node scripts/handoff/live/persona-run.mjs
import { readFileSync } from "node:fs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL("../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs", import.meta.url).href,
);

const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const persona = JSON.parse(readFileSync(process.env.PERSONA, "utf8"));
const EMAIL = persona.email;

const sql = async (query) => {
  const r = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
};
const WHO = `from onboarding.interview_turns t join onboarding.sessions s on s.id=t.session_id join identity.user_profiles p on p.id=s.user_id join auth.users u on u.id=p.auth_user_id where u.email='${EMAIL}'`;
const lastQ = async () =>
  (await sql(`select t.text, t.step_key ${WHO} and t.role='Q' order by t.created_at desc limit 1`))[0] ?? {
    text: "",
    step_key: null,
  };
const turnCount = async () =>
  Number((await sql(`select count(*)::int n ${WHO}`))[0]?.n ?? 0);
const status = async () =>
  (
    await sql(
      `select s.status from onboarding.sessions s join identity.user_profiles p on p.id=s.user_id join auth.users u on u.id=p.auth_user_id where u.email='${EMAIL}' order by s.started_at desc limit 1`,
    )
  )[0]?.status ?? null;

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
await page.goto(`${WEB}/auth/sign-in`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("input[type=email]", { timeout: 60000 });
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 30000, waitUntil: "commit" }),
  page.keyboard.press("Enter"),
]);
await page.waitForTimeout(8000);
const start = page.getByRole("button", { name: /^Start$/ });
if (await start.isVisible().catch(() => false)) {
  await start.click();
  await page.waitForTimeout(6000);
}
// The welcome preselects "Raising capital"; an investor picks theirs.
if (persona.journey === "investor") {
  const investing = page.locator('button:has-text("Investing")').first();
  if (await investing.isVisible().catch(() => false)) {
    await investing.click();
    await page.waitForTimeout(1500);
  }
}
const journey = page.getByRole("button", {
  name: new RegExp(`Continue as ${persona.journey}`, "i"),
});
if (await journey.isVisible().catch(() => false)) {
  await journey.click();
  await page.waitForTimeout(12000);
}
const typeButton = page.getByRole("button", { name: /^Type$/ });
if (await typeButton.isVisible().catch(() => false)) {
  await typeButton.click();
  await page.waitForTimeout(3000);
}

// Waits until Q has answered the line just sent (a new Q turn), bounded.
const say = async (text) => {
  const before = await turnCount();
  const typed = page.getByPlaceholder(/Type instead|in your own words/).last();
  const box = (await typed.isVisible().catch(() => false))
    ? typed
    : page.locator("textarea").last();
  await box.waitFor({ timeout: 60000 }).catch(() => {});
  const t0 = Date.now();
  await box.fill(text);
  await box.press("Enter");
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1000);
    if ((await turnCount()) >= before + 2) break;
  }
  const q = await lastQ();
  console.log(`\n>> ${text}\n<< [${q.step_key ?? "-"}] (${((Date.now() - t0) / 1000).toFixed(1)}s) ${q.text}`);
  return q;
};

for (const line of persona.script ?? []) {
  if ((await status()) === "COMPLETED") break;
  await say(line);
}
const facts = (persona.answers ?? []).map(([re, text]) => [new RegExp(re, "i"), text]);
for (let i = 0; i < Number(process.env.TURNS ?? 30); i += 1) {
  if ((await status()) === "COMPLETED") break;
  const q = await lastQ();
  const byStep = persona.byStep?.[q.step_key ?? ""];
  const hit = facts.find(([re]) => re.test(q.text));
  await say(byStep ?? (hit ? hit[1] : (persona.fallback ?? "Yes, that's right.")));
}
console.log("\nSTATUS:", await status(), "URL:", page.url());
await browser.close();
