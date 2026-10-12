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
for (let i = 0; i < 120; i += 1) {
  run = (await api("GET", `/v1/q/runs/${runId}`)).json;
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
  await wait(1_000);
}
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
  console.log("FAIL no workforce plan card was prepared");
  process.exit(1);
}
console.log(
  at(),
  "plan preview:",
  (plan.action?.preview ?? plan.action?.summary ?? "").slice(0, 900),
);
if (!APPROVE) {
  console.log(
    "Plan prepared; re-run with --approve to approve exactly this card.",
  );
  process.exit(0);
}
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

let job = null;
for (let i = 0; i < 180; i += 1) {
  const jobs = (await api("GET", "/v1/q/workforce/jobs")).json;
  const items = jobs?.items ?? jobs?.jobs ?? [];
  const found = items.find((one) =>
    (one.goal ?? "").startsWith(GOAL.slice(0, 60)),
  );
  if (found !== undefined) {
    job =
      (await api("GET", `/v1/q/workforce/jobs/${found.jobId ?? found.id}`))
        .json ?? found;
    if (
      ["DONE", "FAILED", "HELD", "CANCELLED", "STOPPED"].includes(job?.status)
    )
      break;
  }
  await wait(5_000);
}
console.log(at(), "job", job?.status);
for (const step of job?.steps ?? job?.runs ?? []) {
  console.log(
    " -",
    step.agentName ?? step.role,
    "|",
    step.status,
    "|",
    (step.summary ?? "").slice(0, 300),
  );
}
console.log(JSON.stringify(job).slice(0, 4000));
