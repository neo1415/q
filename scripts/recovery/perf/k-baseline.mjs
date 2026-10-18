#!/usr/bin/env node
/**
 * Recovery K, Part 10: the instant-answer baseline, per journey, p50/p95.
 *
 *   SUPABASE_ACCESS_TOKEN=… node scripts/recovery/perf/k-baseline.mjs [--days 4] [--source hosted|local] [--out file.md]
 *
 * Reads METADATA ONLY: timestamps, counts, coded states, run capability and
 * terminal events. No message text, no names, no identifiers leave the database: the
 * query returns one row of numbers and labels per run, and only percentiles
 * are written. hosted = read-only Management API query (the same path as
 * scripts/handoff/live/hosted-read.mjs); local = the local Supabase via psql.
 *
 * Per run (q_runtime.runs in the window):
 *   speech end → run accepted  runs.created_at − the latest USER voice_line_turn
 *                              in the same conversation within 15 s before
 *                              (voice runs only; the turn row is written when
 *                              the speech was heard, so this is "heard → accepted")
 *   context assembly          first stage PREPARING_ANALYSIS − runs.started_at
 *                              (turn reading, Context Firewall, reads; null
 *                              when the run never reached that stage)
 *   model calls per turn      ai_ops.model_usage rows for the run (all attempts)
 *   time to first card        first Q message carrying ANSWER_CARDS − created_at
 *   time to terminal answer   q.run.completed / q.run.failed − created_at
 *   DB query count            not stored in the database; see the log section
 * Journeys: modality (voice/text) × how it was answered (model / code, by
 * model-call count) × capability. n < 5 prints "insufficient". Nearest-rank
 * percentiles; nothing is estimated.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const DAYS = Number(flag("days", "4"));
const SOURCE = flag("source", "hosted");
const OUT = flag("out", null);
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 30)
  throw new Error("--days 1..30");

const SQL = `
with r as (
  select id, conversation_id, capability, status, created_at, started_at
  from q_runtime.runs
  where created_at > now() - interval '${String(DAYS)} days'
),
ev as (
  select run_id,
    min(occurred_at) filter (where event_type = 'q.stage.changed' and visible_stage = 'PREPARING_ANALYSIS') as prep,
    min(occurred_at) filter (where event_type in ('q.run.completed', 'q.run.failed')) as term
  from q_runtime.run_events where run_id in (select id from r) group by run_id
),
msg as (
  select run_id,
    min(created_at) filter (where role = 'Q' and result_blocks::text like '%"ANSWER_CARDS"%') as first_card
  from q_runtime.conversation_messages where run_id in (select id from r) group by run_id
),
mu as (
  select q_run_id as run_id, count(*) as calls
  from ai_ops.model_usage where q_run_id in (select id from r) group by 1
),
vt as (
  select r.id as run_id, max(v.created_at) as heard
  from r join q_runtime.voice_line_turns v
    on v.conversation_id = r.conversation_id and v.role = 'USER'
   and v.created_at between r.created_at - interval '15 seconds' and r.created_at + interval '2 seconds'
  group by r.id
)
select
  case when vt.heard is null then 'text' else 'voice' end as modality,
  case when coalesce(mu.calls, 0) = 0 then 'code' else 'model' end as answered_by,
  r.capability, r.status,
  round(extract(epoch from (r.created_at - vt.heard)) * 1000) as heard_to_accepted_ms,
  round(extract(epoch from (ev.prep - r.started_at)) * 1000) as context_ms,
  coalesce(mu.calls, 0) as model_calls,
  round(extract(epoch from (msg.first_card - r.created_at)) * 1000) as first_card_ms,
  round(extract(epoch from (ev.term - r.created_at)) * 1000) as terminal_ms
from r left join ev on ev.run_id = r.id left join msg on msg.run_id = r.id
       left join mu on mu.run_id = r.id left join vt on vt.run_id = r.id`;

async function rows() {
  if (SOURCE === "local") {
    const csv = execFileSync(
      "docker",
      [
        "exec",
        "supabase_db_capital-q",
        "psql",
        "-U",
        "postgres",
        "-tA",
        "-F",
        "\t",
        "-c",
        SQL,
      ],
      { encoding: "utf8" },
    );
    const cols = [
      "modality",
      "answered_by",
      "capability",
      "status",
      "heard_to_accepted_ms",
      "context_ms",
      "model_calls",
      "first_card_ms",
      "terminal_ms",
    ];
    return csv
      .split("\n")
      .filter(Boolean)
      .map((line) =>
        Object.fromEntries(
          line.split("\t").map((v, i) => [cols[i], v === "" ? null : v]),
        ),
      );
  }
  const ref = process.env.CQ_HOSTED_PROJECT_REF ?? "vcohxiqsmnkzxnvawgri";
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: SQL, read_only: true }),
    },
  );
  if (!response.ok)
    throw new Error(`hosted read refused: ${String(response.status)}`);
  return response.json();
}

const pct = (sorted, p) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
function stat(values) {
  const v = values
    .filter((x) => x !== null && x !== undefined && x !== "")
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (v.length < 5) return `insufficient (n=${String(v.length)})`;
  return `${String(pct(v, 0.5))} / ${String(pct(v, 0.95))} (n=${String(v.length)})`;
}

const data = await rows();
const journeys = new Map();
for (const row of data) {
  const key = `${row.modality} · ${row.answered_by} · ${row.capability}`;
  if (!journeys.has(key)) journeys.set(key, []);
  journeys.get(key).push(row);
}
const metric = (list, name) => stat(list.map((row) => row[name]));
const lines = [
  `# K baseline: instant answers (Part 10)`,
  ``,
  `Source: ${SOURCE === "hosted" ? "hosted production database, read-only aggregates" : "local stack"}. Window: last ${String(DAYS)} days to ${new Date().toISOString()}. Runs: ${String(data.length)}. Generated by \`scripts/recovery/perf/k-baseline.mjs --source ${SOURCE} --days ${String(DAYS)}\`.`,
  ``,
  `Cells are p50 / p95 in ms (nearest rank) with n. Model calls are a count per run. "insufficient" means fewer than 5 samples; nothing is estimated.`,
  ``,
  `| journey (modality · answered by · capability) | runs | speech heard → run accepted | context assembly | model calls / turn | time to first card | time to terminal answer |`,
  `|---|---|---|---|---|---|---|`,
  ...[...journeys.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
      ([key, list]) =>
        `| ${key} | ${String(list.length)} | ${metric(list, "heard_to_accepted_ms")} | ${metric(list, "context_ms")} | ${metric(list, "model_calls")} | ${metric(list, "first_card_ms")} | ${metric(list, "terminal_ms")} |`,
    ),
  `| **all** | ${String(data.length)} | ${metric(data, "heard_to_accepted_ms")} | ${metric(data, "context_ms")} | ${metric(data, "model_calls")} | ${metric(data, "first_card_ms")} | ${metric(data, "terminal_ms")} |`,
  ``,
  `Statuses in the window: ${[...data.reduce((m, r) => m.set(r.status, (m.get(r.status) ?? 0) + 1), new Map())].map(([s, n]) => `${String(s)} ${String(n)}`).join(", ")}.`,
];
const text = `${lines.join("\n")}\n`;
if (OUT === null) console.log(text);
else {
  writeFileSync(OUT, text);
  execFileSync("pnpm", ["exec", "prettier", "--write", OUT], {
    stdio: "ignore",
  });
  console.log(`wrote ${OUT}`);
}
