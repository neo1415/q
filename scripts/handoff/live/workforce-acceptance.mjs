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
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Q_API, signIn } from "./fictional-session.mjs";

const APPROVE = process.argv.includes("--approve");
const VERIFY = process.argv.includes("--verify");
if (VERIFY && !process.env.CQ_WORKFORCE_RUN)
  throw new Error("Verification requires the existing owned CQ_WORKFORCE_RUN");
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
const evidenceDir = mkdtempSync(join(tmpdir(), "cq-workforce-acceptance-"));
function preserve(name, value) {
  writeFileSync(join(evidenceDir, name + ".json"), JSON.stringify(value), {
    mode: 0o600,
  });
}

// Read-only continuation: prove an existing owned job without another paid turn
// or another approval attempt. The canonical queue read still binds its owner.
if (VERIFY) {
  const ownedRunId = process.env.CQ_WORKFORCE_RUN;
  const jobs = (await api("GET", "/v1/q/workforce/jobs")).json;
  const found = (jobs?.items ?? []).find(
    (one) => one.trace?.runId === ownedRunId,
  );
  if (!found) throw new Error("No job for the existing owned run");
  const ownedDetail = (await api("GET", `/v1/q/workforce/jobs/${found.id}`))
    .json;
  preserve("job", ownedDetail);
  await verifyDeliverables(ownedRunId, ownedDetail);
  console.log(
    "PASS verified existing owned workforce deliverables",
    evidenceDir,
  );
  process.exit(0);
}

// CQ_WORKFORCE_RUN: continue a run this runner already started (its plan
// card still pending) instead of asking again and filing a second card.
const created =
  process.env.CQ_WORKFORCE_RUN === undefined
    ? await api("POST", "/v1/q/runs", {
        capability: "ANSWER",
        message: { text: GOAL },
        modality: "TEXT",
      })
    : { status: 0, json: { runId: process.env.CQ_WORKFORCE_RUN }, text: "" };
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
preserve("run", run);
const reply =
  (run?.messages ?? []).filter((m) => m.role === "Q").at(-1)?.text ?? "";
console.log(at(), "run status", run?.status, "| Q said:", reply.slice(0, 600));
// The list carries no action; each card's detail does.
const approvals = (await api("GET", "/v1/q/approvals")).json;
const mine = await Promise.all(
  (approvals?.items ?? [])
    .filter((a) => a.runId === runId)
    .map(
      async (a) =>
        (await api("GET", `/v1/q/approvals/${a.approvalId}`)).json ?? a,
    ),
);
console.log(
  at(),
  "approval cards from this run:",
  mine.map((a) => `${a.action?.actionType}:${a.status}`).join(", ") || "none",
);
const plan = mine.find((a) => a.action?.actionType === "q.workforce.job.start");
preserve("plan-card", plan ?? null);
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
preserve("job", detail);
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
const stepsDone =
  detail?.job?.status === "DONE" &&
  (detail?.agents ?? []).some((agent) => agent.spawnedByRunId !== null) &&
  (detail?.agents ?? []).every(
    (agent) => agent.spawnedByRunId === null || agent.status === "DONE",
  );
let deliverablesVerified = false;
if (stepsDone) {
  try {
    await verifyDeliverables(runId, detail);
    deliverablesVerified = true;
  } catch (error) {
    preserve("deliverable-failure", { message: error.message });
    console.log("FAIL persisted deliverables did not satisfy acceptance");
  }
}
const passed = stepsDone && deliverablesVerified;
console.log(
  passed
    ? "PASS persisted research, memo, critique/revision, PDF and pending diligence card"
    : "FAIL inspect private acceptance receipts",
  evidenceDir,
);
process.exit(passed ? 0 : 1);

