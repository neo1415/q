// V1 Priority-0 journey certification (lane H), on production.
//
// One reproducible, authenticated run of the two-sided journey, with only
// fictional accounts (@fictional.capitalq.local) and invented names marked
// "(fictional)":
//
//   1  a fresh founder signs in, finishes onboarding through the FORM path
//      (the same step-by-step responses the form screen submits, under the
//      founder's own session), then makes the company visible to investors
//      with the product's own control on /company/visibility;
//   2  a fresh investor whose mandate matches (fintech, seed, Nigeria /
//      West Africa, USD cheques) finishes onboarding the same way;
//   3  the investor's Discover: bounded polling for the founder company in
//      the precomputed slate; its profile; one source-backed question to Q;
//      a comparison with one other company; Save; Express Interest
//      (server-confirmed, in the UI) and a retried expression;
//   4  the founder's side: the interest as the founder sees it, what is and
//      is not shown, and the founder's Accept;
//   5  the canonical rows, read only: core.companies, the ONE
//      network.relationships row for the pair, its relationship_events in
//      order, and proof the retry wrote nothing new.
//
// Every step is PASS / FAIL / NOTE with evidence; a failed step stops only
// the branch that depends on it. Receipts and screenshots go to OUT (keep
// it outside git: they hold fictional account data and run ids).
//
// Nothing runs against production unless CQ_E2E_GO=1. No outward message
// reaches a real person: both parties are fictional, no invites are sent.
// No admin or service-role write touches product state: the admin key is
// used only to create the two sign-in accounts, exactly as
// onboarding-e2e.mjs and mkuser.mjs do; everything after is the person's
// own session through the web UI or the product's own API.
//
//   CQ_E2E_GO=1 NODE_USE_ENV_PROXY=1 OUT=<dir outside git> \
//   SB_URL=... SB_KEY=<admin, account creation only> SB_PUBLISHABLE=... \
//   CQ_SEED_ACCOUNT_PASSWORD=... [SUPABASE_ACCESS_TOKEN=<for step 5>] \
//   [PHASES=1,2,3,4,5] [STATE=<OUT>/state.json to resume] \
//   [DISCOVER_WAIT_MS=600000] [NARROW=1 for a 390 pass] \
//   node scripts/handoff/live/v1-journey-e2e.mjs
//
// Secrets are read from env by name and never printed or written.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { syntheticAccountMetadata } from "./synthetic-account.mjs";

const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const API =
  process.env.CQ_API_URL ?? "https://capital-qapi-production.up.railway.app";
const QAPI =
  process.env.CQ_Q_API_URL ??
  "https://capital-qq-api-production.up.railway.app";
const PHASES = new Set(
  (process.env.PHASES ?? "1,2,3,4,5").split(",").map((s) => s.trim()),
);
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const OUT = process.env.OUT ?? `/tmp/claude-0/v1-journey/${STAMP}`;
const DISCOVER_WAIT_MS = Number(process.env.DISCOVER_WAIT_MS ?? 600000);
const NARROW = process.env.NARROW === "1";
const FICTIONAL = /@fictional\.capitalq\.local$/;
const suffix = Math.random().toString(36).slice(2, 6);

// Invented, never a real company or firm (DECISIONS 77).
const FOUNDER_PERSON = "Ada Okonkwo-Test";
const COMPANY = `Ledgerline ${suffix.toUpperCase()} (fictional)`;
const INVESTOR_PERSON = "Tunde Bassey-Test";
const FIRM = `Harmattan ${suffix.toUpperCase()} Ventures (fictional)`;

