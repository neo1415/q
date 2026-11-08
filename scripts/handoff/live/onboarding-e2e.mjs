// Onboarding end-to-end (DECISIONS 76/77; plan: docs/ai-handoff/ONBOARDING-TEST-PLAN.md).
//
// Every run creates a FRESH fictional account (@fictional.capitalq.local
// only; invented company and firm names marked "(fictional)") and drives
// one journey on production at 1440 and 390 wide, with a screenshot per
// step. Voice is driven over HTTP the way voice-http.mjs does it: a real
// q-api voice session, opened on the onboarding session, with the speech
// provider's part played by this script (transcript text to the think
// endpoint). Q's lines and the saved answers are read through the product
// API as the person (their own session), never guessed from the page.
//
// Nothing runs against production unless CQ_E2E_GO=1: without it the
// script prints what it would do and exits 0. Q turns are kept few (dense
// answers, ~6-10 a journey). No outward message reaches a real person:
// fictional accounts only, no invites, no chat to a counterparty.
//
//   CQ_E2E_GO=1 NODE_USE_ENV_PROXY=1 JOURNEY=founder|investor \
//   STEPS=J1,J2,J3,J4,J5,J6,J7 VIEWPORT=1440|390 OUT=<dir> \
//   SB_URL=... SB_KEY=<admin, for creating the account only> \
//   SB_PUBLISHABLE=... CQ_SEED_ACCOUNT_PASSWORD=... \
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
  J2: "long answers: a ramble is said back for a yes; a clear typed answer is kept whole (DECISIONS 77; P1-1 reader v15)",
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

