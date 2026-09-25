import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  HomeQ,
  Interview,
  signIn,
  signUp,
  type Person,
} from "./support/api.js";
import {
  answers,
  artifactsFor,
  closeDb,
  lastQStep,
  openSteps,
  unfinishedSteps,
  mandateFor,
  read,
  runsFor,
} from "./support/db.js";
import {
  ACCEPTANCES,
  ADVISORY,
  CORRECTIONS,
  EXCLUSIONS,
  IMPERATIVES,
  INVESTOR_SETUP,
  MEMORY,
  MOVER,
  MULTI_INTENT,
  OBLIQUE,
  TANGENTS,
  type Expect,
} from "./support/paraphrases.js";
import * as ui from "./support/ui.js";

/**
 * Product PROPERTIES at the API level: the same HTTP surfaces the web app
 * calls, as a real synthetic person. Each paraphrase is its own test so the
 * baseline reads as "k of n phrasings hold". Assertions are on the recorded
 * answer, the database, and tool effects; Q's prose is never compared,
 * except where a loose topic oracle is named and marked as such.
 *
 * A failure message names the missing CAPABILITY, not the sentence.
 */

test.afterAll(closeDb);
test.describe.configure({ timeout: 900_000 });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let counter = 0;
async function investor(label: string): Promise<Person> {
  counter += 1;
  return signUp({
    name: `Acc ${label} ${counter}`,
    organisation: "Harrow Road Capital",
    label,
  });
}

function mismatch(recorded: Map<string, string[]>, e: Expect): string | null {
  const values = (recorded.get(e.step) ?? []).map((v) => v.toLowerCase());
  // Codes and amounts match exactly ("pre_seed" is not "seed"); only free
  // text (a firm name recorded inside a longer answer) matches by inclusion.
  const has = (want: string) => {
    const w = want.toLowerCase();
    return values.some((v) => v === w || (/\s/.test(w) && v.includes(w)));
  };
  if (e.anyOf !== undefined && !e.anyOf.some(has)) {
    return `${e.step}: expected one of [${e.anyOf.join(", ")}], recorded [${values.join(", ")}]`;
  }
  const bad = (e.noneOf ?? []).filter(has);
  if (bad.length > 0) {
    return `${e.step}: must not hold [${bad.join(", ")}], recorded [${values.join(", ")}]`;
  }
  return null;
}

/**
 * Recorded-state mismatches, plus (lead decision 2026-09-25) an explicit
 * value that was not read back in Q's reply for that turn. The recorded
 * value is the authoritative check; the read-back is the loose one.
 */
function judge(
  recorded: Map<string, string[]>,
  expected: readonly Expect[],
  reply: string | null,
): string[] {
  const said = (reply ?? "").toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  const failures: string[] = [];
  for (const e of expected) {
    const miss = mismatch(recorded, e);
    if (miss !== null) failures.push(miss);
    if (
      e.readBack !== undefined &&
      !e.readBack.some((form) => said.includes(form))
    ) {
      failures.push(`${e.step}: not read back in Q's reply`);
    }
  }
  return failures;
}

function snapshot(map: Map<string, string[]>): Record<string, string> {
  return Object.fromEntries(
    [...map].map(([k, v]) => [k, [...v].sort().join("|")]),
  );
}

function note(type: string, description: string): void {
  // The tail: where a long transcript went wrong is at its end.
  test.info().annotations.push({ type, description: description.slice(-4000) });
}

function transcript(interview: Interview): string {
  return interview.turns
    .map(
      (t) =>
        `> ${t.said}\n< [${t.stepAfter ?? "-"}] ${t.reply ?? "(no reply)"}`,
    )
    .join("\n");
}

async function start(label: string): Promise<Interview> {
  const person = await investor(label);
  return Interview.start(person, "investor");
}

async function setup(
  interview: Interview,
  lines: readonly string[],
): Promise<void> {
  for (const line of lines) await interview.say(line);
}

function currentStep(interview: Interview): string | null {
  return interview.turns.at(-1)?.stepAfter ?? null;
}

