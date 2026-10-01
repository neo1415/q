import { describe, expect, it } from "vitest";

import {
  CounterpartPersonaStoredSchema,
  PresenceReadingSchema,
  RehearsalReviewResultSchema,
  RehearsalTurnV6ResultSchema,
} from "@capital-q/q-core";

import {
  readPersona,
  readPresence,
  readReview,
  readTurn,
} from "../src/composition/rehearsal-readings.js";

/**
 * REHEARSE P0 (founder 2026-10-01: "this should never be happening, at
 * all"): no single field ever refuses a whole reading. Each field of each
 * rehearsal output is perturbed on its own -- missing, null, a wrong type,
 * a label outside its set, far too long, far too many, an extra key -- and
 * the reading must still be accepted by the stored schema.
 */

const PERSONA = {
  summary: "A careful seed investor.",
  style: "Direct.",
  temperament: {
    baseline: "SKEPTICAL",
    warmsTo: ["numbers"],
    coolsOn: ["hype"],
  },
  priorities: ["Retention"],
  likelyQuestions: [
    { question: "What is your retention?", why: "Their focus" },
  ],
  likelyAnswers: [{ topic: "Traction", answer: "We have 300 farmers." }],
  pushbacks: ["Asks for cohorts"],
  howToWin: ["Bring cohorts"],
  dealbreakers: ["Made-up numbers"],
  grounding: "SOME",
  forwardness: "TYPICAL",
  forwardnessWhy: "No sign either way.",
  knownTraits: [{ trait: "Asks for data first", source: "CALLS" }],
};

const PRESENCE = {
  gaze: "AT_CAMERA",
  distracted: false,
  framing: "GOOD",
  lighting: "GOOD",
  background: "CALM",
  company: false,
  confident: true,
};

const TURN = {
  appraisal: "EVASIVE",
  line: "What's your retention?",
  move: "QUESTION",
  mood: "SKEPTICAL",
  intensity: "NORMAL",
  reaction: null,
  conclusion: null,
  presence: PRESENCE,
  askedToSee: false,
};

const REVIEW = {
  overall: "Solid, but bring cohorts.",
  dimensions: [{ name: "CLARITY", rating: "STRONG", note: "Clear story." }],
  wentRight: [{ moment: "We have 300 farmers.", why: "Concrete." }],
  wentWrong: [
    { moment: "Churn is low.", why: "Vague.", better: "Say the number." },
  ],
  tips: ["Lead with retention."],
};

const PERTURBATIONS: readonly [string, (value: unknown) => unknown][] = [
  ["missing", () => undefined],
  ["null", () => null],
  ["a number", () => 42],
  ["an object", () => ({ nested: true })],
  ["a label outside its set", () => "SOMETHING_ELSE"],
  ["a lowercase label", (v) => (typeof v === "string" ? v.toLowerCase() : v)],
  ["far too long", () => "word ".repeat(2_000)],
  [
    "far too many",
    (v) =>
      Array.isArray(v)
        ? Array.from({ length: 60 }, (): unknown => (v as unknown[])[0])
        : v,
  ],
  ["an empty string", () => ""],
  ["an empty list", () => []],
];

/** Every dotted path to a value in an object (into the first list item). */
function paths(value: unknown, prefix: string[] = []): string[][] {
  if (value === null || typeof value !== "object") return [prefix];
  const own = Array.isArray(value)
    ? value.length === 0
      ? []
      : paths(value[0], [...prefix, "0"])
    : Object.entries(value).flatMap(([key, child]) =>
        paths(child, [...prefix, key]),
      );
  return prefix.length === 0 ? own : [prefix, ...own];
}

function perturb(
  base: unknown,
  path: string[],
  change: (v: unknown) => unknown,
): unknown {
  const copy: unknown = structuredClone(base);
  let parent = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1))
    parent = parent[key] as Record<string, unknown>;
  const last = path[path.length - 1] ?? "";
  const next = change(parent[last]);
  if (next === undefined) delete parent[last];
  else parent[last] = next;
  return copy;
}

function fuzz(
  base: Record<string, unknown>,
  read: (raw: unknown) => unknown,
  stored: { safeParse: (v: unknown) => { success: boolean } },
  allowedNull: (path: string[], how: string) => boolean,
) {
  let cases = 0;
  for (const path of paths(base)) {
    for (const [how, change] of PERTURBATIONS) {
      const reading = read(perturb(base, path, change));
      cases += 1;
      if (reading === null && allowedNull(path, how)) continue;
      expect(reading, `${path.join(".")} ${how}`).not.toBeNull();
      expect(
        stored.safeParse(reading).success,
        `${path.join(".")} ${how}`,
      ).toBe(true);
    }
  }
  // An extra key anywhere is ignored.
  expect(stored.safeParse(read({ ...base, surprise: "x" })).success).toBe(true);
  return cases;
}

describe("rehearsal readings never refuse whole for one field", () => {
  it("persona: every field perturbed alone is still a persona", () => {
    expect(
      fuzz(PERSONA, readPersona, CounterpartPersonaStoredSchema, () => false),
    ).toBeGreaterThan(200);
  });

  it("turn: every field perturbed alone is still a turn, unless there are no words to say", () => {
    const words = (path: string[], how: string) =>
      path.join(".") === "line" &&
      [
        "missing",
        "null",
        "an object",
        "an empty string",
        "an empty list",
      ].includes(how);
    expect(
      fuzz(TURN, readTurn, RehearsalTurnV6ResultSchema, words),
    ).toBeGreaterThan(100);
  });

  it("presence: every field perturbed alone is still a reading", () => {
    fuzz(PRESENCE, readPresence, PresenceReadingSchema, () => false);
  });

  it("review: every field perturbed alone is still a review, unless no dimension is left", () => {
    // Only the dimensions themselves (the list, its one item, or its name)
    // can leave nothing to grade; every other field never refuses.
    const noDimension = (path: string[], how: string) =>
      path[0] === "dimensions" &&
      (path.length <= 2 || (path[2] === "name" && how !== "a lowercase label"));
    fuzz(REVIEW, readReview, RehearsalReviewResultSchema, noDimension);
  });

  it("a close with no conclusion still closes, undecided", () => {
    expect(
      readTurn({ ...TURN, move: "CLOSE", conclusion: "MAYBE" })?.conclusion,
    ).toBe("INDECISIVE");
  });
});
