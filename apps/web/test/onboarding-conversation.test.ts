import { describe, expect, it } from "vitest";

import type {
  OnboardingSessionView,
  OnboardingStepView,
} from "@capital-q/contracts";

import {
  acknowledge,
  acknowledgeValue,
  gapValue,
  looksLikeQuestionForQ,
  pauseIntent,
  progressLines,
  promptFor,
  RESUME_AFTER_MS,
  resumeIntent,
  stillNeeded,
  taxonomyProposal,
  welcomeBack,
  type JourneyVocabulary,
} from "../src/features/onboarding-conversation/conversation";

/**
 * CQ-PRE-REC-001 §18, §26-§27: the Q-led interview is a reading of
 * persisted journey state, never a memory the browser keeps.
 */

const VOCABULARY: JourneyVocabulary = {
  subject: "founder",
  stepTitle: (stepKey) =>
    ({
      "F1.stage": "Stage",
      "F1.company_name": "Company",
      "F2.materials": "Documents",
    })[stepKey] ?? stepKey,
  describe: (_stepKey, value) =>
    value.type === "SINGLE_SELECT"
      ? value.optionKey
      : value.type === "RANGE"
        ? value.value
        : JSON.stringify(value),
  stepType: (stepKey) =>
    ({
      "F1.stage": "single_select" as const,
      "F5.mrr": "range" as const,
      "F2.materials": "multi_select" as const,
    })[stepKey],
  optionsFor: (stepKey) =>
    stepKey === "F1.stage"
      ? [
          { optionKey: "seed", label: "Seed" },
          { optionKey: "series_a", label: "Series A" },
        ]
      : [],
  editorFor: (stepKey) => (stepKey === "F1.stage" ? "stage" : undefined),
  reviewGroups: [
    { label: "Company", stepKeys: ["F1.company_name", "F1.stage"] },
    { label: "Evidence", stepKeys: ["F2.materials"] },
    { label: "Raise", stepKeys: ["F6.raising"] },
  ],
  finalStepKeys: ["F8.snapshot"],
};

function view(
  overrides: Partial<OnboardingSessionView> = {},
): OnboardingSessionView {
  return {
    session: {
      id: "11111111-1111-4111-8111-111111111111",
      journeyType: "founder",
      status: "ACTIVE",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      version: 3,
      currentStepKey: "F1.stage",
      subject: null,
      startedAt: "2026-09-13T10:00:00.000Z",
      lastActivityAt: "2026-09-13T10:01:00.000Z",
      completedAt: null,
    },
    currentStep: {
      stepKey: "F1.stage",
      stepType: "single_select",
      required: true,
      prompt: "What stage are you at?",
      supportingText: "Pick the closest.",
      presentation: {
        stepType: "single_select",
        options: [
          { optionKey: "seed", label: "Seed" },
          { optionKey: "series_a", label: "Series A" },
        ],
      },
    },
    progress: {
      eligibleSteps: [
        { stepKey: "F1.company_name", required: true, status: "COMPLETED" },
        { stepKey: "F1.stage", required: true, status: "IN_PROGRESS" },
        { stepKey: "F2.materials", required: true, status: "COMPLETED" },
        { stepKey: "F6.raising", required: true, status: "PENDING" },
      ],
      canGoBack: true,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        stepKey: "F2.materials",
        responseType: "RESOURCE_REFERENCE",
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType: "EVIDENCE_DOCUMENT",
          resourceIds: ["44444444-4444-4444-8444-444444444444"],
        },
        sourceModality: "DOCUMENT_REFERENCE",
        createdAt: "2026-09-13T10:01:00.000Z",
      },
    ],
    pendingQuestions: [],
    ...overrides,
  } as unknown as OnboardingSessionView;
}

