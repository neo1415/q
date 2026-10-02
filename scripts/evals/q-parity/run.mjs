#!/usr/bin/env node
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

const { APP_ACTIONS, MODEL_CALLS_PER_CASE, parityCases } = await import(
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
const ACCOUNT_OF_AREA = { pitch: "FOUNDER", discovery: "INVESTOR" };
const ACCOUNT_OF_READ = {
  media: "FOUNDER",
  documents: "FOUNDER",
  rehearsals: "FOUNDER",
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
  const pitch = (
    await sql(
      `select coalesce(m.title, 'Pitch') as title from media.media_assets m
         join core.companies c on c.id = m.owner_id
         join identity.organisation_memberships om on om.organisation_id = c.organisation_id
        where om.user_id = ${quote(founderUser)} and m.purpose = 'FOUNDER_PITCH'
          and m.deleted_at is null and m.superseded_at is null
        order by m.created_at desc limit 1`,
    )
  )[0]?.title;
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
  return {
    names: {
      ...(pitch === undefined ? {} : { MEDIA: pitch }),
      ...(company === undefined ? {} : { COMPANY: company }),
    },
    reads: pitch === undefined ? {} : { media: pitch },
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

async function ask(token, text) {
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
    if (row !== undefined && /COMPLETED|FAILED|CANCELLED/.test(row.status))
      return row.status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return "TIMEOUT";
}

const DECISION_TYPE = {
  "discovery.company.save": "SAVE",
  "discovery.company.unsave": "UNSAVE",
  "discovery.company.pass": "PASS",
  "discovery.company.unpass": "UNPASS",
};

async function check(testCase, runId, userId, startedAt) {
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
    return proposed.some((row) => row.p.includes(`app.${expect.action}`));
  }
  const recorded = await sql(
    `select 1 from recommendation.interaction_events
      where actor_user_id = ${quote(userId)} and surface = 'Q_CONVERSATION'
        and interaction_type = ${quote(DECISION_TYPE[expect.action] ?? "")}
        and recorded_at >= ${quote(startedAt)} limit 1`,
  );
  return recorded.length > 0;
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
const cases = parityCases(APP_ACTIONS, names.names, names.reads);
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
const rows = [];
for (const testCase of cases) {
  const account =
    testCase.expect.kind === "READ"
      ? ACCOUNT_OF_READ[testCase.expect.read]
      : (ACCOUNT_OF_AREA[
          APP_ACTIONS.find((a) => a.name === testCase.expect.action)?.area
        ] ?? "INVESTOR");
  const userId = account === "FOUNDER" ? founderUser : investorUser;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const runId = await ask(tokens[account], testCase.say);
  const status = runId === null ? "NOT_STARTED" : await settled(runId);
  const ok =
    runId !== null &&
    status === "COMPLETED" &&
    (await check(testCase, runId, userId, startedAt));
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
