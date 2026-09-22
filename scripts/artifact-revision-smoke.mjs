#!/usr/bin/env node
/* global process, console, fetch, URL, crypto, setTimeout */
/**
 * Developer "Edit with Q" smoke (QX-003F; ADR 0013).
 *
 *   pnpm artifact:revise
 *
 * The revision half of the artifact journey, on its own, against a
 * conversation that already holds a document. It exists because preparing
 * a brief needs an EVIDENCE_SYNTHESIS route and revising one does not: on
 * a machine whose free-tier providers are spent, the preparation cannot
 * run and the revision still can, and the revision is the part worth
 * being able to check in isolation.
 *
 * It takes the most recent conversation of the synthetic founder that Q
 * has already put a document card into, asks for a change in that
 * conversation, and checks that a second version landed, that the first
 * is untouched, and that the answer carries the updated card.
 *
 * LOCAL ONLY, like every other smoke here: a non-loopback Supabase host is
 * refused. Run `pnpm dev:bootstrap` and `pnpm artifact:journey` first.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = { ...process.env };
const envFile = resolve(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || env[match[1]] !== undefined) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = env.SUPABASE_URL;
const PUBLISHABLE_KEY = env.SUPABASE_PUBLISHABLE_KEY;
const Q_API = (env.CQ_Q_API_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const PASSWORD = "CapitalQ-dev-2026!";

if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
  console.error(
    "artifact:revise: SUPABASE_URL and the publishable key are required",
  );
  process.exit(1);
}
if (
  !["127.0.0.1", "localhost", "::1"].includes(new URL(SUPABASE_URL).hostname)
) {
  console.error("artifact:revise: refusing a non-local Supabase host");
  process.exit(1);
}

let failures = 0;
const check = (label, condition, detail) => {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
};

async function signIn(email) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  if (!response.ok) {
    console.error("artifact:revise: could not sign in; run pnpm dev:bootstrap");
    process.exit(1);
  }
  return (await response.json()).access_token;
}

async function q(token, method, path, body) {
  const response = await fetch(`${Q_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

const token = await signIn("dev-founder@capitalq.local");

/** The newest conversation of theirs that Q has put a document card into. */
const conversations = await q(token, "GET", "/v1/q/conversations?limit=40");
let target = null;
for (const summary of conversations.body?.items ?? []) {
  const detail = await q(
    token,
    "GET",
    `/v1/q/conversations/${summary.conversationId}`,
  );
  for (const message of [...(detail.body?.messages ?? [])].reverse()) {
    const card = (message.blocks ?? []).find(
      (block) => block.kind === "ARTIFACT_REFERENCE",
    );
    if (card !== undefined) {
      target = { conversationId: summary.conversationId, card };
      break;
    }
  }
  if (target !== null) break;
}

if (target === null) {
  console.error(
    "artifact:revise: no conversation holds a document card yet; run pnpm artifact:journey first",
  );
  process.exit(1);
}

const before = await q(
  token,
  "GET",
  `/v1/q/artifacts/${target.card.artifactId}`,
);
const startedAt = before.body?.artifact?.currentVersion ?? 0;
const v1Content = JSON.stringify(
  (
    await q(
      token,
      "GET",
      `/v1/q/artifacts/${target.card.artifactId}/versions/1`,
    )
  ).body?.current?.content,
);
console.log(
  `\nQX-003F — Edit with Q, in a conversation that already holds "${target.card.title}" (v${String(startedAt)})`,
);

const started = await q(token, "POST", "/v1/q/runs", {
  capability: "ANSWER",
  message: { text: "Make the executive summary shorter and less promotional." },
  modality: "TEXT",
  conversationId: target.conversationId,
});
check(
  "the revision run was accepted",
  [200, 201, 202].includes(started.status),
  String(started.status),
);
const runId = started.body?.runId;
let status = "PENDING";
for (let attempt = 0; attempt < 120 && runId !== undefined; attempt += 1) {
  await new Promise((done) => setTimeout(done, 1000));
  const run = await q(token, "GET", `/v1/q/runs/${runId}`);
  status = run.body?.status ?? "PENDING";
  if (["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(status)) break;
}
check("it completed", status === "COMPLETED", status);

const after = await q(
  token,
  "GET",
  `/v1/q/artifacts/${target.card.artifactId}`,
);
const now = after.body?.artifact?.currentVersion ?? 0;
check(
  "a new version landed",
  now === startedAt + 1,
  `v${String(startedAt)} → v${String(now)}`,
);
check(
  "the history lists every version, newest first",
  JSON.stringify((after.body?.history ?? []).map((h) => h.version)) ===
    JSON.stringify(Array.from({ length: now }, (_, index) => now - index)),
);
check(
  "the new version records what was asked for",
  typeof after.body?.current?.instruction === "string" &&
    after.body.current.instruction.length > 0,
  after.body?.current?.instruction?.slice(0, 60),
);

const v1After = await q(
  token,
  "GET",
  `/v1/q/artifacts/${target.card.artifactId}/versions/1`,
);
check("version 1 still opens", v1After.status === 200, String(v1After.status));
check(
  "and reads exactly as it did",
  JSON.stringify(v1After.body?.current?.content) === v1Content,
);

const conversation = await q(
  token,
  "GET",
  `/v1/q/conversations/${target.conversationId}`,
);
const answer = [...(conversation.body?.messages ?? [])]
  .reverse()
  .find((message) => message.role === "Q");
const updatedCard = (answer?.blocks ?? []).find(
  (block) => block.kind === "ARTIFACT_REFERENCE",
);
check("the answer carries the updated card", updatedCard !== undefined);
check(
  "it names the same document, not a second one",
  updatedCard?.artifactId === target.card.artifactId,
);
if (updatedCard === undefined) {
  console.log(`  (answer: ${String(answer?.text ?? "").slice(0, 240)})`);
}

console.log(
  `\n${failures === 0 ? "artifact:revise PASS" : `artifact:revise FAIL (${failures})`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
