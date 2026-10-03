#!/usr/bin/env node
/* global process, console, fetch, setTimeout, clearTimeout, AbortController, TextDecoder */
/**
 * Voice eval, text in (harden-36). Every case is a spoken turn without
 * the audio: the same `POST /v1/q/runs` a voice turn makes (capability
 * ANSWER, modality VOICE; apps/q-api/src/voice/turn.ts askQ), its stream
 * read live from `GET /v1/q/runs/:id/events`, and what voice would SAY
 * rebuilt with voice's own functions (speakable, unsaidPartOf,
 * followOfAnswer), imported from source, not copied. No speech provider
 * is touched; the only spend is the run's model calls.
 *
 * Checks, per case:
 *   - outcome from records (a navigate the screen follows, a card
 *     proposed with working hours, a run that answered);
 *   - spoken: something was said, no sentence said more often than the
 *     answer has it (the lead list repeated by the model), and the
 *     answer's last sentence was said
 *     (the gateway never streams it; voice says the unsaid tail).
 *
 * Out of reach here: a spoken "yes" to a pending card goes through the
 * voice session's approval path, not a run; voice-parity.test.ts and the
 * voice suites cover it.
 *
 *   node scripts/evals/q-voice/run.mjs --dry-run     # cases and cost only
 *   Q_API=… SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *   SUPABASE_PROJECT=… EVAL_FOUNDER_EMAIL=… EVAL_INVESTOR_EMAIL=… \
 *   CQ_SEED_ACCOUNT_PASSWORD=… pnpm q:eval:voice [--only=<id>]
 *
 * Fictional accounts only (@fictional.capitalq.local), never the
 * founder's own. Cards are prepared, never approved; navigation and reads
 * change nothing.
 */
import { randomUUID } from "node:crypto";

const DRY = process.argv.includes("--dry-run");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
/** Upper bound per model call at today's routing. */
const COST_PER_CALL_USD = Number(process.env.COST_PER_CALL_USD ?? "0.02");
/** Turn reader, router, answer. */
const CALLS_PER_CASE = 3;
/** The company the investor's prepared action names (fictional seed). */
const COMPANY = process.env.EVAL_COMPANY_NAME ?? "Ajopot";

/**
 * `expect`: NAVIGATE <destination> | CARD <action type> | ANSWER.
 * `workingHours`: the card's payload must carry working hours.
 */
const CASES = [
  {
    id: "what-next",
    as: "FOUNDER",
    text: "What should I do next?",
    expect: "ANSWER",
  },
  {
    id: "read-my-documents",
    as: "FOUNDER",
    text: "What documents have I uploaded?",
    expect: "ANSWER",
  },
  {
    id: "navigate-usage",
    as: "FOUNDER",
    text: "Take me to my usage.",
    expect: "NAVIGATE USAGE",
  },
  {
    id: "navigate-passed",
    as: "INVESTOR",
    text: "Show me the companies I passed on.",
    expect: "NAVIGATE PASSED",
  },
  {
    id: "delegate-standing",
    as: "FOUNDER",
    text: "From now on, when an investor asks for a meeting, book it for me, but only during my working hours.",
    expect: "CARD q.instruction.grant",
    workingHours: true,
  },
  {
    id: "app-action",
    as: "INVESTOR",
    text: `Express interest in ${COMPANY}.`,
    expect: "CARD app.",
  },
];

const cases = CASES.filter((c) => only === undefined || c.id === only);

if (DRY) {
  for (const c of cases)
    console.log(
      `${c.id.padEnd(20)} ${c.as.padEnd(9)} ${c.expect.padEnd(26)} ${c.text}`,
    );
  console.log(
    `\n${String(cases.length)} cases, ~${String(cases.length * CALLS_PER_CASE)} model calls, <= $${(cases.length * CALLS_PER_CASE * COST_PER_CALL_USD).toFixed(2)}`,
  );
  process.exit(0);
}

// Voice's own code, from source (Node strips the types; dev-env maps
// `.js` specifiers onto `.ts`). Loaded only for a real run.
await import("../../dev-env.mjs");
const { unsaidPartOf } = await import("../../../apps/q-api/src/voice/turn.ts");
const { speakable, SPOKEN_MAX_CHARS } =
  await import("../../../apps/q-api/src/voice/speech.ts");
const { followOfAnswer } =
  await import("../../../apps/q-api/src/voice/navigation.ts");

const env = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (or run with --dry-run)`);
  }
  return value;
};

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
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function signIn(email) {
  const r = await fetch(
    `${env("SUPABASE_URL")}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: env("SUPABASE_ANON_KEY"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: env("CQ_SEED_ACCOUNT_PASSWORD"),
      }),
    },
  );
  const body = await r.json();
  if (typeof body.access_token !== "string")
    throw new Error(`sign-in failed for ${email}`);
  return body.access_token;
}