// ---- reads of the record, as the person (their own data, the product API) --
// Run 1 (7 Nov) read these through the management API, and every read came
// back empty: a refused or failed query was taken for "no rows". These are
// the person's own onboarding session and thread, read with their own
// session, and a failed read stops the run instead of passing for empty.
let accessToken = null;
const token = async () => {
  if (accessToken !== null) return accessToken;
  const signedIn = await fetch(
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
  if (!signedIn.ok) throw new Error(`HTTP sign-in: ${signedIn.status}`);
  accessToken = (await signedIn.json()).access_token;
  return accessToken;
};
const apiGet = async (path) => {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${await token()}` },
  });
  if (!response.ok) {
    throw new Error(`read ${path.split("?")[0]}: HTTP ${response.status}`);
  }
  return response.json();
};
/** The person's current onboarding session view (null before one exists). */
const view = async () => {
  try {
    return await apiGet(
      `/v1/onboarding/sessions/current?journeyType=${JOURNEY}`,
    );
  } catch (error) {
    if (String(error.message).includes("HTTP 404")) return null;
    throw error;
  }
};
/** The interview thread, oldest first: role, text, channel, createdAt. */
const turns = async () => {
  const current = await view();
  if (current === null) return [];
  const listed = await apiGet(
    `/v1/onboarding/sessions/${current.session.id}/turns?limit=100`,
  );
  return listed.items ?? [];
};
/** Step keys with a current response. */
const answered = async () =>
  ((await view())?.responses ?? []).map((r) => String(r.stepKey));
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
  executablePath:
    process.env.CQ_E2E_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
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
  // P1-1 (reader v15): a clear typed answer is kept in their words and
  // saved without a read-back.
  const CLEAR =
    "The problem we solve: small traders lose about a fifth of what they are owed because credit is tracked in paper notebooks, reminders are awkward to send, and there is no simple way for a customer to pay a debt by transfer.";
  // Run 3: the say-back above already saved F9.problem, so this answer
  // UPDATES it. Judge the problem's stored text, not newly answered keys
  // (which an update never adds).
  const problemText = async () => {
    const value = ((await view())?.responses ?? []).find(
      (r) => r.stepKey === "F9.problem",
    )?.value;
    return value?.type === "TEXT" ? value.text : "";
  };
  const problemBefore = await problemText();
  await say(CLEAR);
  const reply = await lastQ();
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const problemAfter = await problemText();
  note("J2", "Q after a clear typed answer", reply.slice(0, 200));
  note(
    "J2",
    "F9.problem before → after",
    `${problemBefore.slice(0, 80)} → ${problemAfter.slice(0, 120)}`,
  );
  check(
    "J2",
    "a clear typed answer is saved in their words, not read back",
    /a fifth of what they are owed/i.test(problemAfter) &&
      !/is that right|did I get that|shall I save/i.test(reply),
    problemAfter.slice(0, 120),
  );
}

// ---- J3 required vs optional ---------------------------------------------------------
if (STEPS.has("J3")) {
  // Founder v9 / investor v4 (DECISIONS 79): the founder's website and
  // the investor's geography and inbound are REQUIRED; team size is
  // optional. So: an optional skip (team size; for the investor the
  // discovery style), and a required refusal (website; inbound).
  await say(
    JOURNEY === "founder"
      ? "Skip the team size for now, and I'd rather not give the website."
      : "Skip the discovery style for now, and I'd rather not say how we handle inbound.",
  );
  const reply = await lastQ();
  note(
    "J3",
    "Q's reply to an optional skip and a required refusal",
    reply.slice(0, 260),
  );
  // What is stored for the required step they would rather not give, after
  // stating it earlier (J1): a decline of an answered required step is
  // refused, so their earlier answer should still stand.
  const requiredStep =
    JOURNEY === "founder" ? "F1.website" : "I10.inbound_preference";
  const stored = ((await view())?.responses ?? []).find(
    (r) => r.stepKey === requiredStep,
  );
  note(
    "J3",
    `stored for ${requiredStep}`,
    JSON.stringify(stored?.value ?? null),
  );
  check(
    "J3",
    "a required refusal is re-asked with the reason",
    /verif|need(ed)? (it|this)|because|so (that|we|I) can|matching|your profile|investors (can|see)/i.test(
      reply,
    ),
    "expected a reason (P0-2)",
  );
  await shot("j3-required");
}

// ---- J4 chat → voice → chat -----------------------------------------------------------
if (STEPS.has("J4")) {
  // The voice leg, as voice-http.mjs drives it, with the person's token.
  const authed = {
    authorization: `Bearer ${await token()}`,
    "content-type": "application/json",
  };
  const current = await view();
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
    // As the speech provider calls it (voice-http.mjs): a streamed reply.
    let answer = "";
    try {
      const response = await fetch(think.url, {
        method: "POST",
        headers: { ...think.headers, "content-type": "application/json" },
        body: JSON.stringify({
          model: "capital-q",
          stream: true,
          messages: history,
        }),
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const data = buffer.slice(0, at).replace(/^data: /, "");
          buffer = buffer.slice(at + 2);
          if (data === "[DONE]") continue;
          try {
            answer += JSON.parse(data).choices?.[0]?.delta?.content ?? "";
          } catch {
            // keep-alive or partial frame
          }
        }
      }
    } catch (error) {
      note("J4", "think failed", String(error?.message ?? error));
    }
    check("J4", "Q answers by voice", answer.trim().length > 0);
    check(
      "J4",
      "the voice turn greets nobody again",
      !GREETING.test(answer),
      answer.replace(/\s+/g, " ").slice(0, 200),
    );
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
    before.length > 0 &&
      resumed.length > 0 &&
      (/picking up where we left off/i.test(resumed) ||
        resumed.includes(before.split(/(?<=[.?!])\s+/u).at(-1) ?? before)),
    `before: ${before.slice(-120)} | after: ${resumed.slice(0, 160)}`,
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
  // J5 may have left the form open: finish in the conversation.
  await page.goto(`${WEB}/onboarding/${JOURNEY}?from=home`, {
    waitUntil: "domcontentloaded",
  });
  await settle(8000);
  const backToQ = page.getByRole("button", { name: /back to q/i });
  if (await backToQ.isVisible().catch(() => false)) {
    await backToQ.click();
    await settle(6000);
  }
  // Answer what Q asks from the fact table, a few turns at most. Matched
  // on the question Q actually put (its last sentence ending "?"), most
  // specific first: run 2 answered "Which currency are you raising in?"
  // with the raising line because /raising/ came before /currency/.
  const READ_BACK = [
    // Run 4: "right\?" matched "excluded outright?", so the exclusions
    // were answered "Yes, that's right." three times. A whole word now.
    /shall i keep|keep that|is that right|\bright\?|correct\?|confirm|look right|shall i save/i,
    "Yes, that's right.",
  ];
  // Run 3: the founder v9/v10 and investor v4/v5 required steps too, so J6
  // can finish (website, founders, team, city, year, one line; the
  // investor's website, country, role, lists and description). Most
  // specific first; matched on Q's question sentence only.
  // Batch 14 (D81): Q's topic playback ("Let me get this right: … Is that
  // right?", a replay "Thanks. So: … Is that right?") ends on "Is that
  // right?", which READ_BACK answers "Yes, that's right." A "why" Q asks
  // about a stated preference gets a short plausible reason, never the
  // preference again; first, before any topic rule its words also name.
  const WHY = [
    [
      /\bwhy\b[^?]*\bfounders?\b|\bfounders?\b[^?]*\bwhy\b/i,
      "Mostly speed: they move faster.",
    ],
    [
      /\bwhy\b[^?]*\b(capital efficien|efficien)/i,
      "It keeps them alive longer between rounds.",
    ],
    [
      /what puts you off|why (avoid|exclude|not|pass)|\bwhy\b[^?]*\b(gambling|crypto|tobacco|weapons|exclu)/i,
      "Regulation: our LPs won't touch it.",
    ],
    [
      /\bwhy\b[^?]*\b(west africa|region|geograph|fintech|clean energy|sector)/i,
      "That's where our network and our LPs are.",
    ],
    [
      /^\s*why\b|\bwhy (is|does|do|that)\b|what are you (trying|hoping) to achieve|what draws you/i,
      JOURNEY === "founder"
        ? "Our customers asked for it directly."
        : "It's where we've done best.",
    ],
  ];
  const FACTS =
    JOURNEY === "founder"
      ? [
          ...WHY,
          READ_BACK,
          // Run 8: the finances, fictional and plausible, all together;
          // before "spend" (use of funds), "growth" and "revenue", which the same questions name.
          [
            /gross margin|burn|monthly spend|spend beyond|cash in the bank|cash on hand|runway|financial details/i,
            "Gross margin about 60%, burn about $25k a month beyond revenue, $300k in the bank, about 12 months of runway.",
          ],

          [/website|site\b|web address/i, "tamarindledger.example"],
          [
            /one line|in a line|one sentence|tagline/i,
            "Tamarind Ledger helps market traders track and collect what they're owed.",
          ],
          [/which city|what city|\bcity\b/i, "Lagos."],
          [/what year|which year|founded|start(ed)? the company/i, "2021."],
          [
            /how many founders|number of founders|founders are there/i,
            "Two founders.",
          ],
          [/full[- ]time/i, "Both of us are full-time."],
          [
            /how many people|team size|people work|employees|headcount/i,
            "Nine people.",
          ],
          [/your role|role at|what do you do at/i, "I'm the CEO."],
          [/cover|functions|between you/i, "Product, engineering and sales."],
          [/which country|what country|based|where is/i, "Lagos, Nigeria."],
          [/currency/i, "US dollars."],
          [
            /how much|amount|target|size of the round/i,
            "One and a half million dollars.",
          ],
          [/instrument|safe|equity|convertible|structure/i, "A SAFE."],
          [/when .*close|timeframe|timeline|by when/i, "Within six months."],
          [/use of funds|money .*go|spend|go towards/i, "Product and hiring."],
          [/growth|growing/i, "Growing about ten percent a month."],
          [/pilots|design partners/i, "Three pilots."],
          [/stage/i, "Seed."],
          [/problem/i, "Market traders lose track of what they're owed."],
          [
            /sector|industry|categor|space you're in/i,
            "Fintech for small merchants.",
          ],
          [/deck|material|document|upload/i, "I don't have a deck yet."],
          [
            /signal|traction|customers/i,
            "Paying customers, about forty shops.",
          ],
          [/revenue/i, "Recurring and growing."],
          [/raising|raise|fundrais/i, "Yes, actively raising."],
          [/anything else|anything more|missed/i, "No, that's everything."],
        ]
      : [
          ...WHY,
          // Run 5: a read-back of what they said ("From what you said: …
          // Shall I keep that/these?") is a plain yes, before the cheque
          // rule: the figures read back are the ones they gave.
          [/shall i keep (that|these|them)/i, "Yes."],
          // Run 4: one answer for every cheque question, all three figures,
          // before the read-back: a proposal of other figures is corrected,
          // never agreed to, and never answered one figure at a time (the
          // range looped ten turns on mismatched single figures).
          [
            /cheque|ticket|minimum|typical|maximum|smallest|largest/i,
            "Minimum $250,000, typical $500,000, maximum $1,000,000.",
          ],
          // Making the mandate live is a yes, not the discovery style.
          [/mandate live|make .* live|go live|activate/i, "Yes, make it live."],
          READ_BACK,
          // Batch 9: Q's one short follow-up about a theme's lists the
          // first answer left open ("Anything on green flags, or no
          // preference?"): an explicit none, so it is not asked again.
          [/^\s*anything on\b/i, "No preference."],
          // The themed "what makes you lean in" question (batch 9) and a
          // green-flags question name "anything else" and "revenue" too.
          [/lean in|green flag/i, "Repeat founders and capital efficiency."],
          // Before "founder" and "look for": what else, and inbound, are
          // their own questions (run 4: both got the founder answer).
          [
            /anything else|anything more|missed|haven.t covered/i,
            "No, that's everything.",
          ],
          [
            /inbound|reaching out|reach (you|out)|approach/i,
            "Only well-matched founders.",
          ],
          [/website|site\b|web address/i, "wadden.example"],
          [/which country|what country|based|headquarter/i, "The Netherlands."],
          [/your role|role there|title/i, "Partner."],
          [
            /describe your firm|firm to a founder|about your firm/i,
            "We back early fintech and climate companies in West Africa.",
          ],
          [/currency/i, "US dollars."],
          [/lead|co-?invest|follow/i, "We lead and co-invest."],
          [
            // Run 6: "Are those musts, or more of a preference?" went to the
            // default 13 times.
            /how firm|must match|strong preference|nice to have|\bmusts?\b|must-haves?|more of a preference|firmness/i,
            "A strong preference.",
          ],
          [/where do you invest|geograph|region/i, "West Africa."],
          [
            /off the table|rather not see|avoid|never (want|show|be shown)|exclude|exclusion/i,
            "None.",
          ],
          [/sector|industr|product area/i, "Fintech and climate."],
          [
            /company fits|business model|customer type|capital[- ]intens|regulat|revenue/i,
            "No preference.",
          ],
          [
            /lean in|founder|founding team|green flag|signal|look for/i,
            "Repeat founders and capital efficiency.",
          ],
          [/portfolio/i, "None yet."],
          [/deploy/i, "Actively deploying."],
          [/stage/i, "Pre-seed and seed."],
          [/type of investor|what kind of investor|type/i, "A VC fund."],
          [/discover|how.*see|mode/i, "Show me everything that fits."],
          [
            /mandate|thesis|in your own words|describe/i,
            "Early fintech and climate in West Africa.",
          ],
          [/anything else|anything more|missed/i, "No, that's everything."],
        ];
  const questionOf = (line) => {
    const asks = line.match(/[^.?!]*\?/gu);
    return asks === null ? line : asks[asks.length - 1];
  };
  const answers = [];
  for (let turn = 0; turn < Number(process.env.TURNS ?? 45); turn += 1) {
    if (!new URL(page.url()).pathname.startsWith("/onboarding")) break;
    const line = await lastQ();
    // Run 7: Q left a step for now and asked nothing; the runner replied
    // "That's all for now." eight times. A line that asks nothing is not
    // answered: the journey stops sending.
    // Run 8: "…I still need the remaining financial details: …" asks with
    // no "?". Only a line that closes ("for now", "whenever you're
    // ready", "all set") and asks for nothing stops it.
    const closes =
      !/[?؟]/u.test(line) &&
      /\b(for now|whenever you're ready|all set|everything else (is )?done|that's everything I need)\b/iu.test(
        line,
      ) &&
      !/\b(I (still )?need|could you|can you|please (share|tell|add)|what (is|are)|which)\b/iu.test(
        line,
      );
    if (answers.length > 0 && closes) {
      answers.push({
        q: line.trim().slice(0, 120),
        answer: "(stopped: Q asked nothing)",
      });
      break;
    }
    const q = questionOf(line);
    const hit = FACTS.find(([re]) => re.test(q));
    const answer = hit ? hit[1] : "Yes, that's right. That's all for now.";
    answers.push({ q: q.trim().slice(0, 120), answer });
    await say(answer);
  }
  note("J6", "questions answered from the fact table", JSON.stringify(answers));
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
