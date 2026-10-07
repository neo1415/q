// Adaptive fictional founder: answers what Q asked (test harness only).
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const WEB = "https://capital-qweb-production.up.railway.app";
const ANSWERS = [
  [/functions|founding team cover/i, "product, engineering and operations"],
  [/right\?|called|company name/i, "Yes, that's right"],
  [/stage/i, "We're at seed"],
  [/currency/i, "US dollars"],
  [/how much/i, "about five million dollars"],
  [/role|CEO/i, "I'm the founder, and yes CEO as well"],
  [
    /how many founders|founders are there|number of founders/i,
    "just one founder",
  ],
  [/full-time|full time/i, "yes, all full time"],
  [/how many people|team size|work on/i, "twelve people"],
  [/website/i, "greenbox dot africa"],
  [
    /signal|pilots|waitlist/i,
    "we have pilots running with three farm cooperatives",
  ],
  [/revenue/i, "recurring and growing"],
  [/instrument|SAFE|equity/i, "post money SAFE"],
  [/close|when|timeline|timeframe/i, "in about five months"],
  [/fund|use of|spend/i, "product engineering and go to market"],
  [
    /describe|what does|do\?|one line/i,
    "We run solar cold rooms for farmers in Lagos",
  ],
  [/country|based/i, "Nigeria"],
  [/sector|categor|industry/i, "agritech and climate"],
  [/materials|financials|contracts/i, "No, nothing else for now"],
  [/deck/i, "Yes please, let's make the deck now"],
  [/function|roles on the team|hiring/i, "engineering and operations"],
  [/customers|growth/i, "we'd rather skip that for now"],
  [/follow|anything else/i, "no, that's all"],
  [/brings you|exploring/i, "I'm raising capital for my company"],
  [/raising now|actively|preparing to raise/i, "Actively raising right now"],
  [
    /correct|right|save|confirm|finish|look right|summary/i,
    "Yes. Go ahead. That is exactly what it is.",
  ],
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
await page.fill("input[type=email]", process.env.EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), {
    timeout: 30000,
    waitUntil: "commit",
  }),
  page.keyboard.press("Enter"),
]);
await page.waitForTimeout(8000);
const start = page.getByRole("button", { name: /^Start$/ });
if (await start.isVisible().catch(() => false)) {
  await start.click();
  await page.waitForTimeout(6000);
}
const founder = page.getByRole("button", { name: /Continue as founder/i });
if (await founder.isVisible().catch(() => false)) {
  await founder.click();
  await page.waitForTimeout(12000);
}
const typeButton = page.getByRole("button", { name: /^Type$/ });
if (await typeButton.isVisible().catch(() => false)) {
  await typeButton.click();
  await page.waitForTimeout(3000);
}
const lastQ = async () => {
  const sql = `select t.text from onboarding.interview_turns t join onboarding.sessions s on s.id=t.session_id join identity.user_profiles p on p.id=s.user_id join auth.users u on u.id=p.auth_user_id where u.email='${process.env.EMAIL}' and t.role='Q' order by t.created_at desc limit 1`;
  const r = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j[0] ? String(j[0].text) : "";
};
for (let i = 0; i < Number(process.env.TURNS ?? 24); i++) {
  if (!new URL(page.url()).pathname.includes("onboarding")) break;
  const full = await lastQ();
  const q =
    full
      .split(/(?<=[.!?])\s+/)
      .filter((x) => /\?$/.test(x))
      .at(-1) ?? full;
  const hit = ANSWERS.find(([re]) => re.test(q));
  const text = hit ? hit[1] : "Yes. Go ahead. That is exactly what it is.";
  const typed = page.getByPlaceholder("Type instead");
  const box = (await typed.isVisible().catch(() => false))
    ? typed
    : page.locator("textarea").last();
  await box.waitFor({ timeout: 60000 }).catch(() => {});
  await box.fill(text);
  await box.press("Enter");
  console.log("Q?", q.slice(0, 90), "\n  >>", text);
  await page.waitForTimeout(Number(process.env.WAIT ?? 15000));
}
await page.waitForTimeout(6000);
console.log("final:", page.url());
await page.screenshot({ path: "/tmp/claude-0/pw/onb9.png" });
await browser.close();
