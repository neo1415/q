import { describe, expect, it } from "vitest";

import type {
  OnboardingSessionView,
  OnboardingStepView,
  OnboardingSuggestionView,
} from "@capital-q/contracts";

import {
  acknowledgeValue,
  gapValue,
  hasFindingsFrom,
  composerHint,
  documentReading,
  documentReadingNote,
  uploadFindingsNote,
  sameFileAs,
  alreadyHaveLine,
  contentHashOf,
  nothingNewLine,
  resumedThread,
  keptAllLine,
  keepFailedLine,
  pickedUp,
  stillWaiting,
  pendingQuestion,
  confirmChipLabel,
  keepListedThenConfirm,
  notKeptLine,
  questionShown,
  questionAfterTap,
  questionText,
  reviewShown,
  questionOnReturn,
  redrawnThread,
  progressLines,
  promptFor,
  promptStepOf,
  publicSourceOf,
  RESUME_AFTER_MS,
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

describe("the options under Q's words follow Q's question (owner 2026-10-21)", () => {
  const raising: OnboardingStepView = {
    stepKey: "F6.raising",
    stepType: "single_select",
    required: true,
    prompt: "Are you raising now?",
    presentation: {
      stepType: "single_select",
      options: [
        { optionKey: "yes", label: "Yes, now" },
        { optionKey: "soon", label: "In the next six months" },
      ],
    },
  } as unknown as OnboardingStepView;

  it("shows the step Q asked, not the form cursor's, while it is open", () => {
    const step = promptStepOf(view(), raising);
    expect(step?.stepKey).toBe("F6.raising");
    expect(
      promptFor(step as OnboardingStepView, VOCABULARY).chips,
    ).toHaveLength(2);
  });

  it("falls back to the cursor once Q's question is answered, or with none", () => {
    const answered = view({
      progress: {
        ...view().progress,
        eligibleSteps: view().progress.eligibleSteps.map((row) =>
          row.stepKey === "F6.raising" ? { ...row, status: "COMPLETED" } : row,
        ),
      },
    });
    expect(promptStepOf(answered, raising)?.stepKey).toBe("F1.stage");
    expect(promptStepOf(view(), null)?.stepKey).toBe("F1.stage");
  });
});

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

describe("pendingQuestion: a reload redraws, it does not re-open", () => {
  const at = (iso: string) => iso;
  const asked = {
    role: "Q" as const,
    text: "What's a typical cheque for you?",
    createdAt: at("2026-09-24T22:03:00.000Z"),
  };

  it("Q's last line is still the question when nothing moved since", () => {
    expect(pendingQuestion([asked], "2026-09-24T22:02:59.000Z")).toBe(
      "What's a typical cheque for you?",
    );
    expect(pendingQuestion([asked], asked.createdAt)).toBe(
      "What's a typical cheque for you?",
    );
  });

  it("an answer, tap or skip after Q spoke means Q opens again", () => {
    expect(pendingQuestion([asked], "2026-09-24T22:05:00.000Z")).toBeNull();
  });

  it("a thread that ends on the person, or no thread, is not pending", () => {
    expect(
      pendingQuestion(
        [
          asked,
          {
            role: "PERSON",
            text: "fifty thousand",
            createdAt: "2026-09-24T22:04:00.000Z",
          },
        ],
        "2026-09-24T22:02:00.000Z",
      ),
    ).toBeNull();
    expect(pendingQuestion([], "2026-09-24T22:02:00.000Z")).toBeNull();
  });

  it("an unreadable time is never taken as 'nothing moved'", () => {
    expect(pendingQuestion([asked], "not a time")).toBeNull();
  });

  it("a kept acknowledgement of a tap is not a question on the table (QA F-129)", () => {
    const tapped = [
      asked,
      {
        role: "PERSON" as const,
        text: "Seed",
        createdAt: "2026-09-24T22:03:10.000Z",
      },
      {
        role: "Q" as const,
        text: "Stage: Seed. Noted.",
        createdAt: "2026-09-24T22:03:11.000Z",
      },
    ];
    expect(pendingQuestion(tapped, "2026-09-24T22:03:09.000Z")).toBeNull();
    // What Q says to stop is still the line on the table (pause honoured).
    expect(
      pendingQuestion(
        [{ ...asked, text: "Understood, we'll stop here." }],
        "2026-09-24T22:02:59.000Z",
      ),
    ).toBe("Understood, we'll stop here.");
  });
});

describe("questionOnReturn: a line said before an absence is history (live 25 Oct e2e)", () => {
  const stop = {
    role: "Q" as const,
    text: "Understood, we'll stop here.",
    createdAt: "2026-10-25T17:03:10.000Z",
  };
  const lastActivity = "2026-10-25T17:03:09.000Z";

  it("is still the question on a reload soon after", () => {
    expect(
      questionOnReturn(
        [stop],
        lastActivity,
        Date.parse("2026-10-25T17:20:00Z"),
      ),
    ).toBe("Understood, we'll stop here.");
  });

  it("is not the question hours later: it stays above the welcome and Q opens afresh", () => {
    expect(
      questionOnReturn(
        [stop],
        lastActivity,
        Date.parse("2026-10-25T19:30:00Z"),
      ),
    ).toBeNull();
  });

  it("the opening Q just said after the absence is the question on the next reload", () => {
    const opener = {
      role: "Q" as const,
      text: "What early signal do you have?",
      createdAt: "2026-10-25T19:30:05.000Z",
    };
    expect(
      questionOnReturn(
        [stop, opener],
        lastActivity,
        Date.parse("2026-10-25T19:31:00Z"),
      ),
    ).toBe("What early signal do you have?");
  });
});

describe("a tapped answer moves the question on (QA F-131, 25 Oct)", () => {
  const opener = {
    stepKey: "F2.stage",
    text: "Picking up where we left off. What stage is the company at?",
    sticky: true,
  };
  const next = { stepKey: "F2.role", text: "What's your role?" };

  it("Q's opening stays on screen while the session settles (the case it exists for)", () => {
    expect(questionShown(next, opener, false)).toBe(opener.text);
  });

  it("after a tap, the step the session moved to asks its own question", () => {
    expect(questionShown(next, questionAfterTap(), false)).toBe(
      "What's your role?",
    );
  });

  it("a silent step still shows nothing of its own", () => {
    expect(
      questionShown(
        { stepKey: "I1.mandate_context", text: "Which mandate?" },
        questionAfterTap(),
        true,
      ),
    ).toBeNull();
  });
});

describe("a confirmation shows what it confirms (QA F-130, 25 Oct)", () => {
  it("is shown while Q asks to confirm, opened or not", () => {
    expect(reviewShown(false, { control: "confirm" })).toBe(true);
  });
  it("is otherwise shown only when opened", () => {
    expect(reviewShown(false, { control: "chips" })).toBe(false);
    expect(reviewShown(true, { control: "chips" })).toBe(true);
    expect(reviewShown(false, null)).toBe(false);
  });
});

describe('a label-only step is asked as a question (QA 25 Oct: "Website" after a tap)', () => {
  const vocabulary = { stepTitle: (key: string) => key };
  it("after a tap, the next label-only step shows its phrased question", () => {
    const next = {
      stepKey: "F1.website",
      text: questionText(
        { stepKey: "F1.website", prompt: "Website" },
        vocabulary,
      ),
    };
    expect(questionShown(next, questionAfterTap(), false)).toBe(
      "What's your website?",
    );
  });
  it("a prompt that already asks is kept as it is", () => {
    expect(
      questionText(
        { stepKey: "F1.website", prompt: "Where can investors see it?" },
        vocabulary,
      ),
    ).toBe("Where can investors see it?");
    expect(
      questionText({ stepKey: "X.unknown", prompt: "Team" }, vocabulary),
    ).toBe("Team");
  });
});

describe('"That\'s right" keeps exactly the readings on screen (QA F-130, decision A)', () => {
  const listed = [
    { id: "r1", label: "Paying customers" },
    { id: "r2", label: "Instrument" },
  ];

  it("says what it keeps, and how many", () => {
    expect(confirmChipLabel("That's right", 0)).toBe("That's right");
    expect(confirmChipLabel("That's right", 1)).toBe(
      "That's right, keep this one",
    );
    expect(confirmChipLabel("That's right", 5)).toBe(
      "That's right, keep all 5",
    );
  });

  it("keeps the rendered set, never a reading that arrived after, then confirms", async () => {
    const kept: string[] = [];
    let confirmed = 0;
    // r3 landed after the confirmation was shown: waiting, but not listed.
    const waiting = new Set(["r1", "r2", "r3"]);
    const outcome = await keepListedThenConfirm({
      listed,
      stillWaiting: (id) => waiting.has(id),
      keep: (id) => {
        kept.push(id);
        return Promise.resolve(true);
      },
      confirm: () => {
        confirmed += 1;
        return Promise.resolve();
      },
    });
    expect(kept).toEqual(["r1", "r2"]);
    expect(confirmed).toBe(1);
    expect(outcome).toEqual({ confirmed: true, failed: [] });
  });

  it("one settled elsewhere is not kept twice", async () => {
    const kept: string[] = [];
    await keepListedThenConfirm({
      listed,
      stillWaiting: (id) => id !== "r1",
      keep: (id) => {
        kept.push(id);
        return Promise.resolve(true);
      },
      confirm: () => Promise.resolve(),
    });
    expect(kept).toEqual(["r2"]);
  });

  it("a partial failure leaves the summary unconfirmed and names what didn't keep", async () => {
    let confirmed = 0;
    const outcome = await keepListedThenConfirm({
      listed,
      stillWaiting: () => true,
      keep: (id) => Promise.resolve(id === "r1"),
      confirm: () => {
        confirmed += 1;
        return Promise.resolve();
      },
    });
    expect(confirmed).toBe(0);
    expect(outcome).toEqual({ confirmed: false, failed: ["Instrument"] });
    expect(notKeptLine(outcome.failed)).toBe(
      "Instrument didn't go through, so I haven't confirmed the summary yet. It's still waiting below.",
    );
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

/**
 * Q's side of the conversation is Q's (QX-004 core gate: one Q).
 *
 * This file used to assert the browser's own acknowledgements -- "Stage:
 * Seed. Noted." -- which was the second conversational implementation in
 * prose form. There is nothing here to assert now: the interviewer writes
 * the reply and the screen shows it as written. What the module still owns
 * is the deterministic vocabulary around it, tested above and below.
 */

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
            sourceRefs: [],
            rationale: null,
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

describe("publicSourceOf", () => {
  const suggestion = (
    sourceRefs: OnboardingSuggestionView["sourceRefs"],
  ): OnboardingSuggestionView => ({
    id: "99999999-9999-4999-8999-999999999999",
    stepKey: "I1.check_size",
    targetField: "checkSize",
    suggestedValue: { type: "TEXT", text: "$250k" },
    confidence: null,
    status: "PENDING",
    sourceRefs,
    rationale: null,
    createdAt: "2026-09-13T10:02:00.000Z",
  });

  it("links the first public page the suggestion was read from, labelled by its kind", () => {
    expect(
      publicSourceOf(
        suggestion([
          { sourceType: "USER_UTTERANCE", sourceId: "turn-1" },
          {
            sourceType: "PUBLIC_WEBSITE",
            sourceId: "https://fund.example/team",
          },
          { sourceType: "PUBLIC_WEB", sourceId: "https://news.example/a" },
        ]),
      ),
    ).toEqual({
      url: "https://fund.example/team",
      label: "From your website",
    });
    expect(
      publicSourceOf(
        suggestion([
          {
            sourceType: "PUBLIC_REGISTRY",
            sourceId: "http://registry.example/1",
          },
        ]),
      ),
    ).toEqual({
      url: "http://registry.example/1",
      label: "From a public registry",
    });
  });

  it("is null for the person's own words and for anything that is not a web page", () => {
    expect(publicSourceOf(suggestion([]))).toBeNull();
    expect(
      publicSourceOf(
        suggestion([
          { sourceType: "USER_UTTERANCE", sourceId: "https://x.example" },
        ]),
      ),
    ).toBeNull();
    expect(
      publicSourceOf(
        suggestion([
          { sourceType: "PUBLIC_PROFILE", sourceId: "javascript:alert(1)" },
          { sourceType: "PUBLIC_WEB", sourceId: "not a url" },
        ]),
      ),
    ).toBeNull();
  });
});

describe("QA F-69: a deck is read back only once Q's findings from it are in", () => {
  const DOC = "d1000000-0000-4000-8000-000000000001";
  const suggestion = (sourceId: string) =>
    ({
      sourceRefs: [{ sourceType: "EVIDENCE_DOCUMENT", sourceId }],
    }) as unknown as OnboardingSessionView["pendingSuggestions"][number];
  it("sees findings from this document only", () => {
    expect(hasFindingsFrom(undefined, DOC)).toBe(false);
    expect(hasFindingsFrom({ pendingSuggestions: [] }, DOC)).toBe(false);
    expect(
      hasFindingsFrom(
        {
          pendingSuggestions: [
            suggestion("d2000000-0000-4000-8000-000000000002"),
          ],
        },
        DOC,
      ),
    ).toBe(false);
    expect(
      hasFindingsFrom({ pendingSuggestions: [suggestion(DOC)] }, DOC),
    ).toBe(true);
  });
});

describe("a reload redraws the thread once (QA F-50)", () => {
  const turns = [
    { role: "Q" as const, text: "What's the name of your firm?" },
    { role: "PERSON" as const, text: "Benali Atlas Capital." },
    { role: "Q" as const, text: "Got it. Are you deploying capital now?" },
  ];

  it("leaves out Q's last line while it is the question on the table", () => {
    expect(
      redrawnThread(turns, "Got it. Are you deploying capital now?"),
    ).toEqual(turns.slice(0, 2));
  });

  it("keeps everything when Q opens again, or the thread ends on them", () => {
    expect(redrawnThread(turns, null)).toEqual(turns);
    const theirs = turns.slice(0, 2);
    expect(redrawnThread(theirs, "anything")).toEqual(theirs);
  });
});

describe("the composer's hint follows Q's question (live 24 Oct)", () => {
  const website = {
    stepKey: "I0.website",
    control: "text" as const,
    placeholder: "example.com",
  };

  it("is the step's own hint while Q asks that step", () => {
    expect(composerHint(website, ["I0.website"])).toBe("example.com");
    expect(composerHint(website, null)).toBe("example.com");
  });

  it("stays neutral when Q asks another step, or one a reload cannot name", () => {
    expect(composerHint(website, ["I1.deployment_status"])).toBe(
      "Type your answer",
    );
    expect(composerHint(website, [])).toBe("Type your answer");
  });

  it("is an answer's hint, never the general one, for a step without its own (live 25 Oct)", () => {
    const description = {
      stepKey: "F1.description",
      control: "text" as const,
      placeholder: undefined,
    };
    expect(composerHint(description, ["F1.description"])).toBe(
      "Type your answer",
    );
    expect(composerHint({ ...description, placeholder: "" }, null)).toBe(
      "Type your answer",
    );
  });
});

describe("Keep all (live 25 Oct e2e)", () => {
  it("says all kept only when every one went through", () => {
    expect(keptAllLine([true, true, true])).toBe("All kept. Thank you.");
    expect(keptAllLine([true, false, true])).toBe(
      "Kept 2; one didn't go through. It's still waiting below.",
    );
    expect(keptAllLine([true, false, false])).toBe(
      "Kept 1; 2 didn't go through. They're still waiting below.",
    );
  });

  it("says nothing when nothing was kept: the failure is already on screen", () => {
    expect(keptAllLine([false, false])).toBeNull();
    expect(keptAllLine([])).toBeNull();
  });

  it("keeps only offers still waiting, never one already retired", () => {
    const view = {
      pendingSuggestions: [
        { id: "s-1", status: "PENDING" },
        { id: "s-2", status: "EXPIRED" },
      ],
    } as never;
    expect(stillWaiting(view, "s-1")).toBe(true);
    expect(stillWaiting(view, "s-2")).toBe(false);
    expect(stillWaiting(view, "s-3")).toBe(false);
    expect(stillWaiting(undefined, "s-1")).toBe(false);
  });
});

describe("the same file uploaded again is not sent twice (live e2e 25 Oct)", () => {
  const files = [
    { id: "doc-1", filename: "deck.pdf", sha256: "a".repeat(64) },
    { id: "doc-2", filename: "one-pager.pdf", sha256: undefined },
  ];
  it("is matched by its content hash only", () => {
    expect(sameFileAs(files, "a".repeat(64))?.id).toBe("doc-1");
    expect(sameFileAs(files, "b".repeat(64))).toBeUndefined();
  });
  it("Q says it already has it, by the name it was shared under", () => {
    expect(alreadyHaveLine("deck.pdf", "deck.pdf")).toBe(
      "I already have deck.pdf, so there's nothing new to read.",
    );
    expect(alreadyHaveLine("deck (1).pdf", "deck.pdf")).toBe(
      "I already have that file as deck.pdf, so there's nothing new to read.",
    );
  });
  it("hashes the bytes as the document store records them", async () => {
    const bytes = new TextEncoder().encode("Tamarind Ledger");
    const { createHash } = await import("node:crypto");
    expect(await contentHashOf(new Blob([bytes]))).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });
});

describe("a re-uploaded deck that adds nothing new (live e2e 25 Oct)", () => {
  const offer = (documentId: string) => ({
    sourceRefs: [{ sourceType: "EVIDENCE_DOCUMENT", sourceId: documentId }],
  });
  it("is still being read until its review finishes", () => {
    expect(documentReading({ pendingSuggestions: [] }, "doc-1")).toBe(
      "READING",
    );
    expect(documentReading(undefined, "doc-1")).toBe("READING");
  });
  it("is said to add nothing new once reviewed with nothing from it waiting", () => {
    expect(
      documentReading(
        { pendingSuggestions: [], reviewedDocumentIds: ["doc-1"] },
        "doc-1",
      ),
    ).toBe("NOTHING_NEW");
    expect(nothingNewLine("deck.pdf")).toBe(
      "I've read deck.pdf. It adds nothing new beyond what's already recorded.",
    );
  });
  it("reads its findings back when any came from it, reviewed or not", () => {
    expect(
      documentReading(
        {
          pendingSuggestions: [offer("doc-1")],
          reviewedDocumentIds: ["doc-1"],
        } as never,
        "doc-1",
      ),
    ).toBe("FOUND");
    // Another document's review says nothing about this one.
    expect(
      documentReading(
        { pendingSuggestions: [], reviewedDocumentIds: ["doc-2"] },
        "doc-1",
      ),
    ).toBe("READING");
  });
  it("says plainly what it could not read (deck reading 2026-10-28)", () => {
    const view = {
      documentNotes: [
        { documentId: "doc-1", unreadPages: 3, truncated: false },
        { documentId: "doc-2", unreadPages: 1, truncated: true },
      ],
    };
    expect(documentReadingNote(view, "doc-1")).toBe(
      "3 pages were images I couldn't read.",
    );
    expect(documentReadingNote(view, "doc-2")).toBe(
      "1 page was an image I couldn't read. It was too long to read in full; I read the first part.",
    );
    expect(documentReadingNote(view, "doc-3")).toBeNull();
    expect(documentReadingNote(undefined, "doc-1")).toBeNull();
    expect(
      uploadFindingsNote(
        "deck.pdf",
        "NOTHING_NEW",
        [],
        "3 pages were images I couldn't read.",
      ),
    ).toContain("Q could not read all of it: 3 pages were images");
  });
});

describe("the thread after a reload keeps the order things were said (live 25 Oct e2e)", () => {
  it("puts the welcome back after the restored history, before anything unsent", () => {
    expect(
      resumedThread(["earlier Q", "earlier you"], ["welcome back"], ["unsent"]),
    ).toEqual(["earlier Q", "earlier you", "welcome back", "unsent"]);
    expect(resumedThread([], ["welcome back"], [])).toEqual(["welcome back"]);
    expect(resumedThread(["earlier"], [], [])).toEqual(["earlier"]);
  });
});

describe("live 2026-10-30 (Granary): Q's summary of their words is said in the conversation, not on the card", () => {
  const held = (
    id: string,
    rationale: string | null,
  ): OnboardingSuggestionView => ({
    id,
    stepKey: "F1.description",
    targetField: "f1.description",
    suggestedValue: { type: "TEXT", text: "Grain stock tracking for co-ops." },
    confidence: null,
    status: "PENDING",
    sourceRefs: [{ sourceType: "Q_RECOMMENDATION", sourceId: "interview" }],
    rationale,
    createdAt: "2026-10-30T17:51:47.000Z",
  });

  it("the card lists document and research findings, never a summary held for their yes in the conversation", () => {
    const shown = pickedUp(
      {
        ...view(),
        pendingSuggestions: [
          held(
            "a1000000-0000-4000-8000-000000000001",
            'Q\'s summary of your words: "So basically, um, what we do is…"',
          ),
          held(
            "a1000000-0000-4000-8000-000000000002",
            'Q\'s summary of their words: "we help small grain co-ops"',
          ),
          held(
            "a1000000-0000-4000-8000-000000000003",
            "found in their uploaded document",
          ),
        ],
      },
      VOCABULARY,
    );
    expect(shown.map((item) => item.suggestion.id)).toEqual([
      "a1000000-0000-4000-8000-000000000003",
    ]);
  });

  it("a Keep that did not go through is said, never silent", () => {
    expect(keepFailedLine("The Problem")).toBe(
      "The Problem didn't go through, so it isn't saved yet. Have another look at what's waiting and keep it again.",
    );
  });
});
