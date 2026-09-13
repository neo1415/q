import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import {
  acknowledge,
  looksLikeQuestionForQ,
  progressLines,
  promptFor,
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
  describe: (_stepKey, value) => JSON.stringify(value),
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
  });
});

describe("welcomeBack", () => {
  it("greets from persisted state only: settled groups, documents, what remains", () => {
    expect(welcomeBack(view(), VOCABULARY)).toBe(
      "Welcome back. We already covered evidence. Your document is on file. 2 questions left.",
    );
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
});