describe("promptFor", () => {
  it("asks the step in the definition's words with its options as chips", () => {
    const step = view().currentStep;
    if (step === null) {
      throw new Error("fixture has a current step");
    }
    const prompt = promptFor(step, VOCABULARY);
    expect(prompt).toMatchObject({
      stepKey: "F1.stage",
      text: "What stage are you at?",
      why: "Pick the closest.",
      control: "chips",
      optional: false,
    });
    expect(prompt.chips.map((chip) => chip.say)).toEqual(["Seed", "Series A"]);
    // A tap submits the option itself, not a sentence about it (CQ-Q-VOICE-001 B §17).
    expect(prompt.chips.map((chip) => chip.value)).toEqual([
      { type: "SINGLE_SELECT", optionKey: "seed" },
      { type: "SINGLE_SELECT", optionKey: "series_a" },
    ]);
  });

  it("offers multi-select options as toggles with the step's own limit, marking the stand-alone one (§17)", () => {
    const step: OnboardingStepView = {
      stepKey: "F2.materials",
      stepType: "multi_select",
      required: false,
      prompt: "What do you already have?",
      presentation: {
        stepType: "multi_select",
        options: [
          { optionKey: "deck", label: "Deck" },
          { optionKey: "model", label: "Financial model" },
          { optionKey: "none", label: "Nothing yet" },
        ],
        minSelections: 1,
        maxSelections: 6,
        exclusiveOptionKeys: ["none"],
      },
    };
    const prompt = promptFor(step, VOCABULARY);
    expect(prompt.control).toBe("multi_chips");
    expect(prompt.maxSelections).toBe(6);
    expect(prompt.chips.map((chip) => chip.exclusive)).toEqual([
      false,
      false,
      true,
    ]);
    expect(prompt.chips[0]?.value).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["deck"],
    });
  });

  it("turns a taxonomy step into the category control, never a detour to the form (§19)", () => {
    const step: OnboardingStepView = {
      stepKey: "F1.categories",
      stepType: "reference_select",
      required: false,
      prompt: "How would you categorise the company?",
      presentation: {
        stepType: "reference_select",
        resourceType: "TAXONOMY_NODE",
        vocabularyCodes: ["industry"],
        minItems: 1,
        maxItems: 8,
      },
    };
    const prompt = promptFor(step, VOCABULARY);
    expect(prompt.control).toBe("taxonomy");
    expect(prompt.maxSelections).toBe(8);
  });

  it("offers a reference step's candidates as chips, and answers a single one itself (§38)", () => {
    const step: OnboardingStepView = {
      stepKey: "I1.mandate_context",
      stepType: "reference_select",
      required: true,
      prompt: "Which mandate are we defining?",
      presentation: {
        stepType: "reference_select",
        resourceType: "INVESTOR_MANDATE",
        vocabularyCodes: [],
        minItems: 1,
        maxItems: 1,
        contextKey: "investor.mandates",
      },
      context: {
        kind: "investor.mandates",
        candidates: [
          {
            mandateId: "m-1",
            name: "Primary mandate",
            status: "DRAFT",
            version: 1,
          },
          {
            mandateId: "m-2",
            name: "Growth fund II",
            status: "ACTIVE",
            version: 4,
          },
        ],
      },
    };
    const two = promptFor(step, VOCABULARY);
    expect(two.control).toBe("chips");
    expect(two.chips.map((chip) => chip.say)).toEqual([
      "Primary mandate",
      "Growth fund II",
    ]);
    expect(two.autoSay).toBeUndefined();

    const one = promptFor(
      {
        ...step,
        context: {
          kind: "investor.mandates",
          candidates: [
            {
              mandateId: "m-1",
              name: "Primary mandate",
              status: "DRAFT",
              version: 1,
            },
          ],
        },
      },
      VOCABULARY,
    );
    expect(one.autoSay).toBe("Primary mandate");
    expect(one.autoNote).toContain("Primary mandate");

    // Without candidates the step is still an editor, never invented chips.
    const none = promptFor({ ...step, context: undefined }, VOCABULARY);
    expect(none.control).toBe("editor");
    expect(none.autoSay).toBeUndefined();
  });
});

describe("promptFor · generic strength prompts", () => {
  it("names the subject when the definition asks a bare how-firm question", () => {
    const step: OnboardingStepView = {
      stepKey: "F1.stage",
      stepType: "single_select",
      required: false,
      prompt: "How firm is that?",
      presentation: {
        stepType: "single_select",
        options: [{ optionKey: "strong", label: "Strong preference" }],
      },
    };
    expect(promptFor(step, VOCABULARY).text).toBe("Stage?");
    expect(
      promptFor({ ...step, prompt: "Which stage are you at?" }, VOCABULARY)
        .text,
    ).toBe("Which stage are you at?");
  });
});

