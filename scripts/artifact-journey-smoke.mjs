#!/usr/bin/env node
/* global process, console, fetch, URL, crypto, setTimeout */
/**
 * Developer artifact journey smoke (QX-003D/E/F; ADR 0013).
 *
 *   pnpm artifact:journey
 *
 * The whole of Checkpoints D, E and F over real HTTP, as a person's
 * browser would take it: sign in as the synthetic founder, ask Q for an
 * investment brief, read the card out of the answer, open the artifact,
 * ask for a change, and check that V2 exists and V1 is untouched. Then
 * the negative half: the synthetic investor, who is another tenant, must
 * not be able to read any of it.
 *
 * Nothing here reaches into a table. Every read and write goes through
 * the same routes the web application uses, under a real session token,
 * so what passes here is what a person gets.
 *
 * LOCAL ONLY: refuses any Supabase host that is not loopback, exactly as
 * `dev:bootstrap` does. Run `pnpm dev:bootstrap` first; the accounts and
 * the founder's canonical company come from there.
 *
 * Reads SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY from `.env.local` or the
 * environment, CQ_Q_API_URL (default http://127.0.0.1:3002). Values are
 * never printed.
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
const API = (env.CQ_API_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const PASSWORD = "CapitalQ-dev-2026!";

if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
  console.error(
    "artifact:journey: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required",
  );
  process.exit(1);
}
if (
  !["127.0.0.1", "localhost", "::1"].includes(new URL(SUPABASE_URL).hostname)
) {
  console.error(
    `artifact:journey: refusing a non-local Supabase host (${new URL(SUPABASE_URL).hostname})`,
  );
  process.exit(1);
}

let failures = 0;
function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

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
    console.error(
      `artifact:journey: could not sign in as ${email}; run pnpm dev:bootstrap first`,
    );
    process.exit(1);
  }
  const body = await response.json();
  return body.access_token;
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

/**
 * The company this person's founder journey is bound to, resolved the way
 * Home resolves it: through the onboarding session, never from a table.
 */
async function ownCompanyId(token) {
  const response = await fetch(
    `${API}/v1/onboarding/sessions/current?journeyType=founder`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return undefined;
  const body = await response.json().catch(() => null);
  const subject = body?.session?.subject;
  return subject?.type === "COMPANY" ? subject.id : undefined;
}

/**
 * The public sentence Q uses when no model route came through.
 *
 * Matched so a provider rate limit is reported as what it is rather than
 * as a failed assertion about artifacts. This retries the provider, never
 * a failing check: a run that completes with a real answer is judged on
 * that answer, once.
 */
const MODEL_UNAVAILABLE = "I couldn't get a full review through just now";

/** Ask, and try again when a free-tier provider was simply out of quota. */
async function askWithProviderRetry(token, text, conversationId, subjects) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await askOnce(token, text, conversationId, subjects);
    if (!String(last.answer?.text ?? "").includes(MODEL_UNAVAILABLE)) {
      return last;
    }
    console.log(
      `  (no model route on attempt ${String(attempt + 1)}; waiting for the provider)`,
    );
    await new Promise((done) => setTimeout(done, 45_000));
  }
  return last;
}

/** Ask, then wait for the run to settle and return its Q message blocks. */
async function askOnce(token, text, conversationId, subjects) {
  const started = await q(token, "POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text },
    modality: "TEXT",
    ...(subjects === undefined ? {} : { subjects }),
    ...(conversationId === undefined ? {} : { conversationId }),
  });
  if (![200, 201, 202].includes(started.status)) {
    console.error(
      `artifact:journey: run refused (${started.status})`,
      JSON.stringify(started.body).slice(0, 300),
    );
    process.exit(1);
  }
  const runId = started.body.runId;
  const conversation = started.body.conversationId;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((done) => setTimeout(done, 1000));
    const run = await q(token, "GET", `/v1/q/runs/${runId}`);
    const status = run.body?.status;
    if (["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(status)) {
      const detail = await q(
        token,
        "GET",
        `/v1/q/conversations/${conversation}`,
      );
      const messages = detail.body?.messages ?? [];
      const answer = [...messages].reverse().find((m) => m.role === "Q");
      return { status, conversationId: conversation, answer };
    }
  }
  return { status: "TIMEOUT", conversationId: conversation, answer: undefined };
}

const founder = await signIn("dev-founder@capitalq.local");
const investor = await signIn("dev-investor@capitalq.local");
const companyId = await ownCompanyId(founder);
if (companyId === undefined) {
  console.error(
    "artifact:journey: the synthetic founder has no company; run pnpm dev:bootstrap",
  );
  process.exit(1);
}
// The subject Home always passes. The firewall authorises against it and
// the artifact is prepared about it; nothing downstream may widen it.
const subjects = [{ kind: "COMPANY", companyId }];

/**
 * A founder with a brand-new company has nothing on record, and a brief
 * composed from nothing is correctly refused. So the journey starts where
 * a real one does: telling Q about the company. Each of these is recorded
 * as their own claim through the Knowledge Write Gate, exactly as it would
 * be if they had typed it on Home.
 */
console.log("\nSetting the record — the founder tells Q about the company");
let thread;
for (const statement of [
  "My company is called Northstar Logistics and we move freight between Lagos and Abuja.",
  "We charge shippers a per-kilometre rate, and we run eleven trucks.",
  "We are raising a seed round to buy more trucks and hire two operations managers.",
]) {
  const said = await askWithProviderRetry(founder, statement, thread, subjects);
  thread = said.conversationId;
  check(
    `Q took "${statement.slice(0, 38)}..."`,
    said.status === "COMPLETED",
    said.status,
  );
}

