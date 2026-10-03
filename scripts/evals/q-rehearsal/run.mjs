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
 *   emotion     the weak answer costs: frustration up or patience down
 *               by at least 5 in code's own state
 *   strong      a strong answer that answers their open question (chosen
 *               from the claims by its topic): never ANGRY or RAISED, no
 *               warning, never read as a dodge
 *   asking      their closing ask (next steps): never ANGRY or RAISED, no warning
 *   first-dodge a first dodge: never ANGRY or RAISED, no warning
 *   warning-once "Last chance" at most once in a line
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

/**
 * The founder's answers, by topic: Ajopot's seeded deck claims
 * (scripts/seed/narrated-deck-scripts.json) and, where the deck says
 * nothing, the eval founder's own fictional figures for this fictional
 * company -- said as the founder's claims, never platform data.
 */
const CLAIMS = [
  {
    topic: /\b(complet|default|repay|arrear|missed)/iu,
    says: "Ninety-four percent of circles that started in the last twelve months completed, and the default rate on contributions is one point eight percent, because contributions are auto-debited and members carry a reliability score.",
  },
  {
    topic: /\b(retention|retain|churn|come back|return)/iu,
    says: "Monthly retention is seventy-one percent after three months and sixty-three percent after six; most members who leave do so when a circle completes, and forty percent of them join a new circle within a month.",
  },
  {
    topic:
      /\b(before|previously|informal|who (?:is|are) using|switch|repeatable|demand)/iu,
    says: "About eighty percent of our active members ran ajo informally before, mostly through a market or church organiser; they move because the payout order is fixed and funds sit at a licensed partner bank.",
  },
  {
    topic: /\b(frequency|how often|contribut)/iu,
    says: "Members contribute weekly in sixty percent of circles and monthly in the rest, and ninety-six percent of scheduled contributions clear on the first debit attempt.",
  },
  {
    topic: /\b(revenue|fee|monetis|make money|unit economics|margin)/iu,
    says: "We charge one percent on each payout today; small loans against circle history come next.",
  },
  {
    topic: /\b(users?|actives?|traction|growth|scale)/iu,
    says: "We have fifty-two thousand registered users in thirty-nine hundred circles, and monthly actives grew from forty-two hundred last September to eighteen thousand seven hundred in March.",
  },
  {
    topic: /\b(raise|raising|round|use of funds|valuation|terms)/iu,
    says: "We're raising one point two billion naira on a SAFE to open Abuja and Port Harcourt and start small loans against circle history.",
  },
];
const STRONG_FALLBACK = `Fair challenge, so here are the numbers. ${CLAIMS[0]?.says ?? ""} ${CLAIMS[1]?.says ?? ""}`;

/** A strong answer to the question they have open: the claims it asks about. */
function strongLineFor(question) {
  const fits = CLAIMS.filter((claim) => claim.topic.test(question ?? "")).slice(
    0,
    3,
  );
  return {
    fits: fits.length,
    text:
      fits.length === 0
        ? STRONG_FALLBACK
        : `Fair challenge, so here are the numbers. ${fits.map((claim) => claim.says).join(" ")}`,
  };
}

/**
 * The founder's side, from the seeded founder's own material (Ajopot's
 * deck, scripts/seed/narrated-deck-scripts.json): their claims, so the
 * investor's questions meet real answers. `kind` says what the turn tests.
 */
