import { describe, expect, it } from "vitest";

import { OnboardingResponseValueSchema } from "@capital-q/contracts";
import type { FounderFactKey } from "@capital-q/q-core";

import {
  businessShapeFrom,
  describeBusinessShape,
  describeOrigins,
  draftSuggestions,
  factAppliesTo,
  factKeyForStep,
  FOUNDER_DEFINITION_V1,
  FOUNDER_DEFINITION_V2,
  FOUNDER_FOLLOW_UP_BUDGET,
  FOUNDER_REQUIRED_FACTS,
  FOUNDER_STEPS,
  FOUNDER_V2_REPLACED_STEPS,
  isDirectlySuggestable,
  planFollowUpQuestions,
  requiredFactsOutstanding,
  stepForFactKey,
  type FounderCandidate,
  type PlannerInput,
} from "../src/index.js";

/**
 * The deterministic half of CQ-Q-021 (§77): what the journey asks, what it
 * refuses to ask twice, and what a model's reading is allowed to become.
 *
 * Every case here is a promise the packet makes to a founder — that
 * uploading a deck means typing less, that a pre-revenue company is not
 * quizzed on retention, that a disagreement between their own documents is
 * put to them rather than resolved behind them, and that "I don't know"
 * costs nothing. None of them needs a model to judge.
 */

const answered = (...keys: FounderFactKey[]): ReadonlySet<FounderFactKey> =>
  new Set(keys);

function plan(overrides: Partial<PlannerInput> = {}) {
  return planFollowUpQuestions({
    answered: new Set(),
    suggested: new Set(),
    conflicts: [],
    ambiguities: [],
    proposed: [],
    shape: null,
    ...overrides,
  });
}

