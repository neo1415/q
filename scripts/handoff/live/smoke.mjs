// Post-deploy live smoke for Q (harden spec §5). At most 10 cheap turns,
// straight to the q-api (no browser), on a fictional account.
//
//   NODE_USE_ENV_PROXY=1 EMAIL=smoke.founder@fictional.capitalq.local \
//   CQ_SEED_ACCOUNT_PASSWORD=... SB_URL=https://<ref>.supabase.co \
//   SB_PUBLISHABLE=<publishable key> [SUPABASE_ACCESS_TOKEN=...] \
//   [SMOKE_RESEARCH=1] node scripts/handoff/live/smoke.mjs
//
// Each case names the capability it exercises and what it expects. A
// failure prints the run's public failure, its correlation id and, when
// SUPABASE_ACCESS_TOKEN is set, every ai_ops.model_usage row of that
// correlation (task class, model, latency, error code): the exact cause.
// The research case calls a paid search provider and runs only with
// SMOKE_RESEARCH=1. Exit code 1 when any case fails.

import { randomUUID } from "node:crypto";

const QAPI =
  process.env.QAPI ?? "https://capital-qq-api-production.up.railway.app";
const need = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};
const EMAIL = need("EMAIL");
if (!EMAIL.endsWith("@fictional.capitalq.local")) {
  console.error(
    "smoke runs on fictional accounts only (@fictional.capitalq.local)",
  );
  process.exit(2);
}

// ---- sign in --------------------------------------------------------------
const signIn = await fetch(
  `${need("SB_URL")}/auth/v1/token?grant_type=password`,
  {
    method: "POST",
    headers: {
      apikey: need("SB_PUBLISHABLE"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: EMAIL,
      password: need("CQ_SEED_ACCOUNT_PASSWORD"),
    }),
  },
);
if (!signIn.ok) {
  console.error(`sign-in failed: HTTP ${signIn.status}`);
  process.exit(1);
}
const { access_token: token } = await signIn.json();

async function api(method, path, body) {
  const response = await fetch(`${QAPI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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
  return { status: response.status, json, text: text.slice(0, 400) };
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]);
// A conversation's run waits for the next turn once it has answered.
const ANSWERED = new Set(["COMPLETED", "AWAITING_INPUT", "AWAITING_APPROVAL"]);
const qMessages = (run) => (run?.messages ?? []).filter((m) => m.role === "Q");

/** Until the run is done or waiting, with more Q messages than before. */
async function settle(runId, before, deadlineMs = 45_000) {
  const started = Date.now();
  for (;;) {
    const run = await api("GET", `/v1/q/runs/${runId}`);
    const json = run.json ?? {};
    if (TERMINAL.has(json.status) && !ANSWERED.has(json.status)) return json;
    if (ANSWERED.has(json.status) && qMessages(json).length > before)
      return json;
    if (Date.now() - started > deadlineMs)
      return { ...json, status: "TIMED_OUT" };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function usageOf(correlationId) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token === undefined || correlationId === undefined) return null;
  const response = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `select task_class, attempt, latency_ms, success, error_code from ai_ops.model_usage where correlation_id = '${correlationId.replace(/[^a-zA-Z0-9_-]/g, "")}' order by occurred_at`,
        read_only: true,
      }),
    },
  );
  return response.ok
    ? response.json()
    : `model_usage read HTTP ${response.status}`;
}

const lastAssistant = (run) => qMessages(run).at(-1)?.text ?? "";

// ---- cases ----------------------------------------------------------------
// expect: run status; check: an extra deterministic check on what came back.
const CASES = [
  { capability: "conversation", ask: "Hi Q, quick check: are you there?" },
  {
    capability: "tool.read_my_record",
    ask: "What do you have on record about my company?",
  },
  {
    capability: "tool.list_pending_approvals",
    ask: "Is anything waiting for my approval?",
  },
  { capability: "navigate.PROFILE", ask: "Take me to my profile." },
  {
    capability: "tool.list_my_documents",
    ask: "Which documents have you made for me?",
  },
  {
    capability: "next-step offer (NEXT_STEP_NOTE)",
    ask: "Summarise where my raise stands in two lines.",
    check: (reply) =>
      /\?\s*$/.test(reply.trim())
        ? null
        : "WARN: the reply does not end with an offer",
  },
  {
    capability: "acceptance (TURN_READER v18)",
    followUp: true,
    ask: "Yes, go ahead.",
  },
  {
    capability: "tool.note_preference / memory",
    ask: "Please keep your answers short from now on.",
  },
  ...(process.env.SMOKE_RESEARCH === "1"
    ? [
        {
          capability: "tool.research_public_web",
          ask: "What is the latest public news about Flutterwave?",
        },
      ]
    : []),
].slice(0, 10);

let failures = 0;
// A finished run takes no new messages: a follow-up is a new run in the
// same conversation, as the Home Q page sends it.
let previousConversation = null;
for (const testCase of CASES) {
  const t0 = Date.now();
  const followingUp =
    testCase.followUp === true && previousConversation !== null;
  const created = await api("POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text: testCase.ask },
    modality: "TEXT",
    ...(followingUp ? { conversationId: previousConversation } : {}),
  });
  const runId = created.json?.runId;
  if (created.status >= 300 || runId === undefined || runId === null) {
    failures += 1;
    console.log(
      `FAIL ${testCase.capability}: HTTP ${created.status} ${created.text}`,
    );
    continue;
  }
  const run = await settle(runId, 0);
  previousConversation =
    created.json?.conversationId ?? run.conversationId ?? null;
  const ms = Date.now() - t0;
  const reply = String(lastAssistant(run));
  const problem = !ANSWERED.has(run.status)
    ? `run ${run.status}${run.failure === undefined ? "" : ` ${JSON.stringify(run.failure)}`}`
    : reply.length === 0
      ? "no reply"
      : (testCase.check?.(reply) ?? null);
  const hard = problem !== null && !problem.startsWith("WARN");
  if (hard) failures += 1;
  console.log(
    `${hard ? "FAIL" : problem === null ? "OK  " : "WARN"} ${testCase.capability} (${ms} ms, run ${runId}, ${run.correlationId ?? "no correlation"})${problem === null ? "" : `: ${problem}`}`,
  );
  console.log(`     Q: ${reply.replace(/\s+/g, " ").slice(0, 220)}`);
  if (problem !== null) {
    const usage = await usageOf(run.correlationId);
    if (usage !== null)
      console.log(`     model_usage: ${JSON.stringify(usage)}`);
  }
}
console.log(`${CASES.length - failures}/${CASES.length} passed`);
process.exit(failures === 0 ? 0 : 1);