/** What voice's askQ sends, as a request of its own. */
async function askAsVoice(token, text) {
  const r = await fetch(`${env("Q_API")}/v1/q/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      capability: "ANSWER",
      message: { text },
      modality: "VOICE",
    }),
  });
  const body = await r.json().catch(() => null);
  return body?.run?.id ?? body?.runId ?? body?.id ?? null;
}

const TERMINAL = /^q\.run\.(completed|failed)$/u;

/**
 * The run's stream as voice reads it: sentences as they stream, then the
 * completed message. Deltas are live only; one sent before this connects
 * is missed, and voice's tail logic then says it from the completed text,
 * exactly as it would for a re-collected stream.
 */
async function streamOf(token, runId) {
  const deltas = [];
  let message = null;
  // A run that proposed a card waits for approval without ending: it is
  // done for voice once the card is asked for and the answer is in.
  let awaiting = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const r = await fetch(`${env("Q_API")}/v1/q/runs/${runId}/events`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    if (r.body === null) return { deltas, message };
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of r.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const name = /^event: (.*)$/mu.exec(frame)?.[1];
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (name === undefined || data.length === 0) continue;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        const payload = event.data ?? event.payload ?? event;
        if (name === "q.message.delta" && typeof payload.text === "string")
          deltas.push(payload.text);
        if (name === "q.message.completed") message = payload.message ?? null;
        if (name === "q.approval.required") awaiting = true;
        if (TERMINAL.test(name) || (awaiting && message !== null)) {
          controller.abort();
          return { deltas, message };
        }
      }
    }
  } catch {
    // Aborted on a terminal event or the timeout; what was read stands.
  } finally {
    clearTimeout(timer);
  }
  return { deltas, message };
}

/** What voice says for this stream (turn.ts, the delta and completed arms). */
function spokenOf({ deltas, message }) {
  const parts = [];
  let spokenCharacters = 0;
  let streamedRaw = "";
  for (const text of deltas) {
    const spoken = speakable(text);
    if (spoken.length === 0 || spokenCharacters >= SPOKEN_MAX_CHARS) continue;
    streamedRaw += `${text} `;
    spokenCharacters += spoken.length + 1;
    parts.push(spoken);
  }
  const text = message?.text;
  if (typeof text === "string") {
    const rest = speakable(
      streamedRaw.length === 0
        ? text
        : unsaidPartOf({ text, spoken: streamedRaw }),
    );
    const room = SPOKEN_MAX_CHARS - spokenCharacters;
    if (rest.length > 0 && room > 0)
      parts.push(rest.slice(0, Math.max(room, 1)));
  }
  return parts.join(" ");
}

const sentencesOf = (text) =>
  text
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 12);

function spokenProblems(stream, spoken) {
  const problems = [];
  if (spoken.trim().length === 0) return ["nothing spoken"];
  // Said more often than the answer has it: a sentence the answer
  // repeats for a different item (one per document) is said each time.
  const tally = (list) => {
    const counts = new Map();
    for (const s of list) counts.set(s, (counts.get(s) ?? 0) + 1);
    return counts;
  };
  const inAnswer = tally(sentencesOf(speakable(stream.message?.text ?? "")));
  for (const [s, count] of tally(sentencesOf(spoken))) {
    if (count > Math.max(inAnswer.get(s) ?? 0, 1))
      problems.push(`said ${String(count)} times: "${s.slice(0, 60)}"`);
  }
  const last = sentencesOf(speakable(stream.message?.text ?? "")).at(-1);
  if (
    last !== undefined &&
    spoken.length < SPOKEN_MAX_CHARS - 40 &&
    !spoken.toLowerCase().includes(last.slice(0, 40))
  )
    problems.push(`last sentence unsaid: "${last.slice(0, 60)}"`);
  return problems;
}

async function proposedOf(runId) {
  return sql(
    `select a.action_type, a.proposed_payload::text as payload
       from q_runtime.actions a where a.run_id = ${quote(runId)}
      order by a.created_at`,
  );
}

async function outcomeProblems(testCase, runId, message) {
  const [kind, target] = testCase.expect.split(" ");
  if (kind === "NAVIGATE") {
    const { navigate } = followOfAnswer(message?.blocks);
    return navigate === target
      ? []
      : [`screen follows ${String(navigate)}, wanted ${target}`];
  }
  if (kind === "CARD") {
    const actions = await proposedOf(runId);
    const card = actions.find((a) =>
      target.endsWith(".")
        ? a.action_type.startsWith(target)
        : a.action_type === target,
    );
    if (card === undefined)
      return [
        `no ${target} card (proposed: ${actions.map((a) => a.action_type).join(", ") || "none"})`,
      ];
    if (testCase.workingHours === true && !/"workingHours"/u.test(card.payload))
      return ["card has no working hours"];
    return [];
  }
  return message === null ? ["no answer"] : [];
}

const tokens = {
  FOUNDER: await signIn(env("EVAL_FOUNDER_EMAIL")),
  INVESTOR: await signIn(env("EVAL_INVESTOR_EMAIL")),
};

let failed = 0;
for (const testCase of cases) {
  const token = tokens[testCase.as];
  const runId = await askAsVoice(token, testCase.text);
  if (runId === null) {
    failed += 1;
    console.log(`FAIL ${testCase.id}: run not created`);
    continue;
  }
  const stream = await streamOf(token, runId);
  const spoken = spokenOf(stream);
  const problems = [
    ...(await outcomeProblems(testCase, runId, stream.message)),
    ...spokenProblems(stream, spoken),
  ];
  if (problems.length > 0) failed += 1;
  console.log(
    `${problems.length === 0 ? "PASS" : "FAIL"} ${testCase.id} run=${runId} deltas=${String(stream.deltas.length)}${problems.length === 0 ? "" : `\n     ${problems.join("\n     ")}`}`,
  );
  console.log(
    `     said: ${spoken.slice(0, 400)}${spoken.length > 400 ? "…" : ""}`,
  );
}
console.log(
  `\n${String(cases.length - failed)}/${String(cases.length)} passed`,
);
process.exit(failed === 0 ? 0 : 1);
