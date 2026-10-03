#!/usr/bin/env node
/* global process, console, fetch, URL, setTimeout */
/**
 * Q parity eval (ADR 0040 §3). For every action declared in the app's
 * action registry, and every read_my kind, it sends the generated
 * phrasings as the fictional eval accounts and checks the right thing
 * happened:
 *   - CONSEQUENTIAL: a q.action.proposed of `app.<name>` in that run;
 *   - INSTANT:       a recommendation interaction of the right type, by
 *                    that person, for that company, after the run started;
 *   - READ:          Q's answer names the record.
 * It prints a pass/fail table.
 *
 * NOT in CI: every case costs model calls on the founder's credits. Run it
 * on demand or nightly, against a deploy that has the registry:
 *
 *   node scripts/evals/q-parity/run.mjs --dry-run       # cases and cost only
 *   Q_API=… SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *   SUPABASE_PROJECT=… EVAL_FOUNDER_EMAIL=… EVAL_INVESTOR_EMAIL=… \
 *   CQ_SEED_ACCOUNT_PASSWORD=… node scripts/evals/q-parity/run.mjs
 *
 * Fictional accounts only (@fictional.capitalq.local); e.g. founder.ajopot
 * and investor.savanna-seed. Not lagoon-angels (its errands are live) and
 * never the founder's own accounts. INSTANT cases run
 * in an order that undoes themselves (save then unsave, pass then unpass);
 * CONSEQUENTIAL cases are only prepared, never approved.
 */
import { randomUUID } from "node:crypto";

const { APP_ACTIONS, MODEL_CALLS_PER_CASE, parityCases, untitledPitchName } =
  await import(
    new URL("../../../packages/app-actions/dist/index.js", import.meta.url).href
  );

const DRY = process.argv.includes("--dry-run");
/** USD per model call, upper bound at today's routing (turn reader + answer, ~15k tokens in). */
const COST_PER_CALL_USD = Number(process.env.COST_PER_CALL_USD ?? "0.02");

