import { describe, expect, it } from "vitest";

import type { FounderFactKey } from "@capital-q/q-core";

import {
  createFounderReview,
  FOUNDER_STEPS,
  passagesFrom,
  sessionFactsFrom,
  type FounderCandidate,
  type FounderExtractionOutcome,
  type FounderExtractionRequest,
} from "../src/index.js";

/**
 * The replan (CQ-Q-021 §23, §47-§49, §77).
 *
 * The packet's central promise, tested where it is decided: a founder who
 * uploaded a deck and confirmed what Q read is never asked to type it
 * again, and a founder's own correction is never overwritten by the
 * extraction it corrected.
 *
 * The extraction is a stub here on purpose. What is under test is the
 * decision layer around it — which candidates become suggestions, which
 * become questions, and which are dropped because somebody already
 * answered them. That is deterministic, so no model judges it.
 */

const TENANT = "11111111-1111-4111-8111-111111111111" as never;
const USER = "22222222-2222-4222-8222-222222222222" as never;

function candidate(
  key: FounderFactKey,
  value: string,
  overrides: Partial<FounderCandidate> = {},
): FounderCandidate {
  return {
    key,
    value,
    quote: value,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    explicit: true,
    origins: [
      {
        documentId: "33333333-3333-4333-8333-333333333333",
        documentVersionId: "44444444-4444-4444-8444-444444444444",
        label: "your pitch deck, slide 4",
        page: 4,
      },
    ],
    ...overrides,
  };
}

function outcome(
  overrides: Partial<FounderExtractionOutcome> = {},
): FounderExtractionOutcome {
  return {
    candidates: [],
    taxonomy: [],
    conflicts: [],
    ambiguities: [],
    missing: [],
    proposed: [],
    summary: "A synthetic reading.",
    blocked: null,
    telemetry: {
      promptBundleVersion: null,
      providerCode: null,
      modelCode: null,
      passageCount: 0,
      documentCount: 0,
      candidateCount: 0,
      conflictCount: 0,
      ambiguityCount: 0,
      rejectedCandidateCount: 0,
      rejectedCitationCount: 0,
      latencyMs: 0,
      costUsd: 0,
    },
    ...overrides,
  };
}

function review(result: FounderExtractionOutcome) {
  const seen: FounderExtractionRequest[] = [];
  const service = createFounderReview({
    extraction: {
      extract: (request) => {
        seen.push(request);
        return Promise.resolve(result);
      },
    },
  });
  return { service, seen };
}

async function prepare(
  result: FounderExtractionOutcome,
  facts: Parameters<typeof sessionFactsFrom>[0],
) {
  const { service, seen } = review(result);
  const plan = await service.prepare({
    tenantId: TENANT,
    userId: USER,
    sql: undefined as never,
    facts: sessionFactsFrom(facts),
    sources: [],
    correlationId: "cor_founder_review_test",
  });
  return { plan, request: seen[0] };
}

const NOTHING_ANSWERED = {
  responses: [],
  pendingSuggestionSteps: [],
  narrative: null,
};

// ---------------------------------------------------------------------------
// QFOR-001 · reading the session
// ---------------------------------------------------------------------------