const PLAN = [
  "1 founder: sign up, onboarding by form, company visible to investors",
  "2 investor: sign up, onboarding by form, matching active mandate",
  "3 discover (bounded poll), profile, Q question, compare, Save, Express Interest x2",
  "4 founder sees the interest; shown / not shown; Accept",
  "5 canonical rows: company, ONE relationship, ordered events, no duplicate",
];
// ENV_FILE: KEY=VALUE lines (a protected file outside git); read, never echoed.
if (process.env.ENV_FILE) {
  for (const line of readFileSync(process.env.ENV_FILE, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}
if (process.env.CQ_E2E_GO !== "1") {
  console.log("v1-journey-e2e (dry): fresh fictional founder and investor");
  for (const line of PLAN) {
    if (PHASES.has(line[0])) console.log(`  ${line}`);
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

// ---- state (resumable) and results ---------------------------------------------
const STATE_FILE = process.env.STATE ?? `${OUT}/state.json`;
const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : {};
const saveState = () =>
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
const results = [];
const record = (step, name, ok, detail = "") => {
  const status = ok === null ? "NOTE" : ok ? "PASS" : "FAIL";
  results.push({ step, name, status, detail, at: new Date().toISOString() });
  console.log(`${status} ${step} ${name}${detail ? ` — ${detail}` : ""}`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2), {
    mode: 0o600,
  });
  return ok;
};
const receipt = (name, value) =>
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
const clip = (text, n = 200) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const started = Date.now();
const since = () => `${Math.round((Date.now() - started) / 1000)}s`;

// ---- accounts and the product API, as the person ------------------------------
async function createAccount(email, person, organisation) {
  if (!FICTIONAL.test(email)) throw new Error("fictional accounts only");
  // As onboarding-e2e.mjs / mkuser.mjs: the sign-in account only. No
  // product row is written here; onboarding creates everything else.
  const res = await fetch(`${process.env.SB_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: process.env.SB_KEY,
      authorization: `Bearer ${process.env.SB_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
      email_confirm: true,
      ...syntheticAccountMetadata(email, {
        display_name: person,
        full_name: person,
        organisation_name: organisation,
      }),
    }),
  });
  if (!res.ok) throw new Error(`account not created: HTTP ${res.status}`);
}

const tokens = new Map();
async function token(email) {
  const held = tokens.get(email);
  if (held !== undefined && held.expires > Date.now() + 60000) return held.jwt;
  const res = await fetch(
    `${process.env.SB_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: process.env.SB_PUBLISHABLE,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP sign-in: ${res.status}`);
  const body = await res.json();
  tokens.set(email, {
    jwt: body.access_token,
    expires: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

/** One call under the person's own session; the problem kept, never thrown away. */
async function api(email, method, path, body, extra = {}) {
  const base = extra.base ?? API;
  const headers = { authorization: `Bearer ${await token(email)}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (extra.idempotencyKey) headers["idempotency-key"] = extra.idempotencyKey;
  if (extra.organisationId) headers["x-organisation-id"] = extra.organisationId;
  // A dropped socket through the proxy is retried; a request that changes
  // anything carries an idempotency key or is a save (keyed by its event
  // id), so a retry never writes twice.
  let res;
  for (let attempt = 1; ; attempt += 1) {
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  const text = await res.text();
  let json;
  try {
    json = text.length === 0 ? null : JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, json };
}
const problemOf = (r) =>
  r.ok
    ? ""
    : `HTTP ${r.status} ${clip(
        [
          r.json?.code,
          r.json?.title,
          r.json?.detail,
          ...(r.json?.errors ?? []).map((e) => `${e.path}: ${e.message}`),
        ]
          .filter((p) => typeof p === "string")
          .join(" | "),
        300,
      )}`;

/** Read-only SQL through hosted-read.mjs (select only; the proxy holds the key). */
function hostedRead(sql) {
  const out = execFileSync(
    process.execPath,
    [new URL("./hosted-read.mjs", import.meta.url).pathname, sql],
    {
      env: { ...process.env, MAX: "60000", NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
      timeout: 60000,
    },
  ).trim();
  const space = out.indexOf(" ");
  const status = Number(out.slice(0, space));
  if (status < 200 || status >= 300) throw new Error(`hosted read ${out}`);
  return JSON.parse(out.slice(space + 1));
}
const uuid = (value) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(value))) throw new Error("not a uuid");
  return String(value);
};

// ---- onboarding through the form path ----------------------------------------
// The answers that make the pair match: fintech, seed, Nigeria / West
// Africa, US dollars, a cheque range that fits a seed round. Matched on the
// step key, prompt and option labels the definition sends, never on ids.
const FOUNDER_TEXT = [
  [/website|web address|url/i, `https://ledgerline-${suffix}.example`],
  [/company.*name|name of (the|your) company|^name/i, COMPANY],
  [
    /one line|tagline|one sentence/i,
    "Ledgerline helps market traders in Lagos track and collect what they are owed.",
  ],
  [/city/i, "Lagos"],
  [
    /problem/i,
    "Small traders lose about a fifth of what they are owed because credit lives in paper notebooks.",
  ],
  [
    /description|what (does|do) (the company|you) do|describe/i,
    "Ledgerline (fictional) is a seed-stage fintech in Lagos, Nigeria: a credit ledger and WhatsApp payment reminders for market traders, paid per collected transfer.",
  ],
  [/role|title/i, "CEO"],
  [/./, "Fictional answer for a test journey."],
];
// Order matters: the first pattern any option matches wins a single
// choice, so the currency comes before the country ("ngn Nigerian naira")
// and the stage is "seed" exactly, never "pre_seed Pre-seed".
const SEED = /(^|\s)seed(\s|$)/i;
const FOUNDER_PICK = [
  /fintech|financial services|payments/i,
  /\bUSD\b|us dollar/i,
  SEED,
  /nigeria/i,
  /safe|equity/i,
  /actively|raising now|yes/i,
  /ceo|chief executive/i,
  /full[- ]time/i,
  /revenue|paying customers|growing/i,
  /product|hiring/i,
  /six months|3-6|within/i,
];
const INVESTOR_TEXT = [
  [/website|web address|url/i, `https://harmattan-${suffix}.example`],
  [/organisation_name|firm.*name|name of (the|your) (firm|fund)/i, FIRM],
  [
    /describe|thesis|mandate|in your own words|founder/i,
    "We back seed-stage fintech companies in Nigeria and West Africa.",
  ],
  [/role|title/i, "Partner"],
  [/./, "Fictional answer for a test journey."],
];
const INVESTOR_PICK = [
  /fintech|financial services|payments/i,
  /\bUSD\b|us dollar/i,
  SEED,
  /nigeria/i,
  /west africa/i,
  /venture|vc fund/i,
  /lead|co-?invest/i,
  /actively|deploying|yes/i,
  /partner/i,
  /everything that fits|show me everything|all/i,
  /only well-matched|well matched/i,
];
// Matched on the step key only, most specific first; plausible fictional
// figures in the currency chosen (US dollars).
const RANGES = [
  [/founder_count/i, "2"],
  [/team_size/i, "9"],
  [/founded_year|year/i, "2021"],
  [/customers/i, "40"],
  [/monthly_revenue/i, "8000"],
  [/gross_margin/i, "60"],
  [/burn/i, "25000"],
  [/cash/i, "300000"],
  [/runway/i, "12"],
  [/target_amount|amount|raise/i, "1500000"],
  [/min/i, "100000"],
  [/max/i, "1000000"],
  [/typical|cheque|ticket/i, "250000"],
];

async function chooseValue(email, step, journey) {
  const pres = step.presentation ?? {};
  const where = `${step.stepKey} ${step.prompt}`;
  // What to avoid must never name what the pair shares; how firm a
  // preference is stays a strong preference, so no hard rule is invented.
  // A hard exclusion may not repeat a soft "avoid" (the journey refuses it).
  const picks = /hard_exclusion/i.test(step.stepKey)
    ? [/adult/i]
    : /sector_exclusion/i.test(step.stepKey)
      ? [/coal/i, /oil|mining/i]
      : /avoid|exclu|rather not|off the table/i.test(where)
        ? [/gambling|betting/i, /tobacco/i, /weapon|defen[cs]e/i]
        : /strength|firmness/i.test(step.stepKey)
          ? [/strong/i, /prefer/i]
          : journey === "founder"
            ? FOUNDER_PICK
            : INVESTOR_PICK;
  const texts = journey === "founder" ? FOUNDER_TEXT : INVESTOR_TEXT;
  const labelOf = (o) => `${o.optionKey} ${o.label}`;
  const usable = (o) =>
    !/unknown|not sure|prefer not|none of|other\b|no preference/i.test(
      labelOf(o),
    );
  switch (pres.stepType) {
    case "single_select": {
      const options = pres.options ?? [];
      const hit =
        picks
          .map((re) => options.find((o) => re.test(labelOf(o))))
          .find(Boolean) ??
        options.find(usable) ??
        options[0];
      return hit
        ? { type: "SINGLE_SELECT", optionKey: hit.optionKey }
        : undefined;
    }
    case "multi_select": {
      const exclusive = new Set(pres.exclusiveOptionKeys ?? []);
      const options = (pres.options ?? []).filter(
        (o) => !exclusive.has(o.optionKey),
      );
      let keys = options
        .filter((o) => picks.some((re) => re.test(labelOf(o))))
        .map((o) => o.optionKey);
      const min = Math.max(1, pres.minSelections ?? 1);
      for (const o of options.filter(usable)) {
        if (keys.length >= min) break;
        if (!keys.includes(o.optionKey)) keys.push(o.optionKey);
      }
      keys = keys.slice(0, pres.maxSelections ?? keys.length);
      if (keys.length === 0 && pres.exclusiveOptionKeys?.length) {
        keys = [pres.exclusiveOptionKeys[0]];
      }
      return keys.length
        ? { type: "MULTI_SELECT", optionKeys: keys }
        : undefined;
    }
    case "range": {
      const hit = RANGES.find(([re]) => re.test(step.stepKey));
      const min = Number(pres.min);
      const max = Number(pres.max);
      const small = Math.min(max, Math.max(min, 1));
      let value = hit ? Number(hit[1]) : small;
      if (value < min || value > max) value = small;
      return { type: "RANGE", value: String(value) };
    }
    case "short_text":
    case "long_text":
    case "voice_text": {
      const hit = texts.find(([re]) => re.test(where));
      let text = hit[1];
      if (pres.minLength && text.length < pres.minLength) {
        text = `${text} ${"Fictional detail. ".repeat(20)}`.slice(
          0,
          Math.max(pres.minLength + 10, text.length),
        );
      }
      return { type: "TEXT", text: text.slice(0, pres.maxLength ?? 2000) };
    }
    case "confirmation":
      return { type: "CONFIRMATION", confirmed: true };
    case "reference_select": {
      // As the form's search does: the vocabularies' own nodes, read under
      // the person's session, chosen by name.
      if (pres.resourceType === "INVESTOR_MANDATE") {
        // The draft the step's own context suggests (the form preselects it).
        const ctx = step.context ?? {};
        const id = ctx.suggestedMandateId ?? ctx.candidates?.[0]?.mandateId;
        if (ctx.investorOrganisationId) {
          state.investorOrganisationId = ctx.investorOrganisationId;
        }
        if (id) state.mandateId = id;
        return id
          ? {
              type: "RESOURCE_REFERENCE",
              resourceType: "INVESTOR_MANDATE",
              resourceIds: [id],
            }
          : undefined;
      }
      if (pres.resourceType !== "TAXONOMY_NODE") return undefined;
      const pool = [];
      for (const code of pres.vocabularyCodes ?? []) {
        let cursor = null;
        for (let n = 0; n < 12; n += 1) {
          const r = await api(
            email,
            "GET",
            `/v1/taxonomy/vocabularies/${encodeURIComponent(code)}/nodes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          );
          if (!r.ok) break;
          for (const node of r.json.items ?? []) {
            pool.push({
              id: node.id,
              label: `${node.displayName} ${node.canonicalCode}`,
            });
          }
          cursor = r.json.nextCursor ?? null;
          if (!cursor) break;
        }
      }
      const chosen = [];
      for (const re of picks) {
        const hit = pool.find(
          (node) => re.test(node.label) && !chosen.includes(node.id),
        );
        if (hit) chosen.push(hit.id);
      }
      const ids = (
        chosen.length
          ? chosen
          : pool.slice(0, pres.minItems || 1).map((node) => node.id)
      ).slice(0, pres.maxItems ?? 5);
      return ids.length
        ? {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: ids,
          }
        : undefined;
    }
    default:
      return undefined; // document_upload and anything new: skip if allowed
  }
}

async function onboardByForm(email, journey) {
  const log = [];
  let r = await api(
    email,
    "POST",
    "/v1/onboarding/sessions",
    { journeyType: journey },
    { idempotencyKey: randomUUID() },
  );
  if (!r.ok) return { ok: false, detail: `start ${problemOf(r)}`, log };
  let view = r.json;
  const refusedOnce = new Set();
  for (let turn = 0; turn < 90; turn += 1) {
    const step = view.currentStep;
    if (step === null || step === undefined) break;
    // The last step (a snapshot confirmation) stays current once answered:
    // the journey waits for "complete", not for another answer.
    if (step.currentResponse && view.progress.canComplete) break;
    const sessionId = view.session.id;
    const version = view.session.version;
    const value = refusedOnce.has(step.stepKey)
      ? undefined
      : await chooseValue(email, step, journey);
    if (value === undefined) {
      if (!view.progress.canSkipCurrentStep) {
        log.push({ step: step.stepKey, type: step.stepType, stuck: true });
        return {
          ok: false,
          detail: `required ${step.stepKey} (${step.stepType}) has no answer and cannot be skipped`,
          log,
        };
      }
      r = await api(
        email,
        "POST",
        `/v1/onboarding/sessions/${sessionId}/steps/${encodeURIComponent(step.stepKey)}/skip`,
        { expectedSessionVersion: version },
        { idempotencyKey: randomUUID() },
      );
      log.push({ step: step.stepKey, type: step.stepType, skipped: r.status });
      if (!r.ok) return { ok: false, detail: `skip ${problemOf(r)}`, log };
      view = r.json;
      continue;
    }
    r = await api(
      email,
      "POST",
      `/v1/onboarding/sessions/${sessionId}/responses`,
      {
        stepKey: step.stepKey,
        response: { value, channel: "FORM" },
        expectedSessionVersion: version,
      },
      { idempotencyKey: randomUUID() },
    );
    log.push({
      step: step.stepKey,
      type: step.stepType,
      required: step.required,
      prompt: clip(step.prompt, 90),
      value,
      status: r.status,
      ...(r.ok ? {} : { problem: problemOf(r) }),
    });
    if (!r.ok) {
      refusedOnce.add(step.stepKey);
      const again = await api(
        email,
        "GET",
        `/v1/onboarding/sessions/${sessionId}`,
      );
      if (!again.ok) return { ok: false, detail: problemOf(again), log };
      view = again.json;
      continue;
    }
    view = r.json;
  }
  receipt(`onboarding-${journey}-before-complete`, {
    progress: view.progress,
    session: view.session,
  });
  if (!view.progress.canComplete) {
    return {
      ok: false,
      detail: `cannot complete; current ${view.progress.currentStepKey}`,
      log,
    };
  }
  r = await api(
    email,
    "POST",
    `/v1/onboarding/sessions/${view.session.id}/complete`,
    { expectedSessionVersion: view.session.version },
  );
  if (!r.ok) return { ok: false, detail: `complete ${problemOf(r)}`, log };
  return {
    ok: r.json.session.status === "COMPLETED",
    detail: `${log.length} steps, status ${r.json.session.status}`,
    log,
    view: r.json,
  };
}

// ---- the browser ------------------------------------------------------------------
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    new URL(
      "../../../node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
      import.meta.url,
    ).href
);
const browser = await chromium.launch({
  executablePath:
    process.env.CQ_E2E_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY } }
    : {}),
});
let shotNo = 0;
async function signedInPage(email, width = 1440) {
  const ctx = await browser.newContext({
    viewport:
      width === 390
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
  });
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("cq.splash.seen", "1");
    } catch {
      // A blocked store just shows the splash.
    }
  });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/auth/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("sign-in"), {
      timeout: 60000,
      waitUntil: "commit",
    }),
    page.keyboard.press("Enter"),
  ]);
  await page.waitForTimeout(3000);
  page.shot = async (name) => {
    shotNo += 1;
    await page
      .screenshot({
        path: `${OUT}/${String(shotNo).padStart(2, "0")}-${name}-${width}.png`,
      })
      .catch(() => undefined);
  };
  page.ctx = ctx;
  return page;
}
async function visit(page, path, wait = 6000) {
  const res = await page
    .goto(`${WEB}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch((error) => ({ status: () => `nav error ${clip(error.message)}` }));
  await page.waitForTimeout(wait);
  return res?.status?.() ?? null;
}
const mainText = async (page) =>
  clip(
    await page
      .locator("main")
      .first()
      .innerText()
      .catch(() => ""),
    4000,
  );

async function narrowPass(email, paths) {
  if (!NARROW) return;
  const page = await signedInPage(email, 390);
  for (const [name, path] of paths) {
    await visit(page, path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    await page.shot(name);
    record("390", `${name} has no horizontal overflow`, !overflow, path);
  }
  await page.ctx.close();
}

// ==== 1 founder ========================================================================
if (PHASES.has("1") && state.companyId === undefined) {
  state.founderEmail =
    state.founderEmail ?? `v1-fdr-${STAMP}-${suffix}@fictional.capitalq.local`;
  state.company = COMPANY;
  saveState();
  await createAccount(state.founderEmail, FOUNDER_PERSON, COMPANY);
  record("1", "founder account", true, state.founderEmail);
  const t0 = Date.now();
  const onboarded = await onboardByForm(state.founderEmail, "founder");
  receipt("onboarding-founder", onboarded.log);
  record(
    "1",
    "founder onboarding finished through the form path",
    onboarded.ok,
    `${onboarded.detail}; ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  const orgs = await api(state.founderEmail, "GET", "/v1/me/organisations");
  const own = (orgs.json?.items ?? []).find((o) => o.companyId);
  state.companyId =
    own?.companyId ?? onboarded.view?.session?.subject?.id ?? undefined;
  state.founderOrganisationId = own?.organisationId;
  saveState();
  record(
    "1",
    "a canonical company exists for the founder",
    Boolean(state.companyId),
    `companyId ${state.companyId ?? "none"}; ${problemOf(orgs)}`,
  );
}
if (PHASES.has("1") && state.companyId && !state.visibleAt) {
  const page = await signedInPage(state.founderEmail);
  await visit(page, "/company/visibility", 8000);
  await page.shot("founder-visibility-before");
  const make = page.getByRole("button", { name: /make visible to investors/i });
  if (await make.isVisible().catch(() => false)) {
    await make.click();
    await page.waitForTimeout(6000);
  }
  await page.shot("founder-visibility-after");
  const company = await api(
    state.founderEmail,
    "GET",
    `/v1/companies/${state.companyId}`,
  );
  const visible = company.json?.marketplaceVisibility === "network_visible";
  if (visible) state.visibleAt = new Date().toISOString();
  saveState();
  record(
    "1",
    "the company is visible to investors through /company/visibility",
    visible,
    `marketplaceVisibility ${company.json?.marketplaceVisibility}; page: ${clip(
      await mainText(page),
      220,
    )}`,
  );
  const ready = await api(
    state.founderEmail,
    "GET",
    `/v1/companies/${state.companyId}/marketplace-readiness`,
  );
  receipt("founder-readiness", ready.json);
  const outstanding = (ready.json?.requirements ?? [])
    .filter((x) => x.outcome !== "SATISFIED" && x.outcome !== "NOT_APPLICABLE")
    .map((x) => `${x.requirement}:${x.outcome}`);
  state.readiness = ready.json?.state ?? ready.json?.readinessState;
  saveState();
  record(
    "1",
    "marketplace readiness after visibility",
    null,
    `${problemOf(ready) || JSON.stringify(state.readiness)}; outstanding ${outstanding.join(", ") || "none"}`,
  );
  // What the product offers a founder for the verification requirements.
  await visit(page, "/verification", 8000);
  await page.shot("founder-verification");
  record(
    "1",
    "what /verification offers the founder",
    null,
    clip(await mainText(page), 300),
  );
  await page.ctx.close();
  await narrowPass(state.founderEmail, [
    ["founder-visibility", "/company/visibility"],
  ]);
}

// ==== 2 investor =======================================================================
if (PHASES.has("2") && state.investorOrganisationId === undefined) {
  state.investorEmail =
    state.investorEmail ?? `v1-inv-${STAMP}-${suffix}@fictional.capitalq.local`;
  state.firm = FIRM;
  saveState();
  await createAccount(state.investorEmail, INVESTOR_PERSON, FIRM);
  record("2", "investor account", true, state.investorEmail);
  const t0 = Date.now();
  const onboarded = await onboardByForm(state.investorEmail, "investor");
  receipt("onboarding-investor", onboarded.log);
  record(
    "2",
    "investor onboarding finished through the form path",
    onboarded.ok,
    `${onboarded.detail}; ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  const orgs = await api(state.investorEmail, "GET", "/v1/me/organisations");
  receipt("investor-organisations", orgs.json);
  // The mandate step's context names the investor organisation; the
  // person's organisation list is the fallback (it can hold a personal one).
  const own =
    (orgs.json?.items ?? []).find(
      (o) => o.organisationId === state.investorOrganisationId,
    ) ??
    (orgs.json?.items ?? []).find((o) => /invest/i.test(o.organisationType)) ??
    (orgs.json?.items ?? []).find((o) => !o.companyId);
  state.investorOrganisationId =
    state.investorOrganisationId ?? own?.organisationId;
  state.mandateReadyAt = new Date().toISOString();
  saveState();
  record(
    "2",
    "an investor organisation exists",
    Boolean(state.investorOrganisationId),
    `organisationId ${state.investorOrganisationId ?? "none"}; listed ${(orgs.json?.items ?? []).map((o) => `${o.organisationType}:${o.organisationId.slice(0, 8)}`).join(",")}`,
  );
  if (state.mandateId) {
    const mandate = await api(
      state.investorEmail,
      "GET",
      `/v1/investors/${state.investorOrganisationId}/mandates/${state.mandateId}`,
    );
    receipt("investor-mandate", mandate.json);
    record(
      "2",
      "the mandate is ACTIVE",
      mandate.json?.status === "ACTIVE",
      `${state.mandateId} ${mandate.json?.status ?? problemOf(mandate)}`,
    );
  }
  const answered = (onboarded.log ?? [])
    .filter((x) => x.value)
    .map((x) => `${x.step}=${clip(JSON.stringify(x.value), 70)}`);
  record("2", "mandate answers given", null, clip(answered.join("; "), 900));
}

// ==== 3 investor journey ===============================================================
if (PHASES.has("3") && state.investorEmail && state.companyId) {
  const inv = state.investorEmail;
  // Bounded polling of the precomputed slate; every page of it.
  const t0 = Date.now();
  let found = null;
  let polls = 0;
  let last = null;
  let other = null;
  while (Date.now() - t0 < DISCOVER_WAIT_MS) {
    polls += 1;
    let cursor = null;
    const seen = [];
    for (let pageNo = 0; pageNo < 10; pageNo += 1) {
      const r = await api(
        inv,
        "GET",
        `/v1/discovery/companies?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      last = {
        status: r.status,
        slateId: r.json?.slateId ?? null,
        notes: r.json?.notes ?? null,
        discoverableCount: r.json?.discoverableCount ?? null,
        excludingRules: r.json?.excludingRules ?? null,
        problem: problemOf(r),
      };
      if (!r.ok) break;
      seen.push(...r.json.items);
      cursor = r.json.nextCursor;
      if (!cursor) break;
    }
    found = seen.find((i) => i.companyId === state.companyId) ?? null;
    other = other ?? seen.find((i) => i.companyId !== state.companyId) ?? null;
    last.items = seen.length;
    if (found) break;
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  receipt("discover-last-page", last);
  const waited = Math.round((Date.now() - t0) / 1000);
  state.otherCompanyId = other?.companyId;
  state.otherCompanyName = other?.canonicalName;
  state.slateId = last?.slateId;
  saveState();
  record(
    "3",
    "the founder company appears in the investor's Discover slate",
    Boolean(found),
    `${found ? "found" : "not found"} after ${waited}s, ${polls} polls; slate ${last?.slateId}; items ${last?.items}; discoverableCount ${last?.discoverableCount}; notes ${clip(JSON.stringify(last?.notes), 200)}`,
  );

  const page = await signedInPage(inv);
  await visit(page, "/discover", 10000);
  await page.shot("investor-discover");
  const onCard = await page
    .locator(`[data-company-id="${state.companyId}"]`)
    .count();
  record(
    "3",
    "Discover (UI) shows the founder company card",
    onCard > 0,
    `cards for it: ${onCard}; first text: ${clip(await mainText(page), 160)}`,
  );

  // The profile, by its canonical address.
  const status = await visit(page, `/company/${state.companyId}`, 10000);
  await page.shot("investor-profile");
  const profileText = await mainText(page);
  const nameStem = state.company.split(" (")[0];
  record(
    "3",
    "the company profile opens for the investor",
    status === 200 && profileText.includes(nameStem),
    `HTTP ${status}; ${clip(profileText, 220)}`,
  );

  // One source-backed question to Q, from the profile.
  {
    const question = `What does ${nameStem} do, and which source says so?`;
    const runs = [];
    page.on("request", (req) => {
      const m = /\/q\/runs\/([0-9a-f-]{36})/i.exec(new URL(req.url()).pathname);
      if (m && !runs.includes(m[1])) runs.push(m[1]);
    });
    let input = page.getByPlaceholder("Ask Q", { exact: true });
    try {
      if (!(await input.isVisible().catch(() => false))) {
        const opener = page
          .locator("[data-q-dock-button]:visible")
          .or(page.getByRole("button", { name: "Ask Q", exact: true }))
          .first();
        await opener.click({ timeout: 30000 });
        input = page.getByPlaceholder("Ask Q", { exact: true });
        await input.waitFor({ timeout: 30000 });
      }
      await input.fill(question);
      await input.press("Enter");
      for (let n = 0; n < 100 && runs.length === 0; n += 1) {
        await page.waitForTimeout(300);
      }
      let run = null;
      const runId = runs.at(-1);
      for (let n = 0; runId && n < 90; n += 1) {
        const r = await api(inv, "GET", `/v1/q/runs/${runId}`, undefined, {
          base: QAPI,
        });
        run = r.json;
        if (
          [
            "COMPLETED",
            "FAILED",
            "AWAITING_INPUT",
            "AWAITING_APPROVAL",
          ].includes(run?.status)
        )
          break;
        await page.waitForTimeout(2000);
      }
      await page.waitForTimeout(3000);
      await page.shot("investor-q-answer");
      receipt("q-run", run);
      const answer = (run?.messages ?? []).findLast(
        (m) => m.role === "Q" && m.runId === run.runId,
      );
      const blocks = answer?.blocks ?? [];
      const kinds = [...new Set(blocks.map((b) => b.kind))];
      const findings = blocks
        .filter((b) => b.kind === "FINDING")
        .map((b) => b.finding);
      const refs = findings.flatMap((f) => f?.evidenceRefs ?? []);
      const axes = findings
        .map((f) => `${f?.truthClass}/${f?.evidenceStatus}`)
        .join(", ");
      record(
        "3",
        "Q answers one question about the company",
        run?.status === "COMPLETED" && Boolean(answer?.text),
        `run ${runId ?? "none"} ${run?.status}; "${clip(answer?.text, 260)}"`,
      );
      // Source-backed means a finding carries evidence references, not only
      // prose that names a source.
      record(
        "3",
        "Q's answer is source-backed (findings carry evidenceRefs)",
        refs.length > 0,
        `blocks ${kinds.join(",") || "none"}; findings ${findings.length} (${axes}); evidenceRefs ${refs.length}; text names a source: ${/source/i.test(answer?.text ?? "")}`,
      );
    } catch (error) {
      await page.shot("investor-q-error");
      record(
        "3",
        "Q answers one question about the company",
        false,
        clip(error.message),
      );
    }
  }

  // Save, as the product's save command (the card's Save, from the profile).
  for (const [id, label] of [
    [state.companyId, "founder company"],
    [state.otherCompanyId, "other company"],
  ]) {
    if (!id) continue;
    const r = await api(inv, "POST", `/v1/discovery/companies/${id}/save`, {
      clientEventId: `v1j-save-${randomUUID().slice(0, 12)}`,
      surface:
        found || label === "other company"
          ? "RECOMMENDATION_FEED"
          : "COMPANY_PROFILE",
      ...(state.slateId ? { slateId: state.slateId } : {}),
    });
    record("3", `Save the ${label}`, r.ok, `${id}; ${problemOf(r) || "saved"}`);
  }
  const saved = await api(inv, "GET", "/v1/discovery/saved");
  record(
    "3",
    "Saved lists the founder company",
    JSON.stringify(saved.json ?? {}).includes(state.companyId),
    problemOf(saved) || clip(JSON.stringify(saved.json), 200),
  );

  // Compare, side by side, through the product's compare screen.
  if (state.otherCompanyId) {
    await visit(
      page,
      `/discover/saved/compare?ids=${state.companyId},${state.otherCompanyId}`,
      12000,
    );
    await page.shot("investor-compare");
    const text = await mainText(page);
    const both =
      text.includes(nameStem) &&
      text.includes(String(state.otherCompanyName ?? "").slice(0, 12));
    record(
      "3",
      "compare shows the founder company beside one other",
      both,
      `other ${state.otherCompanyName}; ${clip(text, 220)}`,
    );
  } else {
    record(
      "3",
      "compare shows the founder company beside one other",
      false,
      "no other company in the slate",
    );
  }

  // Express Interest, server-confirmed, in the UI.
  await visit(page, `/company/${state.companyId}`, 10000);
  const express = page
    .getByRole("button", { name: new RegExp(`^express interest`, "i") })
    .first();
  let uiInterest = false;
  if (await express.isVisible().catch(() => false)) {
    await express.click();
    await page.waitForTimeout(1500);
    await page.shot("investor-interest-confirm");
    const confirm = page
      .getByRole("dialog")
      .getByRole("button", { name: /express interest/i })
      .or(page.getByRole("button", { name: /^express interest$/i }).last());
    if (
      await confirm
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await confirm.first().click();
    }
    await page
      .getByText(/interest sent/i)
      .first()
      .waitFor({ timeout: 30000 })
      .then(() => {
        uiInterest = true;
      })
      .catch(() => undefined);
  }
  await page.shot("investor-interest-sent");
  const own = await api(
    inv,
    "GET",
    `/v1/network/companies/${state.companyId}/interest`,
  );
  state.interestId = own.json?.interest?.interestId;
  state.relationshipId = own.json?.interest?.relationshipId;
  saveState();
  record(
    "3",
    "Express Interest in the UI is server-confirmed",
    uiInterest && Boolean(state.interestId),
    `UI "Interest sent": ${uiInterest}; server interest ${state.interestId ?? "none"} rel ${state.relationshipId ?? "none"}; ${problemOf(own)}; page ${clip(await mainText(page), 160)}`,
  );

  // A retried expression: the same key twice, then a new key (a second click).
  const key = randomUUID();
  const body = { surface: "COMPANY_PROFILE" };
  const a = await api(
    inv,
    "POST",
    `/v1/network/companies/${state.companyId}/express-interest`,
    body,
    { idempotencyKey: key },
  );
  const b = await api(
    inv,
    "POST",
    `/v1/network/companies/${state.companyId}/express-interest`,
    body,
    { idempotencyKey: key },
  );
  const c = await api(
    inv,
    "POST",
    `/v1/network/companies/${state.companyId}/express-interest`,
    body,
    { idempotencyKey: randomUUID() },
  );
  receipt("interest-retries", { a, b, c });
  const ids = [a, b, c].map(
    (r) => r.json?.interest?.interestId ?? problemOf(r),
  );
  const rels = [a, b, c].map((r) => r.json?.interest?.relationshipId ?? null);
  if (!state.interestId && a.ok) {
    state.interestId = a.json.interest.interestId;
    state.relationshipId = a.json.interest.relationshipId;
    saveState();
  }
  record(
    "3",
    "a retried Express Interest returns the same interest, nothing new",
    [a, b, c].every((r) => r.ok) &&
      new Set(ids).size === 1 &&
      ids[0] === state.interestId &&
      new Set(rels).size === 1 &&
      [a, b, c].every((r) => r.json?.deduplicated === true),
    `ids ${ids.join(" / ")}; relationship ${[...new Set(rels)].join(",")}; deduplicated ${[a, b, c].map((r) => r.json?.deduplicated).join("/")}`,
  );
  await page.ctx.close();
  await narrowPass(inv, [
    ["investor-discover", "/discover"],
    ["investor-profile", `/company/${state.companyId}`],
  ]);
}

// ==== 4 founder side ===================================================================
if (PHASES.has("4") && state.founderEmail && state.interestId) {
  const fdr = state.founderEmail;
  const inbox = await api(
    fdr,
    "GET",
    `/v1/network/companies/${state.companyId}/incoming-interest`,
  );
  receipt("founder-incoming-interest", inbox.json);
  const items = inbox.json?.items ?? inbox.json?.interests ?? [];
  const mine = items.find((i) => i.interestId === state.interestId);
  record(
    "4",
    "the founder's inbox holds the investor's interest",
    Boolean(mine),
    `${problemOf(inbox) || `${items.length} item(s)`}; investor ${mine?.investorName ?? "none"} response ${mine?.response ?? "-"}`,
  );
  const page = await signedInPage(fdr);
  await visit(page, "/company/interest", 10000);
  await page.shot("founder-interest");
  const text = await mainText(page);
  const firmStem = String(state.firm ?? FIRM).split(" (")[0];
  record(
    "4",
    "the founder sees the interest, with the firm's name",
    text.includes(firmStem),
    clip(text, 260),
  );
  // Never shown to the founder: the investor's question to Q, their Save,
  // their mandate's cheque figures, a fit score or the compare list.
  const leaked = [
    ["the investor's Q question", /which source says so/i],
    ["the investor's Save", /\bsaved (this|your) company\b/i],
    ["the investor's cheque figures", /1,?000,?000|250,?000/],
    ["a fit score", /\bfit score\b|\d{1,3}% (fit|match)/i],
    [
      "the investor's other company",
      new RegExp(
        String(state.otherCompanyName ?? "^$").replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ),
      ),
    ],
  ]
    .filter(
      ([, re]) =>
        state.otherCompanyName !== undefined || !String(re).includes("^$"),
    )
    .filter(
      ([, re]) => re.test(text) || re.test(JSON.stringify(inbox.json ?? {})),
    );
  record(
    "4",
    "the founder is not shown investor-private context",
    leaked.length === 0,
    leaked.map(([what]) => what).join(", ") ||
      "none of: Q question, Save, cheque figures, fit score, compare list",
  );
  const relation = await api(
    fdr,
    "GET",
    `/v1/network/investors/${state.investorOrganisationId}/relationship`,
  );
  receipt("founder-relationship-view", relation.json);
  record(
    "4",
    "where the company stands with the investor (founder's view)",
    null,
    problemOf(relation) || clip(JSON.stringify(relation.json), 300),
  );
  // The approval step: the founder accepts in the UI.
  const accept = page.getByRole("button", { name: /^accept$/i }).first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
    await page.waitForTimeout(1500);
    const confirm = page
      .getByRole("dialog")
      .getByRole("button", { name: /accept|connect/i });
    if (
      await confirm
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await confirm.first().click();
    }
    await page.waitForTimeout(8000);
  }
  await page.shot("founder-accepted");
  const after = await api(
    fdr,
    "GET",
    `/v1/network/companies/${state.companyId}/incoming-interest`,
  );
  const now = (after.json?.items ?? []).find(
    (i) => i.interestId === state.interestId,
  );
  const accepted = now?.response === "ACCEPTED";
  record(
    "4",
    "the founder accepts the interest (approval step)",
    accepted,
    `response ${now?.response ?? "none"}; connection ${clip(JSON.stringify(now?.connection ?? null), 160)}; page ${clip(await mainText(page), 160)}`,
  );
  await page.ctx.close();
  await narrowPass(fdr, [["founder-interest", "/company/interest"]]);
}

// ==== 5 canonical rows (read only) =====================================================
if (PHASES.has("5") && state.companyId) {
  try {
    const companyId = uuid(state.companyId);
    const company = hostedRead(
      `select id, canonical_name, organisation_id, company_status, marketplace_visibility, marketplace_readiness_state, current_stage_code, headquarters_country, version, demonstration_data from core.companies where id = '${companyId}'`,
    );
    receipt("db-company", company);
    record(
      "5",
      "one core.companies row",
      company.length === 1,
      clip(JSON.stringify(company[0]), 300),
    );
    if (state.investorOrganisationId) {
      const investorId = uuid(state.investorOrganisationId);
      const rels = hostedRead(
        `select id, current_state, last_event_sequence, projected_sequence, first_discovered_at, created_at from network.relationships where company_id = '${companyId}' and investor_organisation_id = '${investorId}'`,
      );
      receipt("db-relationships", rels);
      record(
        "5",
        "ONE network.relationships row for the pair",
        rels.length === 1 &&
          (!state.relationshipId || rels[0].id === state.relationshipId),
        `${rels.length} row(s); ${clip(JSON.stringify(rels[0] ?? null), 260)}`,
      );
      if (rels.length === 1) {
        const relId = uuid(rels[0].id);
        const events = hostedRead(
          `select sequence, event_type, actor_type, visibility_scope, occurred_at from network.relationship_events where relationship_id = '${relId}' order by sequence`,
        );
        receipt("db-relationship-events", events);
        const seqs = events.map((e) => Number(e.sequence));
        const ordered = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
        const types = events.map((e) => e.event_type);
        const interestEvents = types.filter((t) =>
          /interest_expressed/i.test(t),
        );
        record(
          "5",
          "relationship_events in order, one interest event despite retries",
          ordered && interestEvents.length === 1,
          types.map((t, i) => `${seqs[i]}:${t}`).join(" → "),
        );
        record(
          "5",
          "projection caught up with the event log",
          Number(rels[0].projected_sequence) ===
            Number(rels[0].last_event_sequence),
          `state ${rels[0].current_state}; projected ${rels[0].projected_sequence} / last ${rels[0].last_event_sequence}`,
        );
        const interests = hostedRead(
          `select id, status, created_at from network.interests where relationship_id = '${relId}'`,
        );
        receipt("db-interests", interests);
        record(
          "5",
          "one network.interests row for the relationship",
          interests.length === 1,
          `${interests.length} row(s)`,
        );
      }
    }
  } catch (error) {
    record("5", "canonical rows readable", false, clip(error.message, 300));
  }
}

await browser.close();
receipt("state-final", state);
const tally = results.reduce(
  (acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
  {},
);
console.log(`done in ${since()}: ${JSON.stringify(tally)}; receipts in ${OUT}`);
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
