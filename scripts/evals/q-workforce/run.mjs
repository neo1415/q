#!/usr/bin/env node
/**
 * Workforce intelligence eval, LIVE (wf 2026-10-16): the real JOB_PLAN v5
 * planner, through the deployed q-api and its Model Gateway, graded on plan
 * quality by the same deterministic grader the scripted scenarios use
 * (packages/q-evals/src/workforce). Probabilistic: it reports scores and
 * checks; it is never a CI gate.
 *
 * Each case asks Q for a job as a fictional eval account, the way a person
 * would type it, then reads back the q.workforce.job.start card the turn
 * proposed (its exact payload: outcome, prerequisites, steps with why and
 * evidence, fallbacks, next actions) and grades it. Nothing is approved
 * unless --approve is given; then the job runs and its plan progress is
 * read from the Work page API.
 *
 * NOT in CI: each case costs about four gateway calls (turn reader, router,
 * answer, planner) on the founder's credits. The model calls the run made
 * are read back from ai_ops.model_usage and reported with their cost.
 *
 *   node scripts/evals/q-workforce/run.mjs --dry-run
 *   Q_API=… SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *   SUPABASE_PROJECT=… CQ_SEED_ACCOUNT_PASSWORD=… \
 *   node scripts/evals/q-workforce/run.mjs --only=<regex> [--approve]
 *
 * Fictional accounts only (@fictional.capitalq.local).
 */
import { randomUUID } from "node:crypto";

const {
  WORKFORCE_SCENARIOS,
  gradeWorkforce,
  planFromPayload,
} = await import("../../../packages/q-evals/dist/index.js");

const DRY = process.argv.includes("--dry-run");
const APPROVE = process.argv.includes("--approve");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const CALLS_PER_CASE = 4;
const MAX_CALLS = Number(process.env.MAX_CALLS ?? "10");

const cases = WORKFORCE_SCENARIOS.filter(
  (scenario) => only === undefined || new RegExp(only, "u").test(scenario.id),
);
if (cases.length * CALLS_PER_CASE > MAX_CALLS) {
  console.error(
    `${String(cases.length)} cases is about ${String(cases.length * CALLS_PER_CASE)} calls, over MAX_CALLS ${String(MAX_CALLS)}; narrow with --only.`,
  );
  process.exit(2);
}
if (DRY) {
  for (const scenario of cases) {
    console.log(`${scenario.id} as ${scenario.account}: ${scenario.goal}`);
  }
  console.log(`about ${String(cases.length * CALLS_PER_CASE)} gateway calls`);
  process.exit(0);
}

const env = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
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

async function signIn(email) {
  const started = Date.now();
  const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env("SUPABASE_ANON_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ email, password: env("CQ_SEED_ACCOUNT_PASSWORD") }),
  });
  const body = await r.json();
  if (Date.now() - started > 5_000) throw new Error("sign-in took over 5 s: stopping");
  if (typeof body.access_token !== "string") throw new Error(`sign-in failed for ${email}`);
  return body.access_token;
}

async function qApi(token, method, path, body) {
  const r = await fetch(`${env("Q_API")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status >= 500) throw new Error(`q-api ${String(r.status)} on ${path}: back off`);
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function settled(runId) {
  for (let i = 0; i < 45; i++) {
    const row = (await sql(`select status from q_runtime.runs where id = ${quote(runId)}`))[0];
    if (row !== undefined && /COMPLETED|FAILED|CANCELLED|AWAITING_APPROVAL/u.test(row.status))
      return row.status;
    await sleep(2_000);
  }
  return "TIMEOUT";
}

async function jobCardOf(runId) {
  const row = (
    await sql(
      `select a.id, a.proposed_payload::text as payload, ap.id as approval_id
         from q_runtime.actions a
         left join q_runtime.approvals ap on ap.action_id = a.id
        where a.run_id = ${quote(runId)} and a.action_type = 'q.workforce.job.start'
        order by a.created_at desc limit 1`,
    )
  )[0];
  if (row === undefined) return null;
  try {
    return { ...row, payload: JSON.parse(row.payload) };
  } catch {
    return null;
  }
}

async function usageSince(userId, since) {
  return sql(
    `select task_class, model_id, cost_usd::text as usd, success
       from ai_ops.model_usage
      where user_id = ${quote(userId)} and created_at >= ${quote(since)}
      order by created_at`,
  );
}

let calls = 0;
let usd = 0;
const results = [];
for (const scenario of cases) {
  const since = new Date().toISOString();
  const token = await signIn(scenario.account);
  const userId = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
  const profile = (
    await sql(`select id from identity.user_profiles where auth_user_id = ${quote(userId)} limit 1`)
  )[0]?.id;
  await sleep(2_000);
  const asked = await qApi(token, "POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text: scenario.goal },
    modality: "TEXT",
  });
  const runId = asked.body?.runId ?? asked.body?.id ?? null;
  if (runId === null) {
    results.push({ id: scenario.id, error: `no run (${String(asked.status)})` });
    continue;
  }
  const status = await settled(runId);
  const card = await jobCardOf(runId);
  const grade = card === null ? null : gradeWorkforce(scenario, planFromPayload(card.payload));
  let progress = null;
  if (APPROVE && card?.approval_id) {
    await sleep(2_000);
    await qApi(token, "POST", `/v1/q/approvals/${card.approval_id}/approve`, {});
    for (let i = 0; i < 40 && progress?.done !== progress?.total; i++) {
      await sleep(6_000);
      const jobs = await qApi(token, "GET", "/v1/q/workforce/jobs?limit=5");
      const job = jobs.body?.items?.find((one) => one.trace?.runId === runId) ?? jobs.body?.items?.[0];
      if (job === undefined) continue;
      const detail = await qApi(token, "GET", `/v1/q/workforce/jobs/${job.id}`);
      progress = detail.body?.plan ?? null;
      if (detail.body?.job?.status !== "RUNNING" && progress !== null) break;
    }
  }
  await sleep(3_000);
  const used = await usageSince(profile ?? userId, since);
  calls += used.length;
  usd += used.reduce((sum, row) => sum + Number(row.usd ?? 0), 0);
  results.push({
    id: scenario.id,
    runStatus: status,
    card: card !== null,
    score: grade?.score ?? null,
    failed: grade?.checks.filter((check) => !check.ok).map((check) => `${check.name}${check.detail === undefined ? "" : ` (${check.detail})`}`) ?? [],
    outcome: card?.payload.reasoning?.outcome ?? null,
    steps: card?.payload.steps.map((step) => `${step.key}:${step.role}${step.fallbackFor ? ` (fallback for ${step.fallbackFor})` : ""} <- [${step.dependsOn.join(",")}] ${step.why ?? ""}`) ?? [],
    missing: card?.payload.reasoning?.prerequisites.filter((one) => one.status !== "MET").map((one) => `${one.status}: ${one.what}`) ?? [],
    next: card?.payload.reasoning?.nextActions.map((one) => `${one.action}${one.needsApproval ? " [approval]" : ""}`) ?? [],
    progress,
    modelCalls: used.map((row) => `${row.task_class}/${row.model_id} $${row.usd ?? "?"}${row.success ? "" : " failed"}`),
  });
  if (calls >= MAX_CALLS) break;
}
console.log(JSON.stringify({ results, calls, usd: Number(usd.toFixed(4)) }, null, 2));