/**
 * The step Q is actually asking: its latest persisted turn's step. The
 * session view's current step can point elsewhere (baseline finding:
 * cursor on I0.organisation_name while Q asks stages or confirms a
 * cheque), so a fixture answer keyed on the cursor answers the wrong
 * question.
 */
async function askedStep(interview: Interview): Promise<string | null> {
  return (await lastQStep(interview.sessionId)) ?? currentStep(interview);
}

function done(interview: Interview): boolean {
  const last = interview.turns.at(-1);
  return last === undefined
    ? false
    : last.status === "COMPLETED" || last.stepAfter === null;
}

/**
 * The mover is a fixture DRIVER: it only walks the interview to the state a
 * property needs, and no property is judged through its turns.
 *
 * It works from RECORDED STATE, not from what Q happens to be asking. Until
 * the turn response exposes Q's `asking` (approved, E3 owns it), neither
 * the session cursor nor a persisted turn's step says what Q asked. On the
 * tool-calling loop Q picks the question itself, and it can record an
 * answer to any step in any turn. So the mover acts like a person working
 * through their own list: it volunteers the first step that is neither
 * completed nor skipped, and it answers a plain confirmation question
 * ("Is that right?", "Does it look right?") with a yes.
 */
function moverAnswer(next: string, lastReply: string): string {
  if (
    /\b(is that right|does (that|this|it) look right|is that correct)\?\s*$/i.test(
      lastReply.trim(),
    )
  )
    return "yes, that's right";
  return MOVER[next] ?? "skip that one";
}

/**
 * Walk the interview with plain answers until `stop` holds or it completes.
 * A stall is the same next step with nothing new recorded four turns
 * running; that is a capability failure (the plain answer is not taken).
 */
async function move(
  interview: Interview,
  options: { stop?: (step: string) => boolean; maxTurns?: number } = {},
): Promise<void> {
  let same = 0;
  let previous: string | null = null;
  let recordedBefore = -1;
  // An OPTIONAL step Q leaves open after the person declines it is
  // legitimately unknown ("I'll leave sectors-to-avoid blank"), so after one
  // attempt the mover moves on. Only a REQUIRED step can stall.
  const attempts = new Map<string, number>();
  const leftOpen = new Set<string>();
  for (let i = 0; i < (options.maxTurns ?? 40); i += 1) {
    if (done(interview)) return;
    const open = (await openSteps(interview.sessionId)).filter(
      (s) => !leftOpen.has(s.step),
    );
    const next = open[0] ?? null;
    if (next === null) return;
    if (options.stop?.(next.step) === true) return;
    const recordedNow = (await answers(interview.sessionId)).size;
    same =
      next.step === previous && recordedNow === recordedBefore ? same + 1 : 0;
    previous = next.step;
    recordedBefore = recordedNow;
    const tried = (attempts.get(next.step) ?? 0) + 1;
    attempts.set(next.step, tried);
    if (!next.required && tried > 1) {
      leftOpen.add(next.step);
      note("optional step left open", next.step);
      continue;
    }
    if (same >= 3) {
      note("transcript", transcript(interview));
      throw new Error(
        `CAPABILITY: take a plain answer — required ${next.step} still open after four turns answering it`,
      );
    }
    await interview.say(moverAnswer(next.step, interview.lastReply));
  }
}

/**
 * The step Q was on before the turn under test, when Q was holding a value
 * there for confirmation (asked, not recorded). Structural, not wording.
 * The property is judged on the turn as the person said it: a pending
 * confirmation must not block a correction or answer to another fact, so
 * the test never answers the confirmation first.
 */
// Facts the setup turns state. When Q is asking one of these after the
// person has already said it, and it is not recorded, Q heard it and is
// holding it for confirmation (held values live in Q's turn state, not
// in the database, so this is the observable form).
const SETUP_FACT_STEPS = new Set([
  "I0.investor_type",
  "I0.organisation_name",
  "I2.cheque_min",
  "I2.cheque_max",
  "I2.currency",
  "I2.stages",
  "I3.geography",
  "I3.sectors",
]);

