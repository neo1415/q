#!/usr/bin/env node
/* global process, console, fetch, setTimeout */
/**
 * Rehearsal eval, text mode (harden-38). A fictional founder rehearses
 * with a fictional investor played by Q through the same HTTP routes the
 * rehearsal room uses (persona, start, turns, finish), typed instead of
 * spoken: no speech provider is touched. Six founder turns: an opener, a
 * weak answer, a dodge, an interruption (the raised-hand cue, then words),
 * a strong answer and the ask. Then it ends the meeting and reads the
 * review.
 *
 * Judged by records and shapes, never by a model:
 *   persona     the persona loads (never the lobby's "couldn't get ready")
 *               and the investor leads (stance.leads THEM: a founder
 *               pitching is the weaker party)
 *   leverage    the investor asks: most of their lines carry a question,
 *               and none pitch the founder
 *   emotion     mood, intensity or code-tracked temperament moves after
 *               the weak answer
 *   interrupt   a raised hand gets a short yield and no question
 *   walk-out    if they left, two warnings came first
 *   review      not empty, the founder's dimensions only, a code score
 *   transcript  both sides spoke, as many founder lines as were sent
 *   cost        ai_ops.model_usage (purpose REHEARSAL) for this run
 *
 *   node scripts/evals/q-rehearsal/run.mjs --dry-run     # plan and cost only
 *   Q_API=… SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *   SUPABASE_PROJECT=… EVAL_FOUNDER_EMAIL=… CQ_SEED_ACCOUNT_PASSWORD=… \
 *   [EVAL_REHEARSAL_COUNTERPART_ID=<investor organisation id>] \
 *   pnpm q:eval:rehearsal [--difficulty=TOUGH]
 *
 * Fictional accounts only (@fictional.capitalq.local), never the
 * founder's own. Starting uses one rehearsal from the founder's plan.
 */
import { randomUUID } from "node:crypto";

const DRY = process.argv.includes("--dry-run");
const DIFFICULTY =
  process.argv.find((arg) => arg.startsWith("--difficulty="))?.slice(13) ??
  "REALISTIC";
/** Upper bound per model call at today's routing (rehearsal prompts are long). */
const COST_PER_CALL_USD = Number(process.env.COST_PER_CALL_USD ?? "0.03");

/** The founder's side; `kind` says what the turn is testing. */
const SCRIPT = [
  {
    kind: "OPENER",
    text: "Thanks for making the time. We help small businesses get paid faster, and we're raising a seed round to grow from 40 to 200 paying customers this year.",
  },
  {
    kind: "WEAK",
    text: "Honestly, I'm not sure about the numbers. Revenue is, uh, okay I think? We haven't really tracked churn yet.",
  },
  {
    kind: "DODGE",
    text: "That's a great question, but I'd rather talk about the vision. The market is huge and we're going to be everywhere.",
  },
  { kind: "INTERRUPT", cue: "HAND_RAISED" },
  {
    kind: "STRONG",
    text: "Fair challenge, so here are the numbers. Revenue is 18 million naira a month, up 12% month on month for six months. Churn is 3% a month, and 70% of new customers come by referral. We're raising 1.5 million dollars to hire two sales leads and reach 200 customers by the third quarter.",
  },
  {
    kind: "ASK",
    text: "What would you need to see from us to move to a second meeting?",
  },
];
/**
 * Persona (often cached), one line per founder turn (a raised hand is
 * answered by code), the review; the persona read and a retry or two of
 * headroom.
 */
const CALLS =
  1 + SCRIPT.filter((turn) => turn.text !== undefined).length + 1 + 2;

if (DRY) {
  for (const turn of SCRIPT)
    console.log(`${turn.kind.padEnd(10)} ${turn.text ?? `[cue ${turn.cue}]`}`);
  console.log(
    `\n1 rehearsal (${DIFFICULTY}), ${String(SCRIPT.length)} founder turns, ~${String(CALLS)} model calls, <= $${(CALLS * COST_PER_CALL_USD).toFixed(2)}; 1 rehearsal from the founder's plan`,
  );
  process.exit(0);
}

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function qApi(token, method, path, body) {
  const r = await fetch(`${env("Q_API")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name.padEnd(11)} ${detail}`);
};