console.log("\nQX-003D — Q prepares a real artifact inside a real run");
const prepared = await askWithProviderRetry(
  founder,
  "Prepare a short investment brief on my company.",
  thread,
  subjects,
);
check("the run completed", prepared.status === "COMPLETED", prepared.status);
const blocks = prepared.answer?.blocks ?? [];
const card = blocks.find((block) => block.kind === "ARTIFACT_REFERENCE");
check("the answer carries an ARTIFACT_REFERENCE card", card !== undefined);
if (card === undefined) {
  console.log(
    `  (blocks: ${JSON.stringify(blocks.map((b) => b.kind))}; answer: ${String(
      prepared.answer?.text ?? "",
    ).slice(0, 200)})`,
  );
  process.exit(1);
}
check("it is an investment brief", card.type === "INVESTMENT_BRIEF", card.type);
check("it is ready to read", card.status === "READY", card.status);

console.log("\nQX-003E — the viewer reads a real persisted V1");
const v1 = await q(founder, "GET", `/v1/q/artifacts/${card.artifactId}`);
check("the artifact opens", v1.status === 200, String(v1.status));
check("it is at version 1", v1.body?.artifact?.currentVersion === 1);
const sections = v1.body?.current?.content?.sections ?? [];
check(
  "it has real sections",
  sections.length > 1,
  `${sections.length} sections`,
);
check(
  "the first section is a summary",
  sections[0]?.heading === "Summary",
  sections[0]?.heading,
);
check(
  "sections carry the findings they rest on",
  sections.some((section) => (section.findings ?? []).length > 0),
);
check(
  "no evidence identifier travels",
  sections.every((section) =>
    (section.findings ?? []).every(
      (finding) => (finding.evidenceRefs ?? []).length === 0,
    ),
  ),
);
check(
  "what is not on record is named as a gap",
  (v1.body?.current?.content?.gaps ?? []).length > 0,
);
const listed = await q(founder, "GET", "/v1/q/artifacts?limit=20");
check(
  "it appears in the person's own list",
  (listed.body?.items ?? []).some(
    (item) => item.artifactId === card.artifactId,
  ),
);

console.log("\nQX-003F — Edit with Q makes V2 and keeps V1");
const revised = await askWithProviderRetry(
  founder,
  "Make the executive summary shorter and less promotional.",
  prepared.conversationId,
  subjects,
);
check(
  "the revision run completed",
  revised.status === "COMPLETED",
  revised.status,
);
const revisedCard = (revised.answer?.blocks ?? []).find(
  (block) => block.kind === "ARTIFACT_REFERENCE",
);
check("the answer carries the updated card", revisedCard !== undefined);
if (revisedCard === undefined) {
  console.log(
    `  (blocks: ${JSON.stringify(
      (revised.answer?.blocks ?? []).map((b) => b.kind),
    )}; answer: ${String(revised.answer?.text ?? "").slice(0, 300)})`,
  );
}
check(
  "it is the same artifact, not a second one",
  revisedCard?.artifactId === card.artifactId,
);
const v2 = await q(founder, "GET", `/v1/q/artifacts/${card.artifactId}`);
check(
  "the artifact is now at version 2",
  v2.body?.artifact?.currentVersion === 2,
);
check(
  "the history lists both versions, newest first",
  JSON.stringify((v2.body?.history ?? []).map((h) => h.version)) === "[2,1]",
);
check(
  "the revision records what was asked for",
  typeof v2.body?.current?.instruction === "string" &&
    v2.body.current.instruction.length > 0,
);
const keptV1 = await q(
  founder,
  "GET",
  `/v1/q/artifacts/${card.artifactId}/versions/1`,
);
check("version 1 still opens", keptV1.status === 200, String(keptV1.status));
check(
  "and reads exactly as it did",
  JSON.stringify(keptV1.body?.current?.content) ===
    JSON.stringify(v1.body?.current?.content),
);
check(
  "while the artifact knows it has moved on",
  keptV1.body?.artifact?.currentVersion === 2,
);

console.log("\nSecurity — knowing an identifier is not permission");
const crossTenant = await q(
  investor,
  "GET",
  `/v1/q/artifacts/${card.artifactId}`,
);
check(
  "another tenant cannot read it",
  crossTenant.status === 404,
  String(crossTenant.status),
);
const crossVersion = await q(
  investor,
  "GET",
  `/v1/q/artifacts/${card.artifactId}/versions/1`,
);
check(
  "nor any version of it",
  crossVersion.status === 404,
  String(crossVersion.status),
);
const crossList = await q(investor, "GET", "/v1/q/artifacts?limit=20");
check(
  "nor see it in their own list",
  !(crossList.body?.items ?? []).some(
    (item) => item.artifactId === card.artifactId,
  ),
);
const anonymous = await fetch(`${Q_API}/v1/q/artifacts/${card.artifactId}`);
check(
  "and an unauthenticated caller gets nowhere",
  anonymous.status === 401 || anonymous.status === 403,
  String(anonymous.status),
);
const invented = await q(
  founder,
  "GET",
  `/v1/q/artifacts/${crypto.randomUUID()}`,
);
check(
  "an artifact that does not exist answers the same way as one that is not yours",
  invented.status === 404,
  String(invented.status),
);

console.log(
  `\n${failures === 0 ? "artifact:journey PASS" : `artifact:journey FAIL (${failures})`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