describe("acknowledge", () => {
  it("does not double the full stop when the answer ends a sentence", () => {
    expect(
      acknowledge(
        {
          kind: "ANSWERED",
          stepKey: "F1.stage",
          summary: "Founders who have sold into banks before.",
        },
        VOCABULARY,
      ),
    ).toBe("Stage: Founders who have sold into banks before. Noted.");
  });
});

describe("welcomeBack", () => {
  const lastActivity = Date.parse("2026-09-13T10:01:00.000Z");

  it("greets from persisted state only: settled groups, documents, what remains", () => {
    expect(
      welcomeBack(view(), VOCABULARY, lastActivity + RESUME_AFTER_MS),
    ).toBe(
      "Welcome back. We already covered evidence. Your document is on file. 2 questions left.",
    );
  });

  it("says nothing when the person was here moments ago — a refresh, the form and back, a second tab (CQ-Q-VOICE-001 B §26)", () => {
    expect(
      welcomeBack(view(), VOCABULARY, lastActivity + RESUME_AFTER_MS - 1),
    ).toBeNull();
    expect(welcomeBack(view(), VOCABULARY, lastActivity + 5_000)).toBeNull();
  });

  it("says nothing on a journey with nothing settled yet", () => {
    const fresh = view({
      progress: {
        currentStepKey: "F1.stage",
        currentPhaseKey: "F1",
        eligibleSteps: [
          { stepKey: "F1.stage", required: true, status: "IN_PROGRESS" },
        ],
        eligibleStepCount: 1,
        completedEligibleStepCount: 0,
        canGoBack: false,
        canSkipCurrentStep: false,
        canComplete: false,
      },
      responses: [],
    });
    expect(welcomeBack(fresh, VOCABULARY)).toBeNull();
  });
});

describe("progressLines", () => {
  it("counts settled eligible steps per review group and marks the current one", () => {
    expect(progressLines(view(), VOCABULARY)).toEqual([
      { label: "Company", done: 1, total: 2, current: true },
      { label: "Evidence", done: 1, total: 1, current: false },
      { label: "Raise", done: 0, total: 1, current: false },
    ]);
  });
});

describe("acknowledge", () => {
  it("names the step and the answer, and explains a required step plainly", () => {
    expect(
      acknowledge(
        { kind: "ANSWERED", stepKey: "F1.stage", summary: "Seed" },
        VOCABULARY,
      ),
    ).toBe("Stage: Seed. Noted.");
    expect(
      acknowledge(
        { kind: "REQUIRED", stepKey: "F1.stage", why: null },
        VOCABULARY,
      ),
    ).toContain("I do need this one");
    expect(
      acknowledge(
        { kind: "READING", stepKey: "F1.stage", utteranceId: "x" },
        VOCABULARY,
      ),
    ).toContain("reading that now");
  });
});

describe("looksLikeQuestionForQ", () => {
  it("routes questions to Q but keeps the interview's own why", () => {
    expect(looksLikeQuestionForQ("What did my deck say about churn?")).toBe(
      true,
    );
    expect(looksLikeQuestionForQ("Why do you need this?")).toBe(false);
    expect(
      looksLikeQuestionForQ("Why does the stage matter to investors?"),
    ).toBe(true);
    expect(looksLikeQuestionForQ("Seed")).toBe(false);
  });

  it("recognises a request for Q without a question mark, but not an answer (CQ-Q-VOICE-001 B §23)", () => {
    expect(
      looksLikeQuestionForQ("Tell me about Series A rounds in Nigeria"),
    ).toBe(true);
    expect(looksLikeQuestionForQ("Can you check what Paystack raised")).toBe(
      true,
    );
    expect(looksLikeQuestionForQ("Look up Flutterwave")).toBe(true);
    expect(
      looksLikeQuestionForQ(
        "We make AI software for freight forwarders and logistics companies.",
      ),
    ).toBe(false);
    expect(looksLikeQuestionForQ("Lagos")).toBe(false);
  });
});

