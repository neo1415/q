#!/usr/bin/env node
/* global console, fetch, process, setTimeout */
// P13: a SMALL number of LIVE Q runs on the real companies, to see whether
// Q finds them on the network and what its public-web research says. Each
// run spends the founder's model and research credits: the cases are capped
// and every run logs its model cost from ai_ops.model_usage.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/seed/real-companies/research-probe.mjs <case-index>...
//
// Signs in as a FICTIONAL investor via a one-time magic-link token (no email
// is sent); no key, token or password is printed or written.
import { randomUUID } from "node:crypto";

import { accessToken, QAPI, sql } from "../tavus20/lib.mjs";

const EMAIL = "investor.rift-valley-seed@fictional.capitalq.local";
export const CASES = [
  "Tell me about MoneyHash.",
  "What does the public web say about HoneyCoin's funding? Check the web.",
  "Look up Koolbox on the web: where are they based and what do they make?",
  "Is ekko, the London climate fintech, on Capital Q? What does the web say about their latest round?",
  "Search the web for recent news on F2, the private credit AI company.",
  "Find me Nigerian fintech companies at seed stage on Capital Q.",
];
const MAX_RUNS = 6;

const picks = process.argv.slice(2).map(Number);
if (
  picks.length === 0 ||
  picks.length > MAX_RUNS ||
  picks.some((i) => !(i in CASES))
) {
  console.error(`pick 1-${MAX_RUNS} case indexes from 0..${CASES.length - 1}`);
  process.exit(2);
}
const token = await accessToken(EMAIL);
async function api(method, path, body) {
  const r = await fetch(`${QAPI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const DONE = new Set([
  "COMPLETED",
  "AWAITING_INPUT",
  "AWAITING_APPROVAL",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
for (const i of picks) {
  const t0 = Date.now();
  const created = await api("POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text: CASES[i] },
    modality: "TEXT",
  });
  const runId = created.json?.runId;
  if (!runId) {
    console.log(`#${i} create HTTP ${created.status}`);
    continue;
  }
  let run = {};
  while (Date.now() - t0 < 120_000) {
    run = (await api("GET", `/v1/q/runs/${runId}`)).json ?? {};
    if (
      DONE.has(run.status) &&
      (run.messages ?? []).some((m) => m.role === "Q")
    )
      break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const answer =
    (run.messages ?? []).filter((m) => m.role === "Q").at(-1)?.text ?? "";
  const corr = String(run.correlationId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const usage = corr
    ? await sql(
        `select count(*)::int calls, coalesce(sum(cost_usd),0)::numeric(10,4) usd, string_agg(distinct task_class, ',') tasks from ai_ops.model_usage where correlation_id = '${corr}'`,
      )
    : [];
  const tools = JSON.stringify(
    run.toolCalls ?? run.stages ?? run.visibleStages ?? [],
  ).slice(0, 300);
  console.log(
    `#${i} "${CASES[i]}" -> ${run.status} in ${Date.now() - t0} ms; model ${JSON.stringify(usage[0] ?? {})}; tools ${tools}`,
  );
  console.log(`   Q: ${answer.replace(/\s+/g, " ").slice(0, 700)}`);
}