const SCRIPT = [
  {
    kind: "OPENER",
    text: "Thanks for making the time. Ajopot digitises ajo, the rotating savings circle. Members' funds sit at a licensed partner bank, contributions are auto-debited, and every member carries a reliability score.",
  },
  {
    kind: "WEAK",
    text: "Honestly, I'm not sure about the numbers. Defaults are, uh, fine I think? We haven't really tracked repayment by circle yet.",
  },
  {
    kind: "DODGE",
    text: "That's a great question, but I'd rather talk about the vision. Everyone in Nigeria saves in ajo, and we're going to be everywhere.",
  },
  { kind: "INTERRUPT", cue: "HAND_RAISED" },
  {
    kind: "STRONG",
    // Written when it is sent, to answer the question the investor has
    // open (strongLineFor): user counts are no answer to a question about
    // defaults (QA e9a1eee7, where the investor was right).
    text: STRONG_FALLBACK,
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
  // A query error is said, never read as "no rows" (the cost query once
  // named a column that does not exist and reported nothing).
  if (!r.ok || !Array.isArray(rows)) {
    console.log(
      `     sql ${String(r.status)}: ${JSON.stringify(rows).slice(0, 200)}`,
    );
    return [];
  }
  return rows;
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
// They closed it before the founder's script ran out (their own CLOSE
// sets endedAt); the founder's finish afterwards is not them leaving.
let endedByThem = false;
let sent = 0;
const afterTurn = [];
let strongFits = 0;
for (const turn of SCRIPT) {
  // The strong answer answers what they asked last (past code's yield).
  let text = turn.text;
  if (turn.kind === "STRONG") {
    const asked = afterTurn.filter((t) => t.kind !== "INTERRUPT").at(-1)
      ?.line?.text;
    const strong = strongLineFor(asked);
    strongFits = strong.fits;
    text = strong.text;
    console.log(
      `     STRONG    <- answers ${String(strong.fits)} topic(s) of: ${(asked ?? "").slice(0, 120)}`,
    );
  }
  const said = await qApi(
    token,
    "POST",
    `/v1/q/rehearsals/${rehearsalId}/turns`,
    text === undefined ? { cue: turn.cue } : { text },
  );
  if (turn.text !== undefined) sent += 1;
  if (said.status === 409) {
    endedByThem = true;
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
    endedByThem = true;
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
// The weak answer costs a real amount (QA 512b431a: frustration fell
// 29 -> 23 and patience only 2, and "something moved" passed): code's
// own state, frustration up or patience down by at least COST.
const COST = 5;
const moved =
  before !== undefined &&
  after !== undefined &&
  (after.frustration - before.frustration >= COST ||
    before.patience - after.patience >= COST) &&
  after.frustration >= before.frustration;
check(
  "emotion",
  moved,
  `opener ${opener?.mood ?? "-"}/${opener?.intensity ?? "-"} ${JSON.stringify(before ?? {})} -> weak ${weak?.mood ?? "-"}/${weak?.intensity ?? "-"} ${JSON.stringify(after ?? {})}`,
);

// A responsive strong answer never escalates and is never a dodge
// (QA e9a1eee7: user counts to a question about defaults was one).
const strongLine = afterTurn.find((t) => t.kind === "STRONG")?.line;
const strongStored = stored.find(
  (turn) => turn.from === "THEM" && turn.at === strongLine?.at,
);
check(
  "strong",
  endedByThem ||
    strongFits === 0 ||
    (strongLine !== undefined &&
      strongLine.mood !== "ANGRY" &&
      strongLine.intensity !== "RAISED" &&
      strongStored?.warning === undefined &&
      strongStored?.category !== "DODGE"),
  strongFits === 0
    ? "skipped: no claim fits their open question"
    : strongLine === undefined
      ? "no line after the strong answer"
      : `[${strongLine.mood ?? "-"}/${strongLine.intensity ?? "-"}] ${String(strongStored?.category ?? "-")} -> ${String(strongStored?.register ?? "-")}, warning ${String(strongStored?.warning ?? "none")}`,
);

// Their closing ask is never provocation (QA 512b431a, d7ef826e): never
// ANGRY, never RAISED, never a warning.
const askLine = afterTurn.find((t) => t.kind === "ASK")?.line;
const askStored = stored.find(
  (turn) => turn.from === "THEM" && turn.at === askLine?.at,
);
check(
  "asking",
  endedByThem ||
    (askLine !== undefined &&
      askLine.mood !== "ANGRY" &&
      askLine.intensity !== "RAISED" &&
      askStored?.warning === undefined),
  askLine === undefined
    ? "no line after the ask"
    : `[${askLine.mood ?? "-"}/${askLine.intensity ?? "-"}] warning ${String(askStored?.warning ?? "none")}`,
);

// A first dodge is impatience, never anger and never a warning (d7ef826e).
const dodgeLine = afterTurn.find((t) => t.kind === "DODGE")?.line;
const dodgeStored = stored.find(
  (turn) => turn.from === "THEM" && turn.at === dodgeLine?.at,
);
const dodgesBefore = stored.filter(
  (turn) =>
    turn.from === "THEM" &&
    turn.category === "DODGE" &&
    dodgeStored !== undefined &&
    turn.at < dodgeStored.at,
).length;
check(
  "first-dodge",
  dodgeLine === undefined ||
    dodgesBefore > 0 ||
    (dodgeLine.mood !== "ANGRY" &&
      dodgeLine.intensity !== "RAISED" &&
      dodgeStored?.warning === undefined),
  dodgeLine === undefined
    ? "no line after the dodge"
    : `[${dodgeLine.mood ?? "-"}/${dodgeLine.intensity ?? "-"}] warning ${String(dodgeStored?.warning ?? "none")}${dodgesBefore > 0 ? ` (${String(dodgesBefore)} dodge(s) before)` : ""}`,
);

// "Last chance" is said at most once in any line.
const doubled = theirs.filter(
  (turn) => (turn.text.match(/last chance/giu) ?? []).length > 1,
);
check(
  "warning-once",
  doubled.length === 0,
  doubled.length === 0
    ? "each warning said once"
    : `"${doubled[0].text.slice(0, 80)}"`,
);

// Interruption: a short yield that asks nothing.
const yielded = afterTurn.find((t) => t.kind === "INTERRUPT")?.line;
check(
  "interrupt",
  endedByThem ||
    (yielded !== undefined &&
      !yielded.text.includes("?") &&
      yielded.text.split(/\s+/u).length <= 12),
  yielded === undefined ? "no line after the raised hand" : `"${yielded.text}"`,
);

// Walk-out: warned twice first.
const warnings = theirs.filter((turn) => turn.warning !== undefined);
const outcome = row?.outcome ?? dto?.outcome ?? null;
// Leaving is their close before the script ran out with a no or a
// walk-out; the founder's own finish writes FOUNDER_ENDED (LEFT_EARLY on
// deploys before 20261128090000), which is the
// founder ending it, not the investor leaving.
const left =
  endedByThem && (outcome === "LEFT_EARLY" || outcome === "DECLINED");
check(
  "walk-out",
  !left || warnings.length >= 2,
  left
    ? `they left (${String(outcome)}) after ${String(warnings.length)} warning(s); two are required`
    : `${endedByThem ? "they closed" : "the founder ended it"} (${String(warnings.length)} warning(s); outcome ${String(outcome)})`,
);

// Ending: the founder's own finish is recorded as theirs (20261128090000).
check(
  "ending",
  endedByThem || outcome === "FOUNDER_ENDED",
  `outcome ${String(outcome)}${endedByThem ? " (they closed it)" : ""}`,
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
              and occurred_at >= ${quote(startedAt)}`,
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
