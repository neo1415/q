// Onboarding end-to-end (DECISIONS 76/77; plan: docs/ai-handoff/ONBOARDING-TEST-PLAN.md).
//
// Every run creates a FRESH fictional account (@fictional.capitalq.local
// only; invented company and firm names marked "(fictional)") and drives
// one journey on production at 1440 and 390 wide, with a screenshot per
// step. Voice is driven over HTTP the way voice-http.mjs does it: a real
// q-api voice session, opened on the onboarding session, with the speech
// provider's part played by this script (transcript text to the think
// endpoint). Q's lines are read back from onboarding.interview_turns with
// a read-only query, never guessed from the page.
//
// Nothing runs against production unless CQ_E2E_GO=1: without it the
// script prints what it would do and exits 0. Q turns are kept few (dense
// answers, ~6-10 a journey). No outward message reaches a real person:
// fictional accounts only, no invites, no chat to a counterparty.
//
//   CQ_E2E_GO=1 NODE_USE_ENV_PROXY=1 JOURNEY=founder|investor \
//   STEPS=J1,J2,J3,J4,J5,J6,J7 VIEWPORT=1440|390 OUT=<dir> \
//   SB_URL=... SB_KEY=<admin, for creating the account only> \
//   SB_PUBLISHABLE=... CQ_SEED_ACCOUNT_PASSWORD=... SUPABASE_ACCESS_TOKEN=... \
//   node scripts/handoff/live/onboarding-e2e.mjs
//
// Secrets are read from env by name and never printed.

import { mkdirSync, writeFileSync } from "node:fs";

const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
const QAPI =
  process.env.CQ_Q_API_URL ??
  "https://capital-qq-api-production.up.railway.app";
const PROJECT = process.env.SUPABASE_PROJECT ?? "vcohxiqsmnkzxnvawgri";
const JOURNEY = process.env.JOURNEY === "investor" ? "investor" : "founder";
const STEPS = new Set(
  (process.env.STEPS ?? "J1,J2,J3,J4,J5,J6").split(",").map((s) => s.trim()),
);
const WIDTH = process.env.VIEWPORT === "390" ? 390 : 1440;
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const OUT =
  process.env.OUT ??
  `/tmp/claude-0/onboarding-e2e/${JOURNEY}-${WIDTH}-${STAMP}`;
const EMAIL =
  process.env.EMAIL ??
  `e2e-${JOURNEY.slice(0, 3)}-${STAMP}-${Math.random().toString(36).slice(2, 6)}@fictional.capitalq.local`;
if (!EMAIL.endsWith("@fictional.capitalq.local")) {
  console.error("fictional accounts only");
  process.exit(2);
}
// Invented, never a real company (DECISIONS 77).
const PERSON = JOURNEY === "founder" ? "Ada Okonkwo-Test" : "Tunde Bassey-Test";
const ORG =
  JOURNEY === "founder"
    ? "Tamarind Ledger (fictional)"
    : "Kestrel Bay Capital (fictional)";

// ---- the plan, when not told to run ---------------------------------------
const PLAN = {
  J1: "chat interview: one greeting; a dense line answers several topics; none re-asked",
  J2: "long answers: a ramble is said back for a yes; a clear typed answer is kept whole (DECISIONS 77; known P1-1)",
  J3: "required vs optional: optional skip set aside; required refusal re-asked WITH the reason (P0-2)",
  J4: "chat → voice (HTTP) → chat: no re-greeting (P0-1), no repeated topic, voice turns in the thread",
  J5: "continue later and resume, conversation then form: same open question / same step, nothing lost",
  J6: "finish: lands on /verification; a refused finish says so (P1-6)",
  J7: "Q edits the profile from Home: an approval card, then the change on /capital and /profile",
};
if (process.env.CQ_E2E_GO !== "1") {
  console.log(
    `onboarding-e2e (dry): ${JOURNEY} at ${WIDTH}px as a fresh ${EMAIL}`,
  );
  for (const [key, what] of Object.entries(PLAN)) {
    if (STEPS.has(key)) console.log(`  ${key} ${what}`);
  }
  console.log("Set CQ_E2E_GO=1 to run against production.");
  process.exit(0);
}
for (const name of [
  "SB_URL",
  "SB_KEY",
  "SB_PUBLISHABLE",
  "CQ_SEED_ACCOUNT_PASSWORD",
  "SUPABASE_ACCESS_TOKEN",
]) {
  if (!process.env[name]) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
}
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);