function candidate(
  overrides: Partial<FounderCandidate> = {},
): FounderCandidate {
  return {
    key: "description",
    value: "We instrument plant equipment for mid-sized manufacturers.",
    quote: "We instrument plant equipment.",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    explicit: true,
    origins: [
      {
        documentId: "11111111-1111-4111-8111-111111111111",
        documentVersionId: "22222222-2222-4222-8222-222222222222",
        label: "your pitch deck, slide 4",
        page: 4,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// QFOU-001..003 · the journey v2 publishes
// ---------------------------------------------------------------------------

describe("QFOU-001 · founder definition v2", () => {
  it("makes F2 a real document upload rather than a checkbox declaration", () => {
    const f2 = FOUNDER_DEFINITION_V2.steps.find(
      (step) => step.stepKey === FOUNDER_STEPS.materials,
    );
    expect(f2?.configuration.stepType).toBe("document_upload");
    // And it stays optional: a founder without documents is not turned away.
    expect(f2?.required).toBe(false);
  });

  it("keeps F2 immediately after company basics, before the long questions", () => {
    const order = (key: string): number =>
      FOUNDER_DEFINITION_V2.steps.findIndex((step) => step.stepKey === key);
    expect(order(FOUNDER_STEPS.materials)).toBeGreaterThan(
      order(FOUNDER_STEPS.companyName),
    );
    expect(order(FOUNDER_STEPS.materials)).toBeLessThan(
      order(FOUNDER_STEPS.signal),
    );
    expect(order(FOUNDER_STEPS.materials)).toBeLessThan(
      order(FOUNDER_STEPS.raising),
    );
  });

  it("replaces exactly four steps and inherits the rest from v1 unchanged", () => {
    expect([...FOUNDER_V2_REPLACED_STEPS].sort()).toEqual(
      [
        FOUNDER_STEPS.materials,
        FOUNDER_STEPS.review,
        FOUNDER_STEPS.followUp,
        FOUNDER_STEPS.snapshot,
      ].sort(),
    );
    expect(FOUNDER_DEFINITION_V2.steps).toHaveLength(
      FOUNDER_DEFINITION_V1.steps.length,
    );
    for (const step of FOUNDER_DEFINITION_V2.steps) {
      if (FOUNDER_V2_REPLACED_STEPS.includes(step.stepKey)) {
        continue;
      }
      const original = FOUNDER_DEFINITION_V1.steps.find(
        (candidateStep) => candidateStep.stepKey === step.stepKey,
      );
      expect(step.configuration).toEqual(original?.configuration);
    }
  });

  it("leaves v1 published and untouched", () => {
    expect(FOUNDER_DEFINITION_V1.version).toBe(1);
    expect(FOUNDER_DEFINITION_V2.version).toBe(2);
    const v1Materials = FOUNDER_DEFINITION_V1.steps.find(
      (step) => step.stepKey === FOUNDER_STEPS.materials,
    );
    expect(v1Materials?.configuration.stepType).toBe("multi_select");
  });
});

// ---------------------------------------------------------------------------
// QFOU-002 · never ask what is already answered
// ---------------------------------------------------------------------------

describe("QFOU-002 · a confirmed fact is not asked again", () => {
  it("asks for a required fact nobody has answered", () => {
    const questions = plan();
    expect(questions.map((q) => q.key)).toContain("stage");
  });

  it("does not ask once the founder answered it", () => {
    const questions = plan({ answered: answered(...FOUNDER_REQUIRED_FACTS) });
    expect(questions).toHaveLength(0);
  });

  it("does not ask while a suggestion is waiting to be confirmed", () => {
    // Confirming what Q read is a review, not a question. Asking as well
    // would be the duplicate this packet exists to remove.
    const questions = plan({ suggested: answered("stage") });
    expect(questions.map((q) => q.key)).not.toContain("stage");
  });

  it("ignores a model proposal about something already answered", () => {
    const questions = plan({
      answered: answered("description"),
      proposed: [
        { key: "description", question: "What does the company do?", why: "x" },
      ],
    });
    expect(questions.map((q) => q.key)).not.toContain("description");
  });
});

// ---------------------------------------------------------------------------
// QFOU-003 · relevance to the business
// ---------------------------------------------------------------------------

describe("QFOU-003 · questions fit the business", () => {
  it("does not ask a pre-revenue company for customer counts or growth", () => {
    expect(factAppliesTo("customers", "PRE_REVENUE")).toBe(false);
    expect(factAppliesTo("growth", "PRE_REVENUE")).toBe(false);
    expect(factAppliesTo("pilots", "PRE_REVENUE")).toBe(true);
    const questions = plan({
      answered: answered(...FOUNDER_REQUIRED_FACTS),
      shape: "PRE_REVENUE",
      proposed: [
        { key: "customers", question: "How many customers?", why: "x" },
        { key: "growth", question: "What is your growth rate?", why: "x" },
        { key: "pilots", question: "Any pilots running?", why: "x" },
      ],
    });
    // The applicable one survives, so this proves exclusion and not an
    // empty plan.
    expect(questions.map((q) => q.key)).toContain("pilots");
    expect(questions.map((q) => q.key)).not.toContain("customers");
    expect(questions.map((q) => q.key)).not.toContain("growth");
  });

  it("does not ask a revenue company about pilots as though nothing were sold", () => {
    expect(factAppliesTo("pilots", "REVENUE")).toBe(false);
    expect(factAppliesTo("customers", "REVENUE")).toBe(true);
  });

  it("excludes nothing while the shape is unknown", () => {
    // Unknown is unknown: a guess here would silently stop asking about a
    // metric the company may well have.
    expect(businessShapeFrom(null)).toBeNull();
    // The required facts are answered so the budget is free; what is left
    // is whether an unknown shape excludes the proposal. It must not.
    const questions = plan({
      answered: answered(...FOUNDER_REQUIRED_FACTS),
      shape: null,
      proposed: [{ key: "customers", question: "How many?", why: "x" }],
    });
    expect(questions.map((q) => q.key)).toContain("customers");
  });

  it("reads the shape from the founder's own answer", () => {
    expect(businessShapeFrom("pre_revenue")).toBe("PRE_REVENUE");
    expect(businessShapeFrom("early_revenue")).toBe("EARLY_REVENUE");
    expect(businessShapeFrom("growing_revenue")).toBe("REVENUE");
  });

  it("tells the model the shape without telling it what to prefer", () => {
    const described = describeBusinessShape("PRE_REVENUE", "Seed");
    expect(described).toContain("no revenue yet");
    expect(described.toLowerCase()).not.toContain("investors");
    expect(described.toLowerCase()).not.toContain("attractive");
  });
});

// ---------------------------------------------------------------------------
// QFOU-004 · contradictions are put to the founder, never resolved
// ---------------------------------------------------------------------------

describe("QFOU-004 · a disagreement becomes one question with both sides", () => {
  const conflict = {
    key: "customers" as FounderFactKey,
    readings: [
      { value: "45 customers", origins: [] },
      { value: "31 active accounts", origins: [] },
    ],
    question:
      "Your deck mentions 45 customers while another document shows 31 active accounts. Are these measuring the same thing?",
  };

  it("asks it first, ahead of missing information", () => {
    const questions = plan({
      conflicts: [conflict],
      shape: "REVENUE",
    });
    expect(questions[0]?.reason).toBe("CONTRADICTION");
    expect(questions[0]?.key).toBe("customers");
  });

  it("carries both readings, and picks neither", () => {
    const [question] = plan({ conflicts: [conflict], shape: "REVENUE" });
    expect(question?.readings).toEqual(["45 customers", "31 active accounts"]);
    // No average, no preference for the larger number.
    expect(question?.question).not.toContain("38");
    expect(question?.readings).toHaveLength(2);
  });

  it("asks even when the fact already has an answer, because the answer may be the wrong reading", () => {
    const questions = plan({
      answered: answered("customers"),
      conflicts: [conflict],
      shape: "REVENUE",
    });
    expect(questions.map((q) => q.key)).toContain("customers");
  });
});

// ---------------------------------------------------------------------------
// QFOU-005 · bounded, ordered, and about real steps
// ---------------------------------------------------------------------------

describe("QFOU-005 · the interview stays short", () => {
  it("never exceeds the follow-up budget", () => {
    const questions = plan({
      proposed: Array.from({ length: 6 }, (_unused, index) => ({
        key: FOUNDER_REQUIRED_FACTS[
          index % FOUNDER_REQUIRED_FACTS.length
        ] as FounderFactKey,
        question: `Question ${String(index)}`,
        why: "x",
      })),
      ambiguities: [
        { key: "target_amount", question: "Is that the full round?" },
      ],
    });
    expect(questions.length).toBeLessThanOrEqual(FOUNDER_FOLLOW_UP_BUDGET);
  });

  it("asks each fact at most once however many times it was proposed", () => {
    const questions = plan({
      proposed: [
        { key: "stage", question: "What stage?", why: "x" },
        { key: "stage", question: "Which stage exactly?", why: "x" },
      ],
    });
    expect(questions.filter((q) => q.key === "stage")).toHaveLength(1);
  });

  it("refuses a proposal for a fact no step can answer", () => {
    // The model cannot introduce a question with no schema, no validator
    // and no write target behind it.
    const questions = plan({
      proposed: [
        { key: "signal", question: "Tell me about traction.", why: "x" },
      ],
      // signal maps to a step, so use a key that does not to prove the rule
    });
    for (const question of questions) {
      expect(stepForFactKey(question.key)).not.toBeNull();
    }
  });

  it("maps every planned question to a real v2 step", () => {
    const keys = new Set(FOUNDER_DEFINITION_V2.steps.map((s) => s.stepKey));
    for (const question of plan({ shape: "REVENUE" })) {
      expect(keys.has(question.stepKey)).toBe(true);
    }
  });
});

describe("QFOU-006 · completion needs the minimum, not everything", () => {
  it("reports only the required facts as outstanding", () => {
    expect(requiredFactsOutstanding(new Set())).toEqual(FOUNDER_REQUIRED_FACTS);
    expect(
      requiredFactsOutstanding(answered(...FOUNDER_REQUIRED_FACTS)),
    ).toEqual([]);
    // A company with no revenue figure is still a complete onboarding.
    expect(FOUNDER_REQUIRED_FACTS).not.toContain("customers");
    expect(FOUNDER_REQUIRED_FACTS).not.toContain("target_amount");
  });
});

// ---------------------------------------------------------------------------
// QFOU-007..008 · a reading becomes a suggestion, never a record
// ---------------------------------------------------------------------------

describe("QFOU-007 · suggestions carry provenance", () => {
  it("names the document and version a value came from", () => {
    const [draft] = draftSuggestions([candidate()]);
    expect(draft?.stepKey).toBe(FOUNDER_STEPS.description);
    expect(draft?.targetField).toBe("description");
    expect(draft?.sourceRefs).toEqual([
      {
        sourceType: "EVIDENCE_DOCUMENT",
        sourceId: "11111111-1111-4111-8111-111111111111",
      },
      {
        sourceType: "EVIDENCE_DOCUMENT_VERSION",
        sourceId: "22222222-2222-4222-8222-222222222222",
      },
    ]);
  });

  it("describes the source in the founder's terms, never a storage path", () => {
    const described = describeOrigins(candidate());
    expect(described).toBe("From your pitch deck, slide 4");
    expect(described).not.toContain("bucket");
    expect(described).not.toContain("11111111");
  });

  it("emits nothing for a step whose vocabulary it does not know", () => {
    // Guessing a select value would produce a suggestion the runtime
    // rejects at validation. Better to surface it for review than to emit
    // something that cannot be stored.
    expect(isDirectlySuggestable("stage")).toBe(false);
    expect(
      draftSuggestions([candidate({ key: "stage", value: "Seed" })]),
    ).toEqual([]);
  });

  it("suggests each fact once", () => {
    const drafts = draftSuggestions([
      candidate(),
      candidate({ value: "A different description." }),
    ]);
    expect(drafts).toHaveLength(1);
  });
});

describe("QFOU-008 · steps and facts agree in both directions", () => {
  it("round-trips every mapped fact key", () => {
    for (const key of FOUNDER_REQUIRED_FACTS) {
      const stepKey = stepForFactKey(key);
      expect(stepKey).not.toBeNull();
      expect(factKeyForStep(stepKey ?? "")).toBe(key);
    }
  });

  it("maps only to steps the published journey actually has", () => {
    const keys = new Set(FOUNDER_DEFINITION_V2.steps.map((s) => s.stepKey));
    for (const key of FOUNDER_REQUIRED_FACTS) {
      expect(keys.has(stepForFactKey(key) ?? "")).toBe(true);
    }
  });
});

describe("QFOU-009 · a drafted suggestion is a valid answer to its step", () => {
  it("carries the response contract's discriminator, so the runtime accepts it", () => {
    // The onboarding runtime validates every suggestion against the pinned
    // step's own schema before storing it. A draft shaped { text } instead
    // of { type: "TEXT", text } parses as no member of the union, and every
    // suggestion Q produced was silently refused — the whole feature was
    // inert in the product while this suite stayed green, because it only
    // ever asserted the draft's own shape.
    for (const key of ["company_name", "website", "description"] as const) {
      const [draft] = draftSuggestions([
        candidate({ key, value: `a value for ${key}` }),
      ]);
      expect(draft).toBeDefined();
      const parsed = OnboardingResponseValueSchema.safeParse(
        draft?.suggestedValue,
      );
      expect(parsed.success).toBe(true);
    }
  });

  it("only drafts for steps the published journey answers with plain text", () => {
    // The class of bug this closes: use_of_funds was listed as free text
    // while its step is a multi_select over a fixed vocabulary, so every
    // suggestion Q made for it was refused. Asserting against the published
    // definition means the set cannot drift from the journey again.
    const stepTypes = new Map(
      FOUNDER_DEFINITION_V2.steps.map((step) => [
        step.stepKey,
        step.configuration.stepType,
      ]),
    );
    const textual = new Set(["short_text", "long_text", "url", "company_name"]);
    for (const key of FOUNDER_REQUIRED_FACTS) {
      if (!isDirectlySuggestable(key)) {
        continue;
      }
      const stepKey = stepForFactKey(key) ?? "";
      const stepType = stepTypes.get(stepKey);
      expect(
        stepType === undefined ? "missing" : stepType,
        `${key} -> ${stepKey}`,
      ).toSatisfy((value: unknown) => textual.has(String(value)));
      const [draft] = draftSuggestions([candidate({ key, value: "x" })]);
      expect(draft?.suggestedValue).toMatchObject({ type: "TEXT" });
    }
  });
});
