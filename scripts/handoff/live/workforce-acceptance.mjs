// Live acceptance of Q's workforce on FICTIONAL accounts only:
//   ask Q (one plain-language goal) -> Q plans a team job and shows ONE plan
//   card -> (with --approve) approve exactly that card -> the job runs ->
//   report every step, its agent, status and outputs (memo versions, the
//   critique, the diligence approval card).
// Never approves anything but the plan card its own run produced; the
// diligence card it files stays pending for the person.
//   CQ_PUBLIC_JSON=<file> CQ_SEED_ACCOUNT_PASSWORD=... NODE_USE_ENV_PROXY=1 \
//   node scripts/handoff/live/workforce-acceptance.mjs [--approve]
import { randomUUID } from "node:crypto";

import { Q_API, signIn } from "./fictional-session.mjs";

const APPROVE = process.argv.includes("--approve");
const GOAL =
  process.env.CQ_WORKFORCE_GOAL ??
  "Research Ledgerfold and how it fits Savanna Seed Partners, assess the opportunity, identify the important risks and missing information, prepare an investment memo, get a second specialist to critique it, revise the memo, and prepare appropriate founder diligence questions. Show me the results and anything requiring my approval.";

const session = await signIn(
  "investor.savanna-seed@fictional.capitalq.local",
  Q_API,
);
async function api(method, path, body) {
  const response = await fetch(`${Q_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Problem details are JSON; anything else is reported as text.
  }
  return { status: response.status, json, text: text.slice(0, 300) };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(6)} ms`;
// Timings the lead asked for (2026-10-12): first Q text, plan prepared,
// each agent's duration from its own startedAt/endedAt, and the whole job.
const timings = {};

const created = await api("POST", "/v1/q/runs", {
  capability: "ANSWER",
  message: { text: GOAL },
  modality: "TEXT",
});
const runId = created.json?.runId;
if (!runId)
  throw new Error(`run not created: HTTP ${created.status} ${created.text}`);
console.log(at(), "run", runId);
let run;
for (let i = 0; i < 480; i += 1) {
  run = (await api("GET", `/v1/q/runs/${runId}`)).json;
  const said = (run?.messages ?? []).some(
    (m) => m.role === "Q" && (m.text ?? "").length > 0,
  );
  if (said && timings.firstQTextMs === undefined)
    timings.firstQTextMs = Date.now() - t0;
  if (
    [
      "COMPLETED",
      "AWAITING_APPROVAL",
      "AWAITING_INPUT",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ].includes(run?.status)
  )
    break;
  await wait(250);
}
timings.runSettledMs = Date.now() - t0;
const reply =
  (run?.messages ?? []).filter((m) => m.role === "Q").at(-1)?.text ?? "";
console.log(at(), "run status", run?.status, "| Q said:", reply.slice(0, 600));
const approvals = (await api("GET", "/v1/q/approvals")).json;
const list = approvals?.items ?? approvals?.approvals ?? approvals ?? [];
const mine = (Array.isArray(list) ? list : []).filter((a) => a.runId === runId);
console.log(
  at(),
  "approval cards from this run:",
  mine.map((a) => `${a.action?.actionType}:${a.status}`).join(", ") || "none",
);
const plan = mine.find((a) => a.action?.actionType === "q.workforce.job.start");
if (plan === undefined) {
  console.log("FAIL no workforce plan card was prepared", timings);
  process.exit(1);
}
timings.planCardMs = Date.now() - t0;
console.log(
  at(),
  "plan preview:",
  (plan.action?.preview ?? plan.action?.summary ?? "").slice(0, 900),
);
if (!APPROVE) {
  console.log("timings", JSON.stringify(timings));
  console.log(
    "Plan prepared; re-run with --approve to approve exactly this card.",
  );
  process.exit(0);
}
const approvedAt = Date.now();
const approved = await api(
  "POST",
  `/v1/q/approvals/${plan.approvalId}/approve`,
  {},
);
console.log(
  at(),
  "approved",
  approved.status,
  approved.json?.status ?? approved.text,
);

const ENDED = ["DONE", "FAILED", "HELD", "CANCELLED", "STOPPED", "BLOCKED"];
let detail = null;
for (let i = 0; i < 360; i += 1) {
  const jobs = (await api("GET", "/v1/q/workforce/jobs")).json;
  const found = (jobs?.items ?? []).find((one) => one.trace?.runId === runId);
  if (found !== undefined) {
    detail = (await api("GET", `/v1/q/workforce/jobs/${found.id}`)).json;
    if (ENDED.includes(detail?.job?.status)) break;
  }
  await wait(5_000);
}
timings.jobTotalMs = Date.now() - approvedAt;
const ms = (a) =>
  a.endedAt === null ? null : Date.parse(a.endedAt) - Date.parse(a.startedAt);
console.log(
  at(),
  "job",
  detail?.job?.status,
  detail?.job?.stoppedBecause ?? "",
  "| cost",
  detail?.job?.costUsd,
);
timings.agents = (detail?.agents ?? []).map((agent) => ({
  agent: agent.agentName,
  role: agent.role,
  status: agent.status,
  ms: ms(agent),
}));
for (const agent of detail?.agents ?? []) {
  console.log(
    " -",
    agent.agentName,
    `(${agent.role})`,
    "|",
    agent.status,
    "|",
    ms(agent),
    "ms |",
    (agent.summary ?? "").slice(0, 300),
  );
}
for (const draft of detail?.drafts ?? []) {
  console.log(
    " draft",
    draft.attempt,
    draft.channel,
    draft.outcome?.outcome ?? "",
    draft.outcome?.approvalStatus ?? "",
    "|",
    draft.body.slice(0, 200),
  );
}
console.log("timings", JSON.stringify(timings));
const passed =
  detail?.job?.status === "DONE" &&
  (detail?.agents ?? []).every(
    (agent) => agent.spawnedByRunId === null || agent.status === "DONE",
  );
console.log(passed ? "PASS job done, every step done" : "FAIL see above");
process.exit(passed ? 0 : 1);
