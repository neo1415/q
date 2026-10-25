// Production regression guard: every finding the owner or QA hit becomes a
// case with a deterministic expectation on the run's shape (status, block
// kinds, approval) and on failure language. It checks the observable result
// of a turn; it never steers Q's behaviour. Exit code 1 when any case fails,
// so a deploy that brings a fixed finding back is caught before more ships.
// Usage: CQ_PUBLIC_JSON=<{url,key}> CQ_SEED_ACCOUNT_PASSWORD=… NODE_USE_ENV_PROXY=1
//   node scripts/handoff/live/regression-guard.mjs [cases.json] [out.json] [--only=F-106,F-107]
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const pub = JSON.parse(
  readFileSync(process.env.CQ_PUBLIC_JSON ?? "public.json", "utf8"),
);
const QAPI = "https://capital-qq-api-production.up.railway.app";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const CASES = JSON.parse(
  readFileSync(
    args[0] ?? new URL("./journeys/regression-guard.json", import.meta.url),
    "utf8",
  ),
);
const out = args[1] ?? "regression-guard-out.json";
// Language that only ever appears when a turn broke (a dead tool, a lost
// reference, a misreported limit). A case can add its own.
const FAILURE_LANGUAGE = [
  "isn't available (to me|on your account)",
  "reference was invalid",
  "revision failed",
  "something went wrong",
  "internal error",
];
const ANSWERED = new Set(["COMPLETED", "AWAITING_INPUT", "AWAITING_APPROVAL"]);

const tokens = new Map();
async function signIn(email) {
  if (tokens.has(email)) return tokens.get(email);
  const s = await fetch(`${pub.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: pub.key, "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
    }),
  });
  const token = (await s.json()).access_token;
  if (!token) throw new Error(`sign-in failed for ${email}: ${s.status}`);
  tokens.set(email, token);
  return token;
}

async function api(token, method, path, body) {
  const r = await fetch(`${QAPI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {
    // Not JSON: the text is reported instead.
  }
  return { status: r.status, json: j, text: t.slice(0, 300) };
}

async function turn(token, conv, ask) {
  const t0 = Date.now();
  const c = await api(token, "POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text: ask },
    modality: "TEXT",
    ...(conv ? { conversationId: conv } : {}),
  });
  const runId = c.json?.runId;
  if (!runId) return { error: `${c.status} ${c.text}`, ms: Date.now() - t0 };
  let run;
  for (;;) {
    run = (await api(token, "GET", `/v1/q/runs/${runId}`)).json ?? {};
    const qs = (run.messages ?? []).filter((m) => m.role === "Q");
    if (
      (ANSWERED.has(run.status) && qs.length > 0) ||
      ["FAILED", "CANCELLED", "EXPIRED"].includes(run.status)
    )
      break;
    if (Date.now() - t0 > 120000) {
      run.status = "TIMED_OUT";
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const q = (run.messages ?? []).filter((m) => m.role === "Q").at(-1) ?? {};
  const raw = q.resultBlocks ?? q.result_blocks ?? q.blocks ?? [];
  return {
    runId,
    conversationId: c.json?.conversationId ?? run.conversationId ?? conv,
    ms: Date.now() - t0,
    status: run.status,
    reply: q.text ?? q.content ?? "",
    blocks: raw.map((b) => b.kind ?? b.type),
    jobId:
      raw.find((b) => (b.kind ?? b.type) === "WORK_IN_PROGRESS")?.jobId ?? null,
    approval:
      Boolean(run.pendingApproval) ||
      run.status === "AWAITING_APPROVAL" ||
      raw.some((b) => (b.kind ?? b.type) === "ACTION_PROPOSAL"),
  };
}

function judge(r, expect = {}) {
  const why = [];
  if (r.error) return [r.error];
  const statuses = expect.status ?? [...ANSWERED];
  if (!statuses.includes(r.status)) why.push(`status ${r.status}`);
  if (expect.anyBlock && !expect.anyBlock.some((k) => r.blocks.includes(k)))
    why.push(
      `none of ${expect.anyBlock.join("/")} (got ${r.blocks.join(",") || "-"})`,
    );
  for (const k of expect.noBlock ?? [])
    if (r.blocks.includes(k)) why.push(`unexpected ${k}`);
  if (expect.approval === true && !r.approval) why.push("no approval card");
  if (expect.approval === false && r.approval)
    why.push("approval card on own work");
  for (const p of [...FAILURE_LANGUAGE, ...(expect.replyNot ?? [])])
    if (new RegExp(p, "i").test(r.reply)) why.push(`reply says /${p}/`);
  for (const p of expect.replyMatches ?? [])
    if (!new RegExp(p, "iu").test(r.reply)) why.push(`reply lacks /${p}/`);
  if (expect.maxMs && r.ms > expect.maxMs)
    why.push(`${r.ms} ms > ${expect.maxMs}`);
  return why;
}

/**
 * A job the turn started yields a document, degraded or not (2026-10-25:
 * every research-backed job died in 5 s while the public indexes rested).
 * Polls the job's live state, as its owner, until it files a document or
 * stops; a FAILED or STOPPED job, or none within the bound, fails the case.
 */
async function jobOutcome(token, jobId, maxMs) {
  if (!jobId) return ["no WORK_IN_PROGRESS job to follow"];
  const t0 = Date.now();
  for (;;) {
    const live = (
      await api(
        token,
        "GET",
        `/v1/q/workforce/jobs/${encodeURIComponent(jobId)}/live`,
      )
    ).json;
    if (live?.document) return [];
    if (live?.state === "FAILED" || live?.state === "STOPPED")
      return [`job ${live.state}: ${live.reason ?? "-"}`];
    if (Date.now() - t0 > maxMs)
      return [`no document within ${maxMs} ms (${live?.state ?? "?"})`];
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const results = [];
let failed = 0;
for (const c of CASES) {
  if (only && !only.includes(c.id)) continue;
  let conv = null;
  try {
    const token = await signIn(c.account);
    for (const step of c.steps) {
      const r = await turn(token, conv, step.ask);
      conv = r.conversationId ?? conv;
      const why = judge(r, step.expect);
      // A document the turn filed itself needs no job to follow.
      if (
        step.expect?.jobDocument &&
        !r.error &&
        !(r.blocks ?? []).includes("ARTIFACT_REFERENCE")
      ) {
        why.push(
          ...(await jobOutcome(
            token,
            r.jobId,
            step.expect.jobDocument.maxMs ?? 120000,
          )),
        );
      }
      if (why.length) failed++;
      results.push({ id: c.id, ask: step.ask, pass: !why.length, why, ...r });
      console.log(
        `${why.length ? "FAIL" : "pass"} ${c.id} [${r.ms} ms ${r.status}] ${step.ask}${why.length ? `\n     ${why.join("; ")}\n     > ${r.reply.slice(0, 220).replace(/\n/g, " ")}` : ""}`,
      );
    }
  } catch (e) {
    failed++;
    results.push({ id: c.id, pass: false, why: [String(e)] });
    console.log(`FAIL ${c.id} ${e}`);
  }
}
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
