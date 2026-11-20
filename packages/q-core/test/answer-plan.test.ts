import { describe, expect, it } from "vitest";

import {
  ANSWER_SHAPES,
  ANSWER_SHAPES_V1,
  answerPlanNote,
  answerPlanOf,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  SYNTHETIC_COMPANY_FACTS,
  TURN_READER_V94,
  TURN_READER_V95,
  TURN_SKIM_V11,
  TURN_SKIM_V12,
  TurnReaderV95ResultSchema,
  TurnSkimV12ResultSchema,
  V12_PLAN,
  V92_RULES_END_BEFORE,
  V95_ANSWER_PLAN,
  type AnswerPlanInput,
  type CompanyAnalystVariables,
} from "../src/index.js";

/**
 * HQ-1 (conversation audit §2.2): the answer's shape is picked by code from
 * what the readers read, and its template rides in the turn notes, after
 * the cached prompt prefix. Pure, so the mapping is tested exhaustively.
 */

type Row = readonly [string, AnswerPlanInput, ReturnType<typeof answerPlanOf>];

const GOLDEN: readonly Row[] = [
  // Small talk and chat.
  [
    "small talk",
    { answerKinds: [], turnKind: "SMALL_TALK" },
    { shape: "SOCIAL", then: null },
  ],
  ["chat", { answerKinds: ["CHAT"] }, { shape: "SOCIAL", then: null }],
  [
    "small talk stays social even if unclear",
    { answerKinds: ["CHAT"], underspecified: true, costlyIfWrong: true },
    { shape: "SOCIAL", then: null },
  ],
  // Quick answers.
  ["a lookup", { answerKinds: ["LOOKUP"] }, { shape: "QUICK", then: null }],
  [
    "a follow-up",
    { answerKinds: ["FOLLOW_UP"] },
    { shape: "QUICK", then: null },
  ],
  [
    "a lookup about their own records",
    { answerKinds: ["LOOKUP"], questionKind: "THEIR_OWN_RECORDS" },
    { shape: "QUICK", then: null },
  ],
  // Analysis and advice.
  [
    "an analysis",
    { answerKinds: ["ANALYSIS"] },
    { shape: "ANALYSIS", then: null },
  ],
  [
    "a follow-up whose question is analytical",
    { answerKinds: ["FOLLOW_UP"], questionKind: "PROGRESS" },
    { shape: "ANALYSIS", then: null },
  ],
  [
    "a fit question",
    { answerKinds: ["LOOKUP"], questionKind: "FIT" },
    { shape: "ANALYSIS", then: null },
  ],
  [
    "options",
    { answerKinds: [], questionKind: "OPTIONS" },
    { shape: "ANALYSIS", then: null },
  ],
  [
    "advice",
    { answerKinds: ["ANALYSIS"], questionKind: "ADVICE" },
    { shape: "ADVICE", then: null },
  ],
  [
    "advice read without a kind",
    { answerKinds: [], questionKind: "ADVICE" },
    { shape: "ADVICE", then: null },
  ],
  // Comparison wins over analysis and advice.
  [
    "a comparison",
    { answerKinds: ["COMPARISON"] },
    { shape: "COMPARISON", then: null },
  ],
  [
    "a compound ask with a comparison part",
    { answerKinds: ["LOOKUP", "COMPARISON", "ANALYSIS"] },
    { shape: "COMPARISON", then: null },
  ],
  [
    "a comparison asked as advice",
    { answerKinds: ["COMPARISON"], questionKind: "ADVICE" },
    { shape: "COMPARISON", then: null },
  ],
  [
    "the heaviest part of a compound ask",
    { answerKinds: ["LOOKUP", "ANALYSIS"] },
    { shape: "ANALYSIS", then: null },
  ],
  // Unclear asks.
  [
    "unclear and costly: one question",
    { answerKinds: ["ANALYSIS"], underspecified: true, costlyIfWrong: true },
    { shape: "CLARIFY", then: null },
  ],
  [
    "unclear, cheap to redo: say the assumption, then analyse",
    { answerKinds: ["ANALYSIS"], underspecified: true },
    { shape: "ASSUME_AND_DO", then: "ANALYSIS" },
  ],
  [
    "unclear lookup: assume and answer quickly",
    { answerKinds: ["LOOKUP"], underspecified: true },
    { shape: "ASSUME_AND_DO", then: "QUICK" },
  ],
  [
    "unclear advice: assume and advise",
    { answerKinds: [], questionKind: "ADVICE", underspecified: true },
    { shape: "ASSUME_AND_DO", then: "ADVICE" },
  ],
  [
    "unclear with no work read: discovery",
    { answerKinds: [], underspecified: true },
    { shape: "DISCOVERY", then: null },
  ],
  // HQ-5 follow-up (live, fictional Savanna): "I'm not really sure what
  // I'm looking for" was read as advice and answered; seeking guidance
  // opens discovery on the first turn, whatever work was read, costly or not.
  [
    "seeks guidance: discovery on the first turn",
    {
      answerKinds: ["CHAT"],
      questionKind: "ADVICE",
      costlyIfWrong: true,
      seeksGuidance: true,
    },
    { shape: "DISCOVERY", then: null },
  ],
  [
    "costly alone changes nothing",
    { answerKinds: ["LOOKUP"], costlyIfWrong: true },
    { shape: "QUICK", then: null },
  ],
  // No shape.
  ["a document keeps its own path", { answerKinds: ["DOCUMENT"] }, null],
  [
    "a document part wins the compound ask",
    { answerKinds: ["ANALYSIS", "DOCUMENT"], underspecified: true },
    null,
  ],
  ["an unread turn guesses nothing", { answerKinds: [] }, null],
];