const env = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (or run with --dry-run)`);
  }
  return value;
};

// Which account each area's actions run as.
const ACCOUNT_OF_AREA = {
  pitch: "FOUNDER",
  discovery: "INVESTOR",
  // Outcomes (pass, pause, meeting) are recorded by the investor.
  relationships: "INVESTOR",
};
// A family's phrasings can belong to different sides: diligence's first
// phrasing (and its misheard copy) is the founder sharing, the second the
// investor asking.
const ACCOUNT_OF_CASE = {
  "diligence.change#1": "FOUNDER",
  "diligence.change#misheard": "FOUNDER",
};
const ACCOUNT_OF_READ = {
  media: "FOUNDER",
  documents: "FOUNDER",
  rehearsals: "FOUNDER",
  feed: "INVESTOR",
  calls: "FOUNDER",
  uploads: "FOUNDER",
};

const sql = async (query) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${env("SUPABASE_PROJECT")}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
};
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const userOf = async (email) =>
  (
    await sql(
      `select p.id from identity.user_profiles p join auth.users u on u.id = p.auth_user_id where u.email = ${quote(email)}`,
    )
  )[0]?.id ?? null;

/** Real record names on the eval accounts, read the way the pages read them. */
async function namesFor(founderUser, investorUser) {
  const pitchRow = (
    await sql(
      `select m.title, c.canonical_name as company from media.media_assets m
         join core.companies c on c.id = m.owner_id
         join identity.organisation_memberships om on om.organisation_id = c.organisation_id
        where om.user_id = ${quote(founderUser)} and m.purpose = 'FOUNDER_PITCH'
          and m.deleted_at is null and m.superseded_at is null
        order by m.created_at desc limit 1`,
    )
  )[0];
  // An untitled pitch by the read registry's own name for it.
  const pitch =
    pitchRow === undefined
      ? undefined
      : (pitchRow.title ?? untitledPitchName(pitchRow.company));
  // A connected relationship of the investor's, never Lagoon Angels (its
  // errands are live): the counterpart company's name.
  const relationship = (
    await sql(
      `select c.canonical_name as name from network.relationships r
         join core.investor_organisations io on io.id = r.investor_organisation_id
         join identity.organisation_memberships om on om.organisation_id = io.organisation_id
         join core.companies c on c.id = r.company_id
        where om.user_id = ${quote(investorUser)} and r.current_state = 'CONNECTED'
          and io.display_name not ilike '%lagoon%'
        order by r.created_at limit 1`,
    )
  )[0]?.name;
  const company = (
    await sql(
      `select c.canonical_name as name from recommendation.slate_items i
         join recommendation.slates s on s.id = i.slate_id and s.status = 'CURRENT'
         join core.investor_organisations io on io.id = s.investor_organisation_id
         join identity.organisation_memberships om on om.organisation_id = io.organisation_id
         join core.companies c on c.id = i.company_id
        where om.user_id = ${quote(investorUser)}
        order by i.rank limit 1`,
    )
  )[0]?.name;
  // The founder's side of a connection, for founder-account actions on a
  // relationship (sharing their raise): the investor's name, never Lagoon.
  const founderRelationship = (
    await sql(
      `select io.display_name as name from network.relationships r
         join core.investor_organisations io on io.id = r.investor_organisation_id
         join core.companies c on c.id = r.company_id
         join identity.organisation_memberships om on om.organisation_id = c.organisation_id
        where om.user_id = ${quote(founderUser)} and r.current_state = 'CONNECTED'
          and io.display_name not ilike '%lagoon%'
        order by r.created_at limit 1`,
    )
  )[0]?.name?.replace(/\s*\(fictional\)$/i, "");
  // Their company's uploaded pitch deck (set_deck_audience names it).
  const deck = (
    await sql(
      `select d.title from evidence.documents d
         join core.companies c on c.id = d.company_id
         join identity.organisation_memberships om on om.organisation_id = c.organisation_id
        where om.user_id = ${quote(founderUser)} and d.document_type = 'PITCH_DECK'
        order by d.created_at desc limit 1`,
    )
  )[0]?.title;
  return {
    founderRelationship,
    names: {
      ...(pitch === undefined ? {} : { MEDIA: pitch }),
      ...(deck === undefined ? {} : { UPLOAD: deck }),
      ...(company === undefined ? {} : { COMPANY: company }),
      ...(relationship === undefined ? {} : { RELATIONSHIP: relationship }),
    },
    reads: {
      ...(pitch === undefined ? {} : { media: pitch }),
      ...(deck === undefined ? {} : { uploads: deck }),
      ...(company === undefined ? {} : { feed: company }),
    },
  };
}

async function signIn(email) {
  const r = await fetch(
    `${env("SUPABASE_URL")}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: env("SUPABASE_ANON_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: env("CQ_SEED_ACCOUNT_PASSWORD"),
      }),
    },
  );
  const body = await r.json();
  if (typeof body.access_token !== "string")
    throw new Error(`sign-in failed for ${email}`);
  return body.access_token;
}