describe("QFOR-001 · what the session already knows", () => {
  it("counts a submitted response as answered, and carries its value", () => {
    const facts = sessionFactsFrom({
      responses: [
        { stepKey: FOUNDER_STEPS.description, value: { text: "We do X." } },
        { stepKey: FOUNDER_STEPS.stage, value: { optionKey: "seed" } },
      ],
      pendingSuggestionSteps: [],
      narrative: null,
    });
    expect([...facts.answered].sort()).toEqual(["description", "stage"]);
    expect(facts.known).toContainEqual({ key: "stage", value: "seed" });
    expect(facts.stage).toBe("seed");
  });

  it("counts a pending suggestion separately from an answer", () => {
    const facts = sessionFactsFrom({
      responses: [],
      pendingSuggestionSteps: [FOUNDER_STEPS.description],
      narrative: null,
    });
    expect(facts.answered.has("description")).toBe(false);
    expect(facts.suggested.has("description")).toBe(true);
  });

  it("ignores a step that answers no extractable fact", () => {
    const facts = sessionFactsFrom({
      responses: [{ stepKey: FOUNDER_STEPS.materials, value: {} }],
      pendingSuggestionSteps: [],
      narrative: null,
    });
    expect(facts.answered.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// QFOR-002 · the model is told what is already known
// ---------------------------------------------------------------------------

describe("QFOR-002 · the extraction is framed by the server", () => {
  it("passes known facts and the still-unanswered keys", async () => {
    const { request } = await prepare(outcome(), {
      responses: [
        { stepKey: FOUNDER_STEPS.description, value: { text: "We do X." } },
      ],
      pendingSuggestionSteps: [],
      narrative: null,
    });
    expect(request?.knownFacts).toContainEqual({
      key: "description",
      value: "We do X.",
    });
    expect(request?.unansweredKeys).not.toContain("description");
    expect(request?.unansweredKeys).toContain("stage");
  });

  it("passes the business shape from the founder's own revenue answer", async () => {
    const { request } = await prepare(outcome(), {
      responses: [
        {
          stepKey: FOUNDER_STEPS.revenueStatus,
          value: { optionKey: "pre_revenue" },
        },
      ],
      pendingSuggestionSteps: [],
      narrative: null,
    });
    expect(request?.shape).toBe("PRE_REVENUE");
  });
});

// ---------------------------------------------------------------------------
// QFOR-003 · what a reading becomes
// ---------------------------------------------------------------------------

describe("QFOR-003 · candidates become suggestions, not answers", () => {
  it("turns a free-text candidate into a suggestion with provenance", async () => {
    const { plan } = await prepare(
      outcome({
        candidates: [
          candidate("description", "We instrument plant equipment."),
        ],
      }),
      NOTHING_ANSWERED,
    );
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]?.stepKey).toBe(FOUNDER_STEPS.description);
    expect(plan.suggestions[0]?.sourceRefs.length).toBeGreaterThan(0);
  });

  it("surfaces a candidate it cannot suggest for review rather than dropping it", async () => {
    const { plan } = await prepare(
      outcome({ candidates: [candidate("stage", "Seed")] }),
      NOTHING_ANSWERED,
    );
    expect(plan.suggestions).toHaveLength(0);
    expect(plan.forReview.map((item) => item.key)).toEqual(["stage"]);
  });
});

// ---------------------------------------------------------------------------
// QFOR-004 · the founder's own answer wins
// ---------------------------------------------------------------------------

describe("QFOR-004 · never overwrite what the founder said", () => {
  it("drops a candidate about something the founder already answered", async () => {
    // The deck says one thing; the founder already said another. Their
    // answer stands and no competing suggestion is offered (§49, §52).
    const { plan } = await prepare(
      outcome({
        candidates: [candidate("description", "We are an insurance platform.")],
      }),
      {
        responses: [
          {
            stepKey: FOUNDER_STEPS.description,
            value: { text: "We instrument plant equipment." },
          },
        ],
        pendingSuggestionSteps: [],
        narrative: null,
      },
    );
    expect(plan.suggestions).toHaveLength(0);
    expect(plan.forReview).toHaveLength(0);
  });

  it("does not offer a second suggestion for a fact already awaiting review", async () => {
    // Running twice — a replayed job, or a second document — must not bury
    // the founder in duplicates (§63).
    const { plan } = await prepare(
      outcome({ candidates: [candidate("description", "We do X.")] }),
      {
        responses: [],
        pendingSuggestionSteps: [FOUNDER_STEPS.description],
        narrative: null,
      },
    );
    expect(plan.suggestions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// QFOR-005 · the replan
// ---------------------------------------------------------------------------

describe("QFOR-005 · what a document answers is not asked again", () => {
  it("asks about a fact before the document is read", async () => {
    const { plan } = await prepare(outcome(), NOTHING_ANSWERED);
    expect(plan.questions.map((q) => q.key)).toContain("description");
  });

  it("stops asking once the document proposed an answer to confirm", async () => {
    const { plan } = await prepare(
      outcome({
        candidates: [
          candidate("description", "We instrument plant equipment."),
        ],
      }),
      NOTHING_ANSWERED,
    );
    expect(plan.suggestions.map((s) => s.stepKey)).toContain(
      FOUNDER_STEPS.description,
    );
    // The founder confirms it on F3. Asking as well would be the duplicate.
    expect(plan.questions.map((q) => q.key)).not.toContain("description");
  });

  it("puts a disagreement between two documents first, with both readings", async () => {
    const { plan } = await prepare(
      outcome({
        conflicts: [
          {
            key: "customers",
            readings: [
              { value: "45 customers", origins: [] },
              { value: "31 active accounts", origins: [] },
            ],
            question:
              "Your deck mentions 45 customers while another document shows 31 active accounts. Are these measuring the same thing?",
          },
        ],
      }),
      {
        responses: [
          {
            stepKey: FOUNDER_STEPS.revenueStatus,
            value: { optionKey: "growing_revenue" },
          },
        ],
        pendingSuggestionSteps: [],
        narrative: null,
      },
    );
    expect(plan.questions[0]?.reason).toBe("CONTRADICTION");
    expect(plan.questions[0]?.readings).toEqual([
      "45 customers",
      "31 active accounts",
    ]);
  });
});

// ---------------------------------------------------------------------------
// QFOR-006 · onboarding survives a model that cannot help
// ---------------------------------------------------------------------------

describe("QFOR-006 · a failed reading does not trap the founder", () => {
  it("still plans the questions onboarding needs", async () => {
    const { plan } = await prepare(
      outcome({ blocked: "MODEL_UNAVAILABLE" }),
      NOTHING_ANSWERED,
    );
    expect(plan.suggestions).toHaveLength(0);
    // The journey carries on by asking, which is what it did before any of
    // this existed (§46).
    expect(plan.questions.length).toBeGreaterThan(0);
  });

  it("says so plainly when a founder uploaded nothing", async () => {
    const { plan } = await prepare(
      outcome({ blocked: "NO_MATERIAL" }),
      NOTHING_ANSWERED,
    );
    expect(plan.outcome.blocked).toBe("NO_MATERIAL");
    expect(plan.questions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// QFOR-007 · provenance the founder can read
// ---------------------------------------------------------------------------

describe("QFOR-007 · passages carry where they came from", () => {
  it("labels a slide the way a person would say it", () => {
    const passages = passagesFrom([
      {
        documentId: "33333333-3333-4333-8333-333333333333",
        documentVersionId: "44444444-4444-4444-8444-444444444444",
        title: "pitch deck",
        chunks: [
          {
            content: "ARR reached USD 2.4m.",
            chunkIndex: 1,
            locator: { slide: 8 },
          },
          { content: "The problem.", chunkIndex: 0, locator: { slide: 2 } },
        ],
      },
    ]);
    // Ordered as the document reads, not as the rows arrived.
    expect(passages[0]?.text).toBe("The problem.");
    expect(passages[1]?.label).toBe("your pitch deck, slide 8");
    expect(passages[1]?.page).toBe(8);
  });

  it("bounds how much of one document can crowd out another", () => {
    const chunks = Array.from({ length: 30 }, (_unused, index) => ({
      content: `Chunk ${String(index)}`,
      chunkIndex: index,
      locator: {},
    }));
    const passages = passagesFrom(
      [
        {
          documentId: "33333333-3333-4333-8333-333333333333",
          documentVersionId: "44444444-4444-4444-8444-444444444444",
          title: "pitch deck",
          chunks,
        },
      ],
      5,
    );
    expect(passages).toHaveLength(5);
  });
});