describe("resume and pause (CQ-Q-VOICE-001 B §24-§25)", () => {
  it("hears the explicit ways back to the interview", () => {
    for (const phrase of [
      "Let's continue.",
      "Continue the interview.",
      "Where were we?",
      "Back to onboarding.",
      "Carry on.",
      "Let's finish this.",
      "OK, let's continue",
    ]) {
      expect(resumeIntent(phrase), phrase).toBe(true);
    }
    expect(resumeIntent("Series A")).toBe(false);
    expect(resumeIntent("We continue to sell in Ghana")).toBe(false);
  });

  it("hears a pause, which persists and never completes", () => {
    for (const phrase of [
      "Let's stop here.",
      "I'll finish this later.",
      "Pause the interview.",
      "Let's finish this later",
    ]) {
      expect(pauseIntent(phrase), phrase).toBe(true);
    }
    expect(pauseIntent("Let's finish this.")).toBe(false);
    expect(pauseIntent("We stopped selling hardware")).toBe(false);
  });
});

describe("gaps answered in place (CQ-Q-VOICE-001 B §16, §21)", () => {
  const question = {
    id: "55555555-5555-4555-8555-555555555555",
    factKey: "mrr",
    question: "What was MRR last month?",
    why: null,
    reason: "MATERIAL_GAP" as const,
    readings: [],
    options: [],
    createdAt: "2026-09-13T10:02:00.000Z",
  };

  it("offers a figure input for a range step, the definition's options for a select step, and the form only as a last resort", () => {
    const gaps = stillNeeded(
      view({
        pendingQuestions: [
          { ...question, stepKey: "F5.mrr" },
          {
            ...question,
            id: "66666666-6666-4666-8666-666666666666",
            stepKey: "F1.stage",
            question: "What stage are you at?",
          },
          {
            ...question,
            id: "77777777-7777-4777-8777-777777777777",
            stepKey: "F9.unknown",
            question: "Something the definition does not type?",
          },
        ],
      }),
      VOCABULARY,
    );
    expect(gaps.map((gap) => gap.control)).toEqual([
      { kind: "figure" },
      {
        kind: "choices",
        multi: false,
        options: [
          { optionKey: "seed", label: "Seed" },
          { optionKey: "series_a", label: "Series A" },
        ],
      },
      { kind: "editor" },
    ]);
  });

  it("prefers the question's own server-built options when it has them", () => {
    const [gap] = stillNeeded(
      view({
        pendingQuestions: [
          {
            ...question,
            stepKey: "F5.mrr",
            options: [
              {
                label: "$90k",
                stepKey: "F5.mrr",
                value: { type: "RANGE", value: "90000" },
              },
            ],
          },
        ],
      }),
      VOCABULARY,
    );
    expect(gap?.control).toEqual({ kind: "options" });
  });

  it("turns a typed figure into a RANGE and a line into TEXT, refusing what is not a number", () => {
    expect(gapValue({ kind: "figure" }, "90,000")).toEqual({
      type: "RANGE",
      value: "90000",
    });
    expect(gapValue({ kind: "figure" }, "about ninety")).toBeNull();
    expect(gapValue({ kind: "text" }, "  Lagos  ")).toEqual({
      type: "TEXT",
      text: "Lagos",
    });
    expect(gapValue({ kind: "text" }, "   ")).toBeNull();
  });
});

describe("taxonomyProposal", () => {
  it("shows Q's closest fits for the category step as words, from the pending suggestion", () => {
    const proposal = taxonomyProposal(
      view({
        pendingSuggestions: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            stepKey: "F1.categories",
            targetField: "categories",
            suggestedValue: {
              type: "RESOURCE_REFERENCE",
              resourceType: "TAXONOMY_NODE",
              resourceIds: ["n-log", "n-ent"],
            },
            confidence: "0.9",
            status: "PENDING",
            createdAt: "2026-09-13T10:02:00.000Z",
          },
        ],
      }),
      "F1.categories",
      { "n-log": "Logistics & Mobility", "n-ent": "Enterprise Software" },
    );
    expect(proposal?.nodes).toEqual([
      { nodeId: "n-log", label: "Logistics & Mobility" },
      { nodeId: "n-ent", label: "Enterprise Software" },
    ]);
    expect(taxonomyProposal(view(), "F1.categories", {})).toBeNull();
  });
});

describe("acknowledgeValue", () => {
  it("names the step and the tapped value", () => {
    expect(
      acknowledgeValue(
        "F1.stage",
        { type: "SINGLE_SELECT", optionKey: "seed" },
        VOCABULARY,
      ),
    ).toBe("Stage: seed. Noted.");
  });
});