async function ask(token, text, conversationId) {
  const r = await fetch(`${env("Q_API")}/v1/q/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      capability: "ANSWER",
      message: { text },
      modality: "TEXT",
      ...(conversationId === undefined ? {} : { conversationId }),
    }),
  });
  const body = await r.json().catch(() => ({}));
  return body.runId ?? body.id ?? null;
}

async function settled(runId) {
  for (let i = 0; i < 45; i++) {
    const row = (
      await sql(`select status from q_runtime.runs where id = ${quote(runId)}`)
    )[0];
    // AWAITING_APPROVAL is where a CONSEQUENTIAL case ends: prepared,
    // never approved by the eval.
    if (
      row !== undefined &&
      /COMPLETED|FAILED|CANCELLED|AWAITING_APPROVAL/.test(row.status)
    )
      return row.status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return "TIMEOUT";
}

const DECISION_STATE = {
  "discovery.company.save": { field: "saved", value: true },
  "discovery.company.unsave": { field: "saved", value: false },
  "discovery.company.pass": { field: "passed", value: true },
  "discovery.company.unpass": { field: "passed", value: false },
};

async function check(testCase, runId, userId, company) {
  const expect = testCase.expect;
  if (expect.kind === "READ") {
    const said = (
      await sql(
        `select payload::text as p from q_runtime.run_events where run_id = ${quote(runId)} and event_type = 'q.message.completed'`,
      )
    )
      .map((row) => row.p)
      .join(" ");
    return said.toLowerCase().includes(expect.mentions.toLowerCase());
  }
  const action = APP_ACTIONS.find(
    (candidate) => candidate.name === expect.action,
  );
  if (action?.classification === "CONSEQUENTIAL") {
    const proposed = await sql(
      `select payload::text as p from q_runtime.run_events where run_id = ${quote(runId)} and event_type = 'q.action.proposed'`,
    );
    // A family (one tool, no route of its own) proposes as one of its
    // members: relationship.outcome.change as relationship.outcome.pass, …
    const family =
      action.http === undefined
        ? `app.${expect.action.split(".").slice(0, -1).join(".")}.`
        : null;
    if (
      proposed.some(
        (row) =>
          row.p.includes(`app.${expect.action}`) ||
          (family !== null && row.p.includes(family)),
      )
    ) {
      return true;
    }
    const said = (
      await sql(
        `select payload::text as p from q_runtime.run_events where run_id = ${quote(runId)} and event_type = 'q.message.completed'`,
      )
    )
      .map((row) => row.p)
      .join(" ");
    // The same request already waiting on a card (HARDEN harden-18): "That's
    // ready: … It's waiting for your yes" prepares nothing new, rightly.
    if (/that.s ready:[^]*waiting for your yes/i.test(said)) return true;
    // A refusal that is right for this eval account's state (e.g. no Q
    // Card yet), declared with the action's own eval phrasings.
    if (expect.orSays === undefined) return false;
    return new RegExp(expect.orSays, "i").test(said);
  }
  // The state the person asked for, by the end of the run. "Already
  // saved" is the right answer to "save it" when it was: what matters is
  // that it is so, through the interaction service's own projection.
  const want = DECISION_STATE[expect.action];
  const state = (
    await sql(
      `select st.saved, st.passed from recommendation.interaction_state st
         join core.investor_organisations io on io.id = st.investor_organisation_id
         join identity.organisation_memberships om on om.organisation_id = io.organisation_id
         join core.companies c on c.id = st.company_id
        where om.user_id = ${quote(userId)} and c.canonical_name = ${quote(company)}`,
    )
  )[0];
  return (
    want !== undefined &&
    state !== undefined &&
    state[want.field] === want.value
  );
}

const placeholder = { MEDIA: "Nixo pitch", COMPANY: "Kazikit" };
let founderUser = null;
let investorUser = null;
let names = { names: placeholder, reads: { media: placeholder.MEDIA } };
if (!DRY) {
  founderUser = await userOf(env("EVAL_FOUNDER_EMAIL"));
  investorUser = await userOf(env("EVAL_INVESTOR_EMAIL"));
  names = await namesFor(founderUser, investorUser);
}
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
// Each decision case must change the state it checks: per phrasing,
// save, unsave, pass, unpass, so a Q that did nothing cannot pass by
// inheriting the previous case's state.
const VARIANT_ORDER = ["PHRASING_1", "PHRASING_2", "MISHEARD"];
const cases = parityCases(APP_ACTIONS, names.names, names.reads)
  .filter(
    (testCase) => only === undefined || new RegExp(only).test(testCase.id),
  )
  .map((testCase, index) => ({ testCase, index }))
  .sort((a, b) => {
    const decision = (c) =>
      c.expect.kind === "ACTION" && c.expect.action.startsWith("discovery.");
    if (!decision(a.testCase) || !decision(b.testCase))
      return a.index - b.index;
    return (
      VARIANT_ORDER.indexOf(a.testCase.variant) -
        VARIANT_ORDER.indexOf(b.testCase.variant) || a.index - b.index
    );
  })
  .map(({ testCase }) => testCase);
const founderCases =
  names.founderRelationship === undefined
    ? []
    : parityCases(
        APP_ACTIONS,
        { ...names.names, RELATIONSHIP: names.founderRelationship },
        names.reads,
      );
const calls = cases.length * MODEL_CALLS_PER_CASE;
console.log(
  `${String(cases.length)} cases, ~${String(calls)} model calls, est. ≤ $${(calls * COST_PER_CALL_USD).toFixed(2)} per run`,
);
if (DRY) {
  for (const testCase of cases)
    console.log(`  ${testCase.id.padEnd(36)} ${testCase.say}`);
  process.exit(0);
}

const tokens = {
  FOUNDER: await signIn(env("EVAL_FOUNDER_EMAIL")),
  INVESTOR: await signIn(env("EVAL_INVESTOR_EMAIL")),
};
// Whose record an action changes decides the account: a founder's
// company, an investor's organisation; otherwise the area's account.
function accountOf(action) {
  const scopes = action?.tool?.scopes ?? [];
  if (scopes.includes("COMPANY_PROFILE")) return "FOUNDER";
  if (scopes.some((scope) => scope.startsWith("INVESTOR_"))) return "INVESTOR";
  return ACCOUNT_OF_AREA[action?.area] ?? "FOUNDER";
}
const rows = [];
const conversationOf = new Map();
for (const testCase of cases) {
  const account =
    ACCOUNT_OF_CASE[testCase.id] ??
    (testCase.expect.kind === "READ"
      ? ACCOUNT_OF_READ[testCase.expect.read]
      : accountOf(APP_ACTIONS.find((a) => a.name === testCase.expect.action)));
  const userId = account === "FOUNDER" ? founderUser : investorUser;
  // A relationship named from the founder's side when a founder acts.
  const asked =
    account === "FOUNDER" && names.founderRelationship !== undefined
      ? (founderCases.find((c) => c.id === testCase.id) ?? testCase)
      : testCase;
  const t0 = Date.now();
  // One conversation per action (lead 2026-10-03): its phrasings follow
  // one another, so a restated request meeting a pending card is covered.
  const action =
    testCase.expect.kind === "READ" ? null : testCase.expect.action;
  const runId = await ask(
    tokens[account],
    asked.say,
    action === null ? undefined : conversationOf.get(`${account}:${action}`),
  );
  if (
    runId !== null &&
    action !== null &&
    !conversationOf.has(`${account}:${action}`)
  ) {
    const row = (
      await sql(
        `select conversation_id from q_runtime.runs where id = ${quote(runId)}`,
      )
    )[0];
    if (row?.conversation_id)
      conversationOf.set(`${account}:${action}`, row.conversation_id);
  }
  const status = runId === null ? "NOT_STARTED" : await settled(runId);
  const ok =
    runId !== null &&
    (status === "COMPLETED" || status === "AWAITING_APPROVAL") &&
    (await check(testCase, runId, userId, names.names.COMPANY));
  rows.push({
    id: testCase.id,
    variant: testCase.variant,
    ok,
    status,
    ms: Date.now() - t0,
  });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${testCase.id}  (${status}, ${String(Date.now() - t0)} ms)`,
  );
}
const passed = rows.filter((row) => row.ok).length;
console.log(`\n| case | variant | result | run | ms |\n|---|---|---|---|---|`);
for (const row of rows) {
  console.log(
    `| ${row.id} | ${row.variant} | ${row.ok ? "pass" : "FAIL"} | ${row.status} | ${String(row.ms)} |`,
  );
}
console.log(`\n${String(passed)}/${String(rows.length)} passed`);
process.exit(passed === rows.length ? 0 : 1);