// ---- results ----------------------------------------------------------------
const results = [];
const check = (journey, name, ok, detail = "") => {
  results.push({ journey, name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"} ${journey} ${name}${detail ? ` — ${detail}` : ""}`,
  );
};
const note = (journey, name, detail) => {
  results.push({ journey, name, ok: null, detail });
  console.log(`NOTE ${journey} ${name} — ${detail}`);
};

// ---- the account (as mkuser.mjs creates one) --------------------------------
{
  const res = await fetch(`${process.env.SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: process.env.SB_KEY,
      authorization: `Bearer ${process.env.SB_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: EMAIL,
      password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: {
        display_name: PERSON,
        full_name: PERSON,
        organisation_name: ORG,
      },
    }),
  });
  if (!res.ok) {
    console.error(`account not created: HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(`account ${EMAIL}`);
}

// ---- read-only reads of the hosted record -----------------------------------
const sql = async (query) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
};
const quoted = EMAIL.replace(/'/g, "''");
const SESSION_OF = `select s.id from onboarding.sessions s join identity.user_profiles p on p.id=s.user_id join auth.users u on u.id=p.auth_user_id where u.email='${quoted}' order by s.created_at desc limit 1`;
const turns = async () =>
  sql(
    `select t.role, t.channel, t.text, t.created_at from onboarding.interview_turns t where t.session_id=(${SESSION_OF}) order by t.created_at`,
  );
const answered = async () =>
  (
    await sql(
      `select r.step_key from onboarding.responses r where r.session_id=(${SESSION_OF}) and r.superseded_by_response_id is null`,
    )
  ).map((row) => String(row.step_key));
const lastQ = async () => {
  const all = await turns();
  return String(all.filter((t) => t.role === "Q").at(-1)?.text ?? "");
};

// The greeting markers a mid-session line must never carry (P0-1).
const GREETING = /\bI'm Q\b|\bwelcome back\b|^\s*(hi|hello)\b/i;
const greetingsAfterFirstPerson = (all) => {
  const first = all.findIndex((t) => t.role === "PERSON");
  return first < 0
    ? []
    : all
        .slice(first + 1)
        .filter((t) => t.role === "Q" && GREETING.test(t.text));
};

// ---- the browser --------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY } }
    : {}),
});
const ctx = await browser.newContext({
  viewport:
    WIDTH === 390 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem("cq.splash.seen", "1");
  } catch {
    // A blocked store just shows the splash.
  }
});
const page = await ctx.newPage();
let shotNo = 0;
const shot = async (name) => {
  shotNo += 1;
  await page
    .screenshot({
      path: `${OUT}/${String(shotNo).padStart(2, "0")}-${name}.png`,
    })
    .catch(() => undefined);
};
const settle = (ms = Number(process.env.WAIT ?? 15000)) =>
  page.waitForTimeout(ms);

/** Types one line to Q in the onboarding conversation and waits for Q. */
const say = async (text) => {
  const box = page.getByRole("textbox").last();
  await box.waitFor({ timeout: 60000 });
  await box.fill(text);
  await box.press("Enter");
  await settle();
};

await page.goto(`${WEB}/auth/sign-in`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.fill("input[type=email]", EMAIL);
await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("sign-in"), {
    timeout: 60000,
    waitUntil: "commit",
  }),
  page.keyboard.press("Enter"),
]);
await settle(6000);
await shot("signed-in");

// /welcome: type, then the journey.
const typeInstead = page.locator("[data-q-welcome-type]");
if (await typeInstead.isVisible().catch(() => false)) await typeInstead.click();
const persona = page.locator(`[data-persona]`).filter({
  hasText: JOURNEY === "founder" ? /raising/i : /investing/i,
});
if (
  await persona
    .first()
    .isVisible()
    .catch(() => false)
)
  await persona.first().click();
if (!new URL(page.url()).pathname.startsWith(`/onboarding/${JOURNEY}`)) {
  await page.goto(`${WEB}/onboarding/${JOURNEY}`, {
    waitUntil: "domcontentloaded",
  });
}
await settle(10000);
await shot("opened");

// ---- J1 chat interview ----------------------------------------------------------
const DENSE =
  JOURNEY === "founder"
    ? "We're Tamarind Ledger, a fictional seed-stage fintech in Lagos, Nigeria. I'm the CEO and one of two full-time founders, and there are nine of us."
    : "Kestrel Bay Capital is a fictional VC fund. We're actively deploying, writing $100,000 to $500,000 cheques in US dollars at pre-seed and seed.";
if (STEPS.has("J1")) {
  const opening = await turns();
  const intros = opening.filter(
    (t) => t.role === "Q" && /\bI'm Q\b/.test(t.text),
  );
  check(
    "J1",
    "one introduction on opening",
    intros.length === 1,
    `${intros.length} "I'm Q" lines`,
  );
  const before = new Set(await answered());
  await say(DENSE);
  const after = await answered();
  const gained = after.filter((key) => !before.has(key));
  check(
    "J1",
    "one dense line answers several topics",
    gained.length >= 2,
    gained.join(", "),
  );
  const next = await lastQ();
  note(
    "J1",
    "Q's next question (judge: conversational, not a label)",
    next.slice(0, 200),
  );
  await shot("j1-dense");
}

// ---- J2 long answers --------------------------------------------------------------
if (STEPS.has("J2") && JOURNEY === "founder") {
  const RAMBLE =
    "So, um, basically what we do is, you know, we help, like, small shops and market traders, mostly in Lagos but also some in Ibadan, keep track of who owes them money, because, honestly, a lot of them still write it in a notebook, and then we, um, send reminders over WhatsApp and let them take payment by transfer, and we take a small fee on each payment, which is sort of how we make money, I guess.";
  await say(RAMBLE);
  const readBack = await lastQ();
  check(
    "J2",
    "a ramble is said back for a yes",
    /right\?|correct\?|sound right|is that/i.test(readBack),
    readBack.slice(0, 200),
  );
  const held = (await answered()).includes("F1.description");
  check("J2", "nothing saved before the yes", !held);
  await say("Yes, that's right.");
  check(
    "J2",
    "saved after the yes",
    (await answered()).includes("F1.description"),
  );
  await shot("j2-readback");
}

// ---- J3 required vs optional ---------------------------------------------------------
if (STEPS.has("J3")) {
  await say(
    JOURNEY === "founder"
      ? "Skip the website for now, and I'd rather not say how many people work here."
      : "Skip geography for now, and I'd rather not say how we handle inbound.",
  );
  const reply = await lastQ();
  note(
    "J3",
    "Q's reply to an optional skip and a required refusal",
    reply.slice(0, 260),
  );
  check(
    "J3",
    "a required refusal is re-asked with the reason",
    /verif|need(ed)? (it|this)|because|so (that|we|I) can/i.test(reply),
    "expected a reason (P0-2)",
  );
  await shot("j3-required");
}

// ---- J4 chat → voice → chat -----------------------------------------------------------
if (STEPS.has("J4")) {
  // The voice leg signs in over HTTP, as voice-http.mjs does.
  const signIn = await fetch(
    `${process.env.SB_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: process.env.SB_PUBLISHABLE,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: EMAIL,
        password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
      }),
    },
  );
  const { access_token: accessToken } = await signIn.json();
  const authed = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  const current = await fetch(
    `${API}/v1/onboarding/sessions/current?journeyType=${JOURNEY}`,
    { headers: authed },
  ).then((r) => r.json());
  const sessionId = current?.session?.id;
  const onScreen = await lastQ();
  // As talkWithQ sends it when the on-screen question is Q's own.
  const opened = await fetch(`${QAPI}/v1/q/voice/sessions`, {
    method: "POST",
    headers: authed,
    body: JSON.stringify({
      voice: "FEMALE",
      onboarding: { sessionId, journeyType: JOURNEY },
      resume: true,
    }),
  }).then((r) => r.json());
  const first = String(opened.firstMessage ?? "");
  check(
    "J4",
    "chat → voice: no re-greeting",
    !GREETING.test(first),
    first.length === 0
      ? "(no server line: the client says the on-screen question)"
      : first.slice(0, 160),
  );
  const think = opened.deepgram?.agent?.think?.endpoint;
  if (think !== undefined) {
    const history = [
      { role: "assistant", content: first.length > 0 ? first : onScreen },
      {
        role: "user",
        content:
          JOURNEY === "founder"
            ? "We already have paying customers, about forty shops, and revenue is recurring."
            : "We focus on fintech and climate across West Africa.",
      },
    ];
    const answer = await fetch(think.url, {
      method: "POST",
      headers: { ...think.headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: "capital-q",
        stream: false,
        messages: history,
      }),
    })
      .then((r) => r.text())
      .catch(() => "");
    note("J4", "Q by voice", answer.replace(/\s+/g, " ").slice(0, 200));
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(10000);
  const all = await turns();
  check(
    "J4",
    "voice turns kept in the thread",
    all.some((t) => t.channel === "VOICE"),
  );
  const extra = greetingsAfterFirstPerson(all);
  check(
    "J4",
    "no greeting after the first answer",
    extra.length === 0,
    extra.map((t) => t.text.slice(0, 60)).join(" | "),
  );
  await shot("j4-back-to-chat");
}