const FOUNDER_DIMENSIONS = new Set([
  "CLARITY",
  "EVIDENCE",
  "HANDLING_PUSHBACK",
  "FIT_TO_THIS_PERSON",
  "THE_ASK",
]);
/** A line that sells to the founder rather than probing them. */
const PITCHING =
  /\b(?:our fund (?:offers|can give you)|we(?:'d| would) love to invest|let me tell you about our fund|why you should (?:take|choose) our)\b/iu;

const startedAt = new Date(Date.now() - 5_000).toISOString();
const token = await signIn(env("EVAL_FOUNDER_EMAIL"));

// The counterpart: named, or the first investor on the founder's list.
let counterpartId = process.env.EVAL_REHEARSAL_COUNTERPART_ID;
if (counterpartId === undefined || counterpartId.length === 0) {
  const partners = await qApi(token, "GET", "/v1/q/rehearsals/partners");
  const investor = partners.body?.people?.find(
    (person) => person.counterpart.kind === "INVESTOR_ORGANISATION",
  );
  if (investor === undefined) {
    console.log(
      `FAIL setup       no investor to rehearse with (partners ${String(partners.status)}); set EVAL_REHEARSAL_COUNTERPART_ID`,
    );
    process.exit(1);
  }
  counterpartId = investor.counterpart.id;
}

// 1. The lobby's read: the persona loads.
const persona = await qApi(
  token,
  "GET",
  `/v1/q/rehearsals/persona/INVESTOR_ORGANISATION/${counterpartId}`,
);
check(
  "persona",
  persona.status === 200 && typeof persona.body?.summary === "string",
  persona.status === 200
    ? `${persona.body.counterpart.name}: grounding ${persona.body.grounding}, ${String(persona.body.traits.length)} traits`
    : `status ${String(persona.status)}: ${persona.body?.detail ?? ""} (the lobby would say "couldn't get ready")`,
);
if (persona.status === 200) {
  check(
    "leads",
    persona.body.stance.leads === "THEM",
    `stance leads ${persona.body.stance.leads}, ${persona.body.stance.forwardness}`,
  );
}

// 2. Start.
const started = await qApi(token, "POST", "/v1/q/rehearsals", {
  counterpart: { kind: "INVESTOR_ORGANISATION", id: counterpartId },
  difficulty: DIFFICULTY,
});
if (started.status !== 200) {
  check(
    "start",
    false,
    `status ${String(started.status)}: ${started.body?.detail ?? ""}`,
  );
  process.exit(1);
}
const rehearsalId = started.body.id;
console.log(`     rehearsal ${rehearsalId}`);

// 3. The founder's turns.
let walkedOut = false;
let sent = 0;
const afterTurn = [];
for (const turn of SCRIPT) {
  const said = await qApi(
    token,
    "POST",
    `/v1/q/rehearsals/${rehearsalId}/turns`,
    turn.text === undefined ? { cue: turn.cue } : { text: turn.text },
  );
  if (turn.text !== undefined) sent += 1;
  if (said.status === 409) {
    walkedOut = true;
    console.log(`     ${turn.kind}: the meeting had ended`);
    break;
  }
  if (said.status !== 200) {
    check(
      "turn",
      false,
      `${turn.kind}: status ${String(said.status)} ${said.body?.detail ?? ""}`,
    );
    continue;
  }
  const them = said.body.turns.filter((line) => line.from === "THEM").at(-1);
  afterTurn.push({ kind: turn.kind, line: them });
  console.log(
    `     ${turn.kind.padEnd(9)} -> [${them?.mood ?? "-"}/${them?.intensity ?? "-"}] ${(them?.text ?? "").slice(0, 140)}`,
  );
  if (said.body.status === "FINISHED" || said.body.endedAt !== null) {
    walkedOut = said.body.outcome === "LEFT_EARLY";
    break;
  }
}

// 4. End it and read the review (a provisional one is filled in shortly).
let finished = await qApi(
  token,
  "POST",
  `/v1/q/rehearsals/${rehearsalId}/finish`,
);
for (
  let i = 0;
  i < 12 &&
  finished.status === 200 &&
  finished.body.review?.provisional === true;
  i++
) {
  await sleep(5_000);
  finished = await qApi(token, "GET", `/v1/q/rehearsals/${rehearsalId}`);
}
const dto = finished.body;

// The stored row: temperament and warnings are kept there, not in the DTO.
const row = (
  await sql(
    `select user_id, turns::text as turns, outcome from q_runtime.rehearsals where id = ${quote(rehearsalId)}`,
  )
)[0];
const stored = row === undefined ? [] : JSON.parse(row.turns);
const theirs = stored.filter((turn) => turn.from === "THEM");

// Leverage: the investor probes, and never sells to the founder. The
// yield to a raised hand is code's, and asks nothing by design.
const yieldedAt = afterTurn.find((t) => t.kind === "INTERRUPT")?.line?.at;
const probing = theirs.filter((turn) => turn.at !== yieldedAt);
const questions = probing.filter((turn) => turn.text.includes("?")).length;
const pitched = probing.filter((turn) => PITCHING.test(turn.text));
check(
  "leverage",
  probing.length > 0 && questions * 2 >= probing.length && pitched.length === 0,
  `${String(questions)}/${String(probing.length)} of their lines ask${pitched.length > 0 ? `; pitched: "${pitched[0].text.slice(0, 80)}"` : ""}`,
);

// Emotion: the reaction to the weak answer differs from the opener's.
const opener = afterTurn.find((t) => t.kind === "OPENER")?.line;
const weak = afterTurn.find((t) => t.kind === "WEAK")?.line;
const stateOf = (line) =>
  stored.find((turn) => turn.from === "THEM" && turn.at === line?.at)?.state;
const before = stateOf(opener);
const after = stateOf(weak);
const moved =
  opener !== undefined &&
  weak !== undefined &&
  (opener.mood !== weak.mood ||
    opener.intensity !== weak.intensity ||
    (before !== undefined &&
      after !== undefined &&
      (after.patience < before.patience ||
        after.warmth < before.warmth ||
        after.frustration > before.frustration)));
check(
  "emotion",
  moved,
  `opener ${opener?.mood ?? "-"}/${opener?.intensity ?? "-"} ${JSON.stringify(before ?? {})} -> weak ${weak?.mood ?? "-"}/${weak?.intensity ?? "-"} ${JSON.stringify(after ?? {})}`,
);

// Interruption: a short yield that asks nothing.
const yielded = afterTurn.find((t) => t.kind === "INTERRUPT")?.line;
check(
  "interrupt",
  walkedOut ||
    (yielded !== undefined &&
      !yielded.text.includes("?") &&
      yielded.text.split(/\s+/u).length <= 12),
  yielded === undefined ? "no line after the raised hand" : `"${yielded.text}"`,
);

// Walk-out: warned twice first.
const warnings = theirs.filter((turn) => turn.warning !== undefined);
const left = (row?.outcome ?? dto?.outcome) === "LEFT_EARLY" && walkedOut;
check(
  "walk-out",
  !left || warnings.length >= 2,
  left
    ? `left after ${String(warnings.length)} warning(s)`
    : `stayed (${String(warnings.length)} warning(s); outcome ${String(dto?.outcome ?? row?.outcome)})`,
);

// Review: the founder's, scored by code.
const review = dto?.review ?? null;
const dimensions = review?.dimensions ?? [];
const foreign = dimensions.filter((d) => !FOUNDER_DIMENSIONS.has(d.name));
check(
  "review",
  review !== null &&
    review.provisional !== true &&
    review.overall.length > 0 &&
    dimensions.length > 0 &&
    foreign.length === 0 &&
    review.score !== null,
  review === null
    ? `no review (finish ${String(finished.status)})`
    : `score ${String(review.score)}, ${dimensions.map((d) => `${d.name}:${d.rating}`).join(" ")}${foreign.length > 0 ? `; not the founder's: ${foreign.map((d) => d.name).join(",")}` : ""}${review.provisional === true ? "; still provisional" : ""}`,
);

// Transcript: both sides, every line sent kept.
const yours = (dto?.turns ?? []).filter((turn) => turn.from === "YOU").length;
check(
  "transcript",
  yours === sent && (dto?.turns ?? []).some((turn) => turn.from === "THEM"),
  `${String(yours)}/${String(sent)} founder lines, ${String(theirs.length)} of theirs`,
);

// Cost: this founder's rehearsal model calls since the eval began.
const cost =
  row === undefined
    ? undefined
    : (
        await sql(
          `select count(*)::int as calls, round(coalesce(sum(cost_usd), 0), 4)::text as usd,
                  count(*) filter (where cost_usd is null)::int as unpriced
             from ai_ops.model_usage
            where user_id = ${quote(row.user_id)} and purpose = 'REHEARSAL'
              and created_at >= ${quote(startedAt)}`,
        )
      )[0];
console.log(
  `     cost: ${cost === undefined ? "unknown" : `$${cost.usd} over ${String(cost.calls)} calls${cost.unpriced > 0 ? ` (${String(cost.unpriced)} unpriced)` : ""}`}`,
);

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n${String(results.length - failed)}/${String(results.length)} checks passed`,
);
process.exit(failed === 0 ? 0 : 1);