describe("the answer plan (HQ-1)", () => {
  it.each(GOLDEN)("%s", (_, input, expected) => {
    expect(answerPlanOf(input)).toEqual(expected);
  });

  it("every shape has a template, and the table reaches every shape", () => {
    const reached = new Set(
      GOLDEN.flatMap(([, , plan]) => (plan === null ? [] : [plan.shape])),
    );
    for (const shape of ANSWER_SHAPES) {
      expect(ANSWER_SHAPES_V1[shape].template.length).toBeGreaterThan(40);
      expect(reached, shape).toContain(shape);
    }
  });

  it("renders the same note for the same plan, with the follow-on shape for an assumption", () => {
    const plan = answerPlanOf({
      answerKinds: ["ANALYSIS"],
      underspecified: true,
    });
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const note = answerPlanNote(plan);
    expect(answerPlanNote(plan)).toBe(note);
    expect(
      note.startsWith(
        "SHAPE OF THIS ANSWER (ASSUME_AND_DO then ANALYSIS, v1):",
      ),
    ).toBe(true);
    expect(note).toContain(ANSWER_SHAPES_V1.ANALYSIS.template);
    expect(note).toContain("a length is a ceiling, never a floor");
  });

  it("analysis and advice: one follow-up question or one call to action, never praise", () => {
    for (const shape of ["ANALYSIS", "ADVICE"] as const) {
      const { template } = ANSWER_SHAPES_V1[shape];
      expect(template).toContain("one follow-up question");
      expect(template).toContain("only when there is an action");
      expect(template.toLowerCase()).toContain('never "great question"');
      expect(template).toContain("never praise");
    }
    expect(
      ANSWER_SHAPES_V1.QUICK.template.startsWith(
        "The answer itself in the first sentence",
      ),
    ).toBe(true);
    expect(ANSWER_SHAPES_V1.CLARIFY.template).toContain(
      "exactly one specific question",
    );
    expect(ANSWER_SHAPES_V1.CLARIFY.template).toContain("default");
  });
});

describe("the shape rides after the cached prefix", () => {
  const registry = createDefaultPromptRegistry();
  const render = (turnNotes: string) =>
    renderPrompt<CompanyAnalystVariables & { readonly turnNotes: string }>(
      registry,
      {
        task: "COMPANY_ANALYST",
        operatingMode: "DEBRIEF",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes: "test environment",
        variables: {
          capability: "ANSWER",
          userMessage: "How is Ledgerline doing on revenue?",
          conversation: [],
          authorisedFacts: [...SYNTHETIC_COMPANY_FACTS],
          subjectDescription: "the person's own company",
          turnNotes,
        },
      },
    );

  it("leaves every instruction message byte-identical and puts the shape in this turn only", () => {
    const plan = answerPlanOf({ answerKinds: ["ANALYSIS"] });
    if (plan === null) throw new Error("expected a plan");
    const shape = answerPlanNote(plan);
    const without = render("");
    const withShape = render(shape);
    const instructions = (r: typeof without) =>
      r.messages.filter((m) => m.role === "SYSTEM").map((m) => m.content);
    expect(instructions(withShape)).toEqual(instructions(without));
    for (const content of instructions(withShape)) {
      expect(content).not.toContain("SHAPE OF THIS ANSWER");
    }
    const user =
      withShape.messages.find((m) => m.role === "USER")?.content ?? "";
    expect(user.startsWith("THIS TURN")).toBe(true);
    expect(user).toContain(shape);
  });
});

describe("TURN_SKIM v12 and TURN_READER v95 (HQ-1)", () => {
  const registry = createDefaultPromptRegistry();

  it("are active, extend v11 and v94 by one rule each, with the old ones deprecated", () => {
    // Superseded by v13 and v96 (HQ-5 follow-up), kept for rollback.
    expect(registry.get("TURN_SKIM", 12)?.definition.version).toBe(12);
    expect(registry.get("TURN_READER", 95)?.definition.version).toBe(95);
    expect(registry.get("TURN_SKIM", 11)?.definition.status).toBe("DEPRECATED");
    expect(registry.get("TURN_READER", 94)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(TURN_SKIM_V12.template.replace(V12_PLAN, "")).toBe(
      TURN_SKIM_V11.template,
    );
    expect(TURN_READER_V95.template.replace(`\n${V95_ANSWER_PLAN}`, "")).toBe(
      TURN_READER_V94.template,
    );
  });

  it("puts the reader's new rule inside the cacheable fixed rules", () => {
    const at = TURN_READER_V95.template.indexOf(V95_ANSWER_PLAN);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(
      TURN_READER_V95.template.indexOf(V92_RULES_END_BEFORE),
    );
    expect(TURN_READER_V95.rulesEndBefore).toBe(V92_RULES_END_BEFORE);
  });

  it("reads both fields leniently: absent or malformed is false", () => {
    const skim = TurnSkimV12ResultSchema.parse({
      kind: "OTHER",
      confidence: "HIGH",
      underspecified: "yes",
    });
    expect(skim.underspecified).toBe(false);
    expect(skim.costlyIfWrong).toBe(false);
    const both = TurnSkimV12ResultSchema.parse({
      kind: "OTHER",
      confidence: "HIGH",
      underspecified: true,
      costlyIfWrong: true,
    });
    expect([both.underspecified, both.costlyIfWrong]).toEqual([true, true]);
    const reading = TurnReaderV95ResultSchema.safeParse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      costlyIfWrong: 3,
    });
    expect(reading.success).toBe(true);
    if (reading.success) {
      expect(reading.data.costlyIfWrong).toBe(false);
      expect(reading.data.underspecified).toBe(false);
    }
  });
});