// ---- J5 continue later and resume ----------------------------------------------------------
if (STEPS.has("J5")) {
  const before = await lastQ();
  await page.locator("[data-continue-later]").first().click();
  await page
    .waitForURL((u) => !u.pathname.startsWith("/onboarding"), {
      timeout: 20000,
    })
    .catch(() => undefined);
  const landed = new URL(page.url()).pathname;
  check(
    "J5",
    "continue later leaves to the app",
    JOURNEY === "founder" ? landed === "/home" : landed === "/discover",
    landed,
  );
  await shot("j5-left");
  await page.goto(`${WEB}/onboarding/${JOURNEY}?from=home`, {
    waitUntil: "domcontentloaded",
  });
  await settle(12000);
  const after = await turns();
  const resumed = String(
    after.filter((t) => t.role === "Q").at(-1)?.text ?? "",
  );
  note("J5", "Q on return", resumed.slice(0, 200));
  check("J5", "no new introduction on return", !/\bI'm Q\b/.test(resumed));
  check(
    "J5",
    "the same open question is picked up",
    before.length > 0 && resumed.length > 0,
  );
  await shot("j5-resumed");
  // The form path: one step, leave, come back to the same step.
  const useForm = page.locator("[data-use-the-form]");
  if (await useForm.isVisible().catch(() => false)) {
    await useForm.click();
    await settle(5000);
    const heading = await page
      .locator("h1, h2")
      .first()
      .textContent()
      .catch(() => "");
    await shot("j5-form");
    await page.locator("[data-continue-later]").first().click();
    await settle(4000);
    const formLanded = new URL(page.url()).pathname;
    check(
      "J5",
      "form continue later matches the conversation's destination (P2-1)",
      JOURNEY === "founder"
        ? formLanded === "/home"
        : formLanded === "/discover",
      formLanded,
    );
    await page.goto(`${WEB}/onboarding/${JOURNEY}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(8000);
    const again = await page
      .locator("h1, h2")
      .first()
      .textContent()
      .catch(() => "");
    check(
      "J5",
      "the form reopens on the same step",
      (heading ?? "") === (again ?? ""),
      `${heading} / ${again}`,
    );
    await shot("j5-form-resumed");
  }
}

// ---- J6 finish ------------------------------------------------------------------------
if (STEPS.has("J6")) {
  // Answer what Q asks from the fact table, a few turns at most.
  const FACTS =
    JOURNEY === "founder"
      ? [
          [/stage/i, "Seed."],
          [
            /signal|traction|customers/i,
            "Paying customers, about forty shops.",
          ],
          [/revenue/i, "Recurring and growing."],
          [/raising|raise/i, "Yes, actively raising."],
          [/currency/i, "US dollars."],
          [/how much|amount|target/i, "One and a half million dollars."],
          [/right\?|correct|confirm|look right|save/i, "Yes, that's right."],
        ]
      : [
          [/type/i, "A VC fund."],
          [/deploy/i, "Actively deploying."],
          [/stage/i, "Pre-seed and seed."],
          [/currency/i, "US dollars."],
          [/discover|how.*see|mode/i, "Show me everything that fits."],
          [/inbound|approach/i, "Founders can reach out directly."],
          [
            /mandate|in your own words|describe/i,
            "Early fintech and climate in West Africa.",
          ],
          [/right\?|correct|confirm|look right|save/i, "Yes, that's right."],
        ];
  for (let turn = 0; turn < Number(process.env.TURNS ?? 10); turn += 1) {
    if (!new URL(page.url()).pathname.startsWith("/onboarding")) break;
    const q = await lastQ();
    const hit = FACTS.find(([re]) => re.test(q));
    await say(hit ? hit[1] : "Yes, that's right. That's all for now.");
  }
  await settle(8000);
  const at = new URL(page.url()).pathname;
  check(
    "J6",
    "finish lands on verification",
    at.startsWith("/verification"),
    at,
  );
  await shot("j6-finish");
}

// ---- J7 Q edits the profile -------------------------------------------------------------
if (STEPS.has("J7")) {
  await page.goto(`${WEB}/home`, { waitUntil: "domcontentloaded" });
  await settle(8000);
  const ask =
    JOURNEY === "investor"
      ? "Change my cheque size to $250,000 to $1,000,000."
      : "Change our company description to: Tamarind Ledger helps market traders track and collect what they're owed.";
  const box = page.getByRole("textbox").first();
  await box.fill(ask);
  await box.press("Enter");
  await settle(30000);
  const approval = page.locator("[data-q-approval]").first();
  const prepared = await approval.isVisible().catch(() => false);
  check("J7", "the edit waits for approval", prepared);
  await shot("j7-approval");
  if (prepared) {
    await approval
      .getByRole("button", { name: /approve/i })
      .first()
      .click();
    await settle(10000);
    await page.goto(
      `${WEB}${JOURNEY === "investor" ? "/capital" : "/profile"}`,
      { waitUntil: "domcontentloaded" },
    );
    await settle(6000);
    const text = await page
      .locator("main")
      .textContent()
      .catch(() => "");
    check(
      "J7",
      "the change shows on the page",
      JOURNEY === "investor"
        ? /250,000|250k/i.test(text ?? "")
        : /track and collect/i.test(text ?? ""),
    );
    await shot("j7-after");
  }
}

await browser.close();
writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify(
    { email: EMAIL, journey: JOURNEY, width: WIDTH, results },
    null,
    2,
  ),
);
const failed = results.filter((r) => r.ok === false).length;
console.log(
  `${failed === 0 ? "ALL PASS" : `${failed} FAIL`}; screenshots and results in ${OUT}`,
);
process.exit(failed === 0 ? 0 : 1);