async function verifyDeliverables(runId, detail) {
  const tokenFile = process.env.CQ_SUPABASE_MANAGEMENT_TOKEN_FILE;
  if (!tokenFile)
    throw new Error("Missing read-only queue evidence credential");
  const uuid = /^[0-9a-f-]{36}$/iu;
  if (!uuid.test(runId) || !uuid.test(detail.job.id))
    throw new Error("Invalid owned run/job identifier");
  // Only this authenticated run's job, with both canonical owner bindings.
  // Privileged audit access remains local to this fictional-account runner.
  const query = `select q.state, q.plan, q.results from q_runtime.agent_work_queue q
    join q_runtime.runs r on r.id = '${runId}'::uuid
      and r.tenant_id = q.tenant_id and r.actor_user_id = q.user_id
    where q.job_id = '${detail.job.id}'::uuid
      and q.trace->>'runId' = r.id::text limit 1`;
  const response = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${readFileSync(tokenFile, "utf8").trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!response.ok) throw new Error("Owned queue evidence refused");
  const rows = await response.json();
  if (rows.length !== 1 || rows[0].state !== "COMPLETED")
    throw new Error("No completed owned queue row");
  const queue = rows[0];
  preserve("queue", queue);
  const steps = queue.plan.steps;
  const research = steps.find((step) => step.role === "RESEARCH");
  const memo = steps.find(
    (step) =>
      step.document?.operation === "PREPARE" &&
      step.document.kind === "MEMO" &&
      step.document.scope === "NAMED_COMPANY",
  );
  const critic = steps.find(
    (step) => step.document?.operation === "CRITIQUE_AND_REVISE",
  );
  const diligence = steps.find((step) =>
    step.tools.includes("diligence.questions.prepare"),
  );
  if (!research || !memo || !critic || !diligence)
    throw new Error("Required specialist plan is incomplete");
  for (const step of steps) {
    const result = queue.results[step.key];
    if (result?.status !== "DONE")
      throw new Error("A planned step has no persisted DONE result");
    const agent = detail.agents.find((one) => one.id === result.runId);
    if (!agent?.endedAt) throw new Error("A step has no finished agent run");
    for (const dependency of step.dependsOn) {
      const preceding = detail.agents.find(
        (one) => one.id === queue.results[dependency]?.runId,
      );
      if (
        !preceding?.endedAt ||
        Date.parse(preceding.endedAt) > Date.parse(agent.startedAt)
      )
        throw new Error("Specialist dependency ordering failed");
    }
  }
  const sources = queue.results[research.key].outputs?.note?.sources;
  if (!Array.isArray(sources) || sources.length === 0)
    throw new Error("Research has no persisted sources");
  const prepared = queue.results[memo.key].outputs;
  const reviewed = queue.results[critic.key].outputs;
  if (
    !uuid.test(prepared?.artifactId) ||
    prepared.companyId !== memo.document.companyId ||
    reviewed?.artifactId !== prepared.artifactId ||
    reviewed.companyId !== prepared.companyId ||
    typeof reviewed.review?.material !== "boolean"
  )
    throw new Error("Memo/critique binding failed");
  const artifact = (await api("GET", `/v1/q/artifacts/${prepared.artifactId}`))
    .json;
  preserve("artifact", artifact);
  if (
    artifact?.artifact.status !== "READY" ||
    artifact.artifact.type !== "MEMO" ||
    artifact.artifact.subject?.kind !== "COMPANY" ||
    artifact.artifact.subject.companyId !== prepared.companyId ||
    artifact.current?.version !== artifact.artifact.currentVersion ||
    !artifact.current?.content.sections.some((section) =>
      section.body.trim(),
    ) ||
    !artifact.history.some((version) => version.version === 1)
  )
    throw new Error("No real readable READY memo version");
  if (
    reviewed.review.material &&
    (!Number.isInteger(reviewed.review.revisedToVersion) ||
      reviewed.review.revisedToVersion < 2 ||
      artifact.current.version < reviewed.review.revisedToVersion ||
      !reviewed.review.issues?.some(
        (issue) => typeof issue.problem === "string" && issue.problem.trim(),
      ))
  )
    throw new Error("Material critique has no real revised version");
  const original = (
    await api("GET", `/v1/q/artifacts/${prepared.artifactId}/versions/1`)
  ).json;
  preserve("original-version", original);
  if (
    original?.artifact?.artifactId !== prepared.artifactId ||
    original.current?.artifactId !== prepared.artifactId ||
    original.current?.version !== 1 ||
    !original.current.content.sections.some((section) => section.body.trim())
  )
    throw new Error("Original version is not readable");
  if (reviewed.review.material) {
    // A later conversational edit may advance the current version. Read the
    // critic's actual immutable revision rather than assuming it stays latest.
    const revised =
      artifact.current.version === reviewed.review.revisedToVersion
        ? artifact
        : (
            await api(
              "GET",
              `/v1/q/artifacts/${prepared.artifactId}/versions/${reviewed.review.revisedToVersion}`,
            )
          ).json;
    preserve("reviewed-version", revised);
    if (
      revised?.current?.artifactId !== prepared.artifactId ||
      revised.current.version !== reviewed.review.revisedToVersion ||
      !revised.current.content.sections.some(
        (section) =>
          original.current.content.sections.find(
            (before) => before.heading === section.heading,
          )?.body !== section.body,
      )
    )
      throw new Error("Material critique has no substantive stored revision");
  }
  const pdf = await fetch(
    `${Q_API}/v1/q/artifacts/${prepared.artifactId}/export/pdf`,
    { headers: { authorization: `Bearer ${session.accessToken}` } },
  );
  const bytes = Buffer.from(await pdf.arrayBuffer());
  if (!pdf.ok || bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new Error("Memo PDF did not render");
  writeFileSync(join(evidenceDir, "memo.pdf"), bytes, { mode: 0o600 });
  const questions = queue.results[diligence.key].outputs;
  if (!questions?.questions?.length || !uuid.test(questions.qActionId))
    throw new Error("No founder-question approval card was filed");
  const waiting = (await api("GET", "/v1/q/approvals")).json;
  const cards = await Promise.all(
    waiting.items.map(
      async (item) =>
        (await api("GET", `/v1/q/approvals/${item.approvalId}`)).json,
    ),
  );
  const card = cards.find(
    (one) => one?.action?.actionId === questions.qActionId,
  );
  preserve("diligence-card", card ?? null);
  if (
    card?.status !== "PENDING" ||
    card.action.actionType !== "app.diligence.questions.send" ||
    card.action.actionStatus !== "AWAITING_APPROVAL" ||
    card.action.executedAt !== undefined
  )
    throw new Error("Founder contact is not safely pending approval");
  console.log(
    JSON.stringify({
      researchSources: sources.length,
      artifactReady: true,
      artifactVersion: artifact.current.version,
      realCritique: true,
      materialRevision: reviewed.review.material,
      pdfBytes: bytes.length,
      diligenceQuestions: questions.questions.length,
      diligencePending: true,
      dependenciesVerified: true,
    }),
  );
}