async function pendingConfirmation(
  interview: Interview,
  stated: ReadonlySet<string> = SETUP_FACT_STEPS,
): Promise<string | null> {
  const step = await askedStep(interview);
  if (step === null || !stated.has(step)) return null;
  const recorded = await answers(interview.sessionId);
  return recorded.has(step) ? null : step;
}

function capability(
  base: string,
  pending: string | null,
  failures: readonly unknown[],
): string {
  return failures.length > 0 && pending !== null
    ? `CAPABILITY: pending confirmation blocks other facts in the same turn (held ${pending}); ${base}`
    : `CAPABILITY: ${base}`;
}

// ---------------------------------------------------------------------------
// P1 — explicit corrections update the intended fact
// ---------------------------------------------------------------------------

test.describe("P1 corrections update the intended fact", () => {
  for (const c of CORRECTIONS) {
    test(c.id, async () => {
      const interview = await start(`p1-${c.id}`);
      await setup(interview, INVESTOR_SETUP);
      const pending = await pendingConfirmation(interview);
      const said = await interview.say(c.correction);
      const recorded = await answers(interview.sessionId);
      note("transcript", transcript(interview));
      const failures = judge(recorded, c.expect, said.reply);
      expect(
        failures,
        capability(
          "apply an explicit correction to the fact it names",
          pending,
          failures,
        ),
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// P2 — question + answer + correction in one turn, all handled
// ---------------------------------------------------------------------------

test.describe("P2 one turn: question + answer + correction", () => {
  for (const c of MULTI_INTENT) {
    test(c.id, async () => {
      const interview = await start(`p2-${c.id}`);
      await setup(interview, c.setup);
      const pending = await pendingConfirmation(interview);
      const turn = await interview.say(c.turn);
      const recorded = await answers(interview.sessionId);
      note("transcript", transcript(interview));
      const failures = judge(recorded, c.expect, turn.reply);
      expect
        .soft(
          failures,
          capability(
            "act on every intent in a multi-intent turn (answer + correction)",
            pending,
            failures,
          ),
        )
        .toEqual([]);
      // Loose oracle (not prose equality): the reply engages the question.
      const reply = (turn.reply ?? "").toLowerCase();
      expect
        .soft(
          c.topic.some((t) => reply.includes(t)),
          `CAPABILITY: answer the question carried in a multi-intent turn; reply: ${turn.reply}`,
        )
        .toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// P3 — accepting Q's proposal authorises it; the write exists
// ---------------------------------------------------------------------------

const EXCLUSION_STEPS = [
  "I7.avoid",
  "I7.hard_exclusions",
  "I7.sector_exclusions",
];

function exclusionCodes(recorded: Map<string, string[]>): string[] {
  return [
    ...new Set(
      EXCLUSION_STEPS.flatMap((s) => recorded.get(s) ?? []).filter(
        (v) => !/^(none|nothing)/i.test(v),
      ),
    ),
  ];
}

test.describe("P3 acceptance of Q's recommendation authorises the write", () => {
  for (const c of ACCEPTANCES) {
    test(c.id, async () => {
      const interview = await start(`p3-${c.id}`);
      await setup(interview, [
        ...INVESTOR_SETUP,
        "pre-seed and seed, Nigeria and Ghana, fintech mostly",
      ]);
      const before = await answers(interview.sessionId);
      await interview.say(c.ask);
      if (c.accept.length > 0) await interview.say(c.accept);
      const recorded = await answers(interview.sessionId);
      note("transcript", transcript(interview));
      if (c.kind === "typical-cheque") {
        const typical = Number((recorded.get("I2.cheque_typical") ?? [])[0]);
        expect(
          Number.isFinite(typical) && typical > 0,
          "CAPABILITY: treat acceptance of Q's proposed typical cheque as authorising it (no typical cheque recorded)",
        ).toBe(true);
        const min = Number((recorded.get("I2.cheque_min") ?? ["0"])[0]);
        const max = Number((recorded.get("I2.cheque_max") ?? ["Infinity"])[0]);
        expect(
          typical,
          "typical cheque outside the stated range",
        ).toBeGreaterThanOrEqual(min);
        expect(
          typical,
          "typical cheque outside the stated range",
        ).toBeLessThanOrEqual(max);
      } else {
        const added = exclusionCodes(recorded).filter(
          (code) => !exclusionCodes(before).includes(code),
        );
        const minimum = c.id === "exclusions-directive" ? 3 : 1;
        expect(
          added.length,
          `CAPABILITY: record the exclusions Q proposed once the person accepts or delegates (recorded: ${added.join(", ") || "none"})`,
        ).toBeGreaterThanOrEqual(minimum);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// P4 — a persisted exclusion is never re-asked; the interview completes
// ---------------------------------------------------------------------------

test.describe("P4 persisted exclusions are not re-asked; mandate-ready settles", () => {
  for (const c of EXCLUSIONS) {
    test(c.id, async () => {
      const interview = await start(`p4-${c.id}`);
      await setup(interview, INVESTOR_SETUP);
      if (c.when === "early") await interview.say(c.say);
      else {
        // "At the exclusion question": the first open step is an exclusion
        // step (recorded state; Q's own `asking` is not exposed yet).
        await move(interview, {
          stop: (s) => s.startsWith("I7."),
          maxTurns: 70,
        });
        // The mover stops at the first open exclusion step once the optional
        // steps it declined are set aside; an exclusion step must be open.
        expect(
          (await unfinishedSteps(interview.sessionId)).filter((s) =>
            s.startsWith("I7."),
          ),
          "CAPABILITY: reach the exclusion question",
        ).not.toEqual([]);
        await interview.say(c.say);
      }
      await move(interview, { maxTurns: 70 });
      note("transcript", transcript(interview));

      const persisted = await read<{ at: string }>(
        `select min(created_at)::text at from onboarding.responses
          where session_id = $1 and step_key like 'I7.%'
            and response_jsonb::text like '%' || $2 || '%'`,
        [interview.sessionId, c.code],
      );
      const at = persisted[0]?.at ?? null;
      expect(
        at,
        `CAPABILITY: record "${c.code}" as an exclusion from the person's phrasing`,
      ).not.toBeNull();
      // Re-asks and handoff repeats are read from the step key on Q's
      // persisted turns. On the tool-calling loop that key is the session
      // cursor, not what Q asked, so until the turn response carries Q's
      // `asking` these are REPORTED, not asserted. Loops are still caught
      // by the mover's stall check and by the completion assertion below.
      if (at !== null) {
        const reasked = await read<{ step_key: string; text: string }>(
          `select step_key, left(text, 160) text from onboarding.interview_turns
            where session_id = $1 and role = 'Q' and step_key like 'I7.%'
              and created_at > $2::timestamptz + interval '1 second'
            order by created_at`,
          [interview.sessionId, at],
        );
        note(
          "exclusion-step turns after persistence (cursor-keyed, unasserted)",
          reasked.map((r) => `${r.step_key}: ${r.text}`).join("\n") || "none",
        );
      }
      const handoffAsks = await read<{ n: string }>(
        `select count(*)::text n from onboarding.interview_turns
          where session_id = $1 and role = 'Q' and step_key = 'I12.handoff'`,
        [interview.sessionId],
      );
      note(
        "handoff-keyed Q turns (cursor-keyed, unasserted)",
        handoffAsks[0]?.n ?? "0",
      );
      expect
        .soft(
          done(interview),
          "CAPABILITY: complete the interview with plain answers",
        )
        .toBe(true);
      const mandate = await mandateFor(interview.who.email);
      expect
        .soft(
          mandate.exclusions.join(" ").includes(c.code) ||
            JSON.stringify(mandate.constraints).includes(c.code),
          `CAPABILITY: carry the exclusion into the authoritative mandate (mandate ${mandate.status ?? "none"}: ${mandate.exclusions.join(", ")})`,
        )
        .toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// P5 — advisory questions never become declared preferences
// ---------------------------------------------------------------------------

test.describe("P5 advisory questions do not become preferences", () => {
  for (const c of ADVISORY) {
    test(c.id, async () => {
      const interview = await start(`p5-${c.id}`);
      await setup(interview, INVESTOR_SETUP);
      const before = snapshot(await answers(interview.sessionId));
      const turn = await interview.say(c.say);
      const after = snapshot(await answers(interview.sessionId));
      note("transcript", transcript(interview));
      const changed = Object.keys({ ...before, ...after }).filter(
        (k) => before[k] !== after[k],
      );
      expect(
        changed.map((k) => `${k}: ${before[k] ?? "-"} -> ${after[k] ?? "-"}`),
        "CAPABILITY: tell an advisory question from a declaration (a preference was recorded)",
      ).toEqual([]);
      expect
        .soft(
          (turn.reply ?? "").length,
          "Q said nothing to an advisory question",
        )
        .toBeGreaterThan(20);
    });
  }
});

// ---------------------------------------------------------------------------
// P7 — leaving onboarding and returning coherently
// ---------------------------------------------------------------------------

test.describe("P7 leave onboarding and return", () => {
  for (const c of TANGENTS) {
    test(c.id, async () => {
      const interview = await start(`p7-${c.id}`);
      await setup(interview, INVESTOR_SETUP);
      const pending = await askedStep(interview);
      expect(pending, "no pending question to return to").not.toBeNull();
      const before = snapshot(await answers(interview.sessionId));
      const tangent = await interview.say(c.say);
      const during = snapshot(await answers(interview.sessionId));
      expect
        .soft(
          Object.keys(during).filter((k) => before[k] !== during[k]),
          "CAPABILITY: a tangent records nothing",
        )
        .toEqual([]);
      expect
        .soft((tangent.reply ?? "").length, "CAPABILITY: engage the tangent")
        .toBeGreaterThan(20);
      const resumeStep = (await askedStep(interview)) ?? pending ?? "";
      await interview.say(MOVER[resumeStep] ?? "skip that one");
      const after = await answers(interview.sessionId);
      note("transcript", transcript(interview));
      expect(
        after.has(resumeStep),
        `CAPABILITY: return to the pending question after a tangent (${resumeStep} not recorded)`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// P8 — unknown phrasing is interpreted by the model
// ---------------------------------------------------------------------------

test.describe("P8 oblique phrasing is interpreted, not matched", () => {
  for (const c of OBLIQUE) {
    test(c.id, async () => {
      const interview = await start(`p8-${c.id}`);
      await interview.say("I'm an investor, firm is Harrow Road Capital");
      // Before the turn Q is asking some other, unanswered step: if the fact
      // is then not recorded, the likely mode is a step-order gate (Q heard
      // it and holds it until earlier steps are answered) rather than a
      // failure to interpret. Structural label only; the assertion is the
      // recorded value either way.
      const asking = await askedStep(interview);
      const gate =
        asking !== null &&
        !c.expect.some((e) => e.step === asking) &&
        !(await answers(interview.sessionId)).has(asking)
          ? asking
          : null;
      const said = await interview.say(c.say);
      const recorded = await answers(interview.sessionId);
      note("transcript", transcript(interview));
      const failures = judge(recorded, c.expect, said.reply);
      expect(
        failures,
        failures.length > 0 && gate !== null
          ? `CAPABILITY: record a fact stated before earlier steps are answered (Q was asking ${gate}); interpret phrasing no list anticipates`
          : "CAPABILITY: interpret phrasing no list anticipates",
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Directive D1 — "What do you know about me so far?" (interview)
// ---------------------------------------------------------------------------

test.describe("directive: interview synthesis", () => {
  test("D1 what do you know about me — a synthesis, not a count", async () => {
    const interview = await start("d1");
    await setup(interview, INVESTOR_SETUP);
    const before = snapshot(await answers(interview.sessionId));
    const turn = await interview.say("What do you know about me so far?");
    const after = snapshot(await answers(interview.sessionId));
    const reply = turn.reply ?? "";
    note("transcript", transcript(interview));
    const facts = [
      "harrow road",
      "angel",
      "seed",
      "25",
      "100",
      "dollar",
      "usd",
    ].filter((f) => reply.toLowerCase().includes(f));
    expect
      .soft(
        facts.length,
        `CAPABILITY: synthesise recorded facts in conversation; reply: ${reply}`,
      )
      .toBeGreaterThanOrEqual(2);
    expect
      .soft(
        /\b\d+\s+answers?\b/i.test(reply),
        "CAPABILITY: synthesis instead of a field count",
      )
      .toBe(false);
    expect
      .soft(after, "a question about me recorded an answer")
      .toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Home Q — one completed investor, shared by the Home properties
// ---------------------------------------------------------------------------

const HOME_STATE = fileURLToPath(
  new URL(
    "../../.playwright/acceptance-product/home-investor.json",
    import.meta.url,
  ),
);
const HOME_REUSE_MS = 4 * 60 * 60 * 1000;

function rememberedHomeInvestor(): string | null {
  try {
    if (Date.now() - statSync(HOME_STATE).mtimeMs > HOME_REUSE_MS) return null;
    const saved = JSON.parse(readFileSync(HOME_STATE, "utf8")) as {
      email?: unknown;
    };
    return typeof saved.email === "string" ? saved.email : null;
  } catch {
    return null;
  }
}

function rememberHomeInvestor(email: string): void {
  mkdirSync(dirname(HOME_STATE), { recursive: true });
  writeFileSync(HOME_STATE, JSON.stringify({ email }));
}

test.describe("interview completion", () => {
  test("plain answers complete the interview into an ACTIVE mandate", async () => {
    const interview = await start("complete");
    await setup(interview, INVESTOR_SETUP);
    await move(interview, { maxTurns: 70 });
    note("transcript", transcript(interview));
    const mandate = await mandateFor(interview.who.email);
    // Two separate outcomes: the mandate is confirmed (ACTIVE), and the
    // onboarding session itself is marked complete. Returning-person
    // routing and "who am I" read the session, so both matter.
    expect
      .soft(mandate.status, "CAPABILITY: completion yields an ACTIVE mandate")
      .toBe("ACTIVE");
    expect(
      done(interview),
      mandate.status === "ACTIVE"
        ? "CAPABILITY: mark the onboarding session completed once the mandate is confirmed (mandate ACTIVE, session still open)"
        : "CAPABILITY: complete the interview with plain answers",
    ).toBe(true);
  });
});

test.describe("Home Q (completed investor)", () => {
  let person: Person | null = null;

  // The Home properties need a completed investor regardless of whether the
  // interview itself holds up, so the mandate is completed through the form
  // path (the same product, a different door) and then used over the API.
  //
  // Playwright restarts the worker after every failed test, and that re-runs
  // beforeAll; the investor is therefore remembered (gitignored output dir)
  // and reused for a few hours while its mandate is still ACTIVE.
  test.beforeAll(async ({ browser }) => {
    const remembered = rememberedHomeInvestor();
    if (
      remembered !== null &&
      (await mandateFor(remembered)).status === "ACTIVE"
    ) {
      person = await signIn({
        email: remembered,
        token: "",
        name: "Chinedu Okafor",
      });
      return;
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = ui.uniqueEmail("home");
    rememberHomeInvestor(email);
    await ui.signUp(page, {
      name: "Chinedu Okafor",
      organisation: "Harrow Road Capital",
      email,
    });
    await ui.completeInvestorMandateByForm(page, {
      firm: "Harrow Road Capital",
      country: "Nigeria",
      stage: "Pre-seed",
    });
    await context.close();
    person = await signIn({ email, token: "", name: "Chinedu Okafor" });
  });

  test("who am I — Q knows the person from their profile", async () => {
    test.skip(person === null, "no completed investor");
    const q = new HomeQ(person as Person);
    const answer = await q.ask(
      "honestly, who am I to you? what do you know about me",
      {
        subjects: await q.ownSubject(),
      },
    );
    const text = answer.text.toLowerCase();
    const knows = [
      "chinedu",
      "harrow road",
      "angel",
      "pre-seed",
      "nigeria",
    ].filter((f) => text.includes(f));
    note("answer", answer.text);
    expect(answer.status).toBe("COMPLETED");
    expect(
      knows.length,
      `CAPABILITY: answer "who am I" from the person's own record`,
    ).toBeGreaterThanOrEqual(2);
  });

  for (const c of MEMORY) {
    test(`memory: ${c.id}`, async () => {
      test.skip(person === null, "no completed investor");
      const q = new HomeQ(person as Person);
      const first = await q.ask(c.tell);
      const second = await q.ask(c.ask);
      note("answers", `${first.text}\n---\n${second.text}`);
      expect(
        second.conversationId,
        "CAPABILITY: keep one conversation across turns",
      ).toBe(first.conversationId);
      expect(
        second.text.toLowerCase().includes(c.recall),
        `CAPABILITY: remember an earlier turn in the same chat; answer: ${second.text.slice(0, 300)}`,
      ).toBe(true);
    });
  }

  test("D5 fit candidates — which investors would likely invest", async () => {
    test.skip(person === null, "no completed investor");
    const q = new HomeQ(person as Person);
    const answer = await q.ask(
      "Which specific investors would likely invest in Zino Aviation?",
      { timeoutMs: 420_000 },
    );
    const investors = await read<{ name: string }>(
      `select display_name name from core.investor_organisations
        where display_name is not null and length(display_name) > 3`,
    );
    const named = investors
      .filter((i) => answer.text.includes(i.name))
      .map((i) => i.name);
    const references =
      JSON.stringify(answer.blocks).split("INVESTOR_REFERENCE").length - 1;
    note("answer", answer.text);
    expect(
      new Set(named).size + references,
      "CAPABILITY: produce fit candidates (named investors), not only existing-interest evidence",
    ).toBeGreaterThanOrEqual(2);
  });

  for (const c of IMPERATIVES) {
    test(`P6 imperative: ${c.id}`, async () => {
      test.skip(person === null, "no completed investor");
      const since = new Date();
      const q = new HomeQ(person as Person);
      const first = await q.ask(c.say, { timeoutMs: 480_000 });
      let artifacts = await artifactsFor((person as Person).email, since);
      let followed = "";
      if (artifacts.length === 0 && c.followUp !== undefined) {
        followed = (await q.ask(c.followUp, { timeoutMs: 480_000 })).text;
        artifacts = await artifactsFor((person as Person).email, since);
      }
      note("answers", `${first.text}\n---\n${followed}`);
      expect(
        artifacts.length,
        "CAPABILITY: execute an imperative document request (no artifact was produced)",
      ).toBeGreaterThanOrEqual(1);
      const head = await q.artifactPdfHead(artifacts[0]?.id ?? "");
      expect(head, "CAPABILITY: the produced artifact renders as a PDF").toBe(
        "%PDF",
      );
    });
  }

  test("D6 interrupt — cancelling a run stops it and Q is free again", async () => {
    test.skip(person === null, "no completed investor");
    const since = new Date();
    const q = new HomeQ(person as Person);
    const runId = await q.start(
      "Walk me through, in detail, how you would evaluate an early-stage cold-chain logistics company, step by step, with examples.",
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const status = await q.cancel(runId);
    note("cancel", status);
    const runs = await runsFor((person as Person).email, since);
    expect(
      runs.find((r) => r.id === runId)?.status,
      "CAPABILITY: stop a run when interrupted",
    ).toMatch(/CANCEL/);
    const next = await q.ask(
      "ok, short version: what's the first thing you'd check?",
    );
    expect(next.status, "CAPABILITY: listen again after an interruption").toBe(
      "COMPLETED",
    );
  });
});
