import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * The session is the record; the conversation is not
 * (QX-004 core gate: state authority).
 *
 * Live, every provider was down, three answers went nowhere, and on the
 * next turn Q said: "we have your type, which is Angel, and your firm,
 * Zino Aviation." The session held nothing at all. Q had read its own
 * memory of the turns and reported it as the record, and a person told
 * that has been told their onboarding is further along than it is.
 *
 * Two mechanisms, and these drive both.
 *
 * **The runtime writes any account of what is held.** The model says
 * which question was asked; it does not get to answer it. So a progress
 * answer names what the session holds, counts what the session counts,
 * and cannot say otherwise however the question was phrased.
 *
 * **The model is told what was not kept.** An utterance that failed to
 * record becomes a note in the next prompt, so the transcript stops
 * looking like evidence — which is the general fix, and reaches the
 * summaries, resumes and status answers this cannot enumerate.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-22T09:00:00.000Z";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

/** A session holding exactly what `recorded` says, and nothing else. */
function view(recorded: readonly string[]): OnboardingSessionView {
  const all = [
    { stepKey: "I0.investor_type", label: "angel" },
    { stepKey: "I0.organisation_name", label: "Zino Aviation" },
    { stepKey: "I1.cheque", label: "50000" },
  ];
  return {
    session: {
      id: SESSION_ID,
      journeyType: "investor",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: 1,
      status: "ACTIVE",
      subject: null,
      currentStepKey: "I2.sectors",
      version: 5,
      startedAt: NOW,
      lastActivityAt: NOW,
      completedAt: null,
    },
    phases: [],
    currentStep: {
      stepKey: "I2.sectors",
      stepType: "multi_select",
      required: true,
      prompt: "Which sectors do you focus on?",
      presentation: {
        stepType: "multi_select",
        options: [
          { optionKey: "fintech", label: "Fintech" },
          { optionKey: "enterprise", label: "Enterprise software" },
        ],
        minSelections: 1,
        maxSelections: 2,
        exclusiveOptionKeys: [],
      },
    },
    progress: {
      currentStepKey: "I2.sectors",
      currentPhaseKey: null,
      eligibleSteps: all.map((step) => ({
        stepKey: step.stepKey,
        required: true,
        status: recorded.includes(step.stepKey) ? "COMPLETED" : "PENDING",
      })),
      eligibleStepCount: all.length,
      completedEligibleStepCount: recorded.length,
      canGoBack: true,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: all
      .filter((step) => recorded.includes(step.stepKey))
      .map((step, index) => ({
        id: `33333333-3333-4333-8333-00000000000${String(index)}`,
        stepKey: step.stepKey,
        responseType: "TEXT",
        value: { type: "TEXT", text: step.label },
        sourceModality: "TYPED_TEXT",
        createdAt: NOW,
      })),
    pendingQuestions: [],
  } as unknown as OnboardingSessionView;
}

function api(recorded: readonly string[]): typeof fetch {
  return (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes("/taxonomy/")) {
      return Promise.resolve(Response.json({ candidates: [] }));
    }
    return Promise.resolve(Response.json(view(recorded)));
  };
}

const base: InterviewConductorResult = {
  reply: "",
  intent: "QUESTION_FOR_Q",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: null,
  showOptions: false,
  questionForQ: null,
  answerFromState: "PROGRESS",
  navigate: null,
  lookup: null,
  pronounce: null,
};

function gateway(result: InterviewConductorResult): InterviewGateway {
  return {
    execute: () =>
      Promise.resolve({
        output: { kind: "STRUCTURED", value: result },
      } as never),
  };
}

function turn(fetchFake: typeof fetch, utterance: string) {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      fetch: fetchFake,
    },
    onboardingSessionId: SESSION_ID,
    journeyType: "investor" as const,
    channel: "voice" as const,
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      correlationId: "cor_test",
    },
    utterance,
    recentTurns: [
      { role: "person" as const, text: "I'm an angel." },
      { role: "q" as const, text: "Angel, got it." },
      { role: "person" as const, text: "My firm is Zino Aviation." },
    ],
  };
}

/** However somebody asks where they are, the answer comes from the session. */
const PHRASINGS = [
  "where are we so far on onboarding?",
  "How much of this have we done?",
  "what have we covered?",
  "how far along am I?",
  "what's left to do here?",
];

describe("a progress answer comes from the session, not the conversation", () => {
  for (const phrasing of PHRASINGS) {
    it(`says nothing is held when nothing is: "${phrasing}"`, async () => {
      // The model's own prose, read out of the transcript, claiming two
      // answers the session does not have. This is the live defect.
      const interviewer = createInterviewer({
        gateway: gateway({
          ...base,
          reply:
            "So far we have your type, which is Angel, and your firm, Zino Aviation.",
        }),
        logger,
      });
      const outcome = await interviewer.turn(turn(api([]), phrasing));
      expect(outcome.reply).not.toContain("Angel");
      expect(outcome.reply).not.toContain("Zino Aviation");
      expect(outcome.reply).not.toContain("So far we have");
      expect(outcome.reply).toContain("Nothing is on your record yet");
      expect(outcome.reply).toContain("3 to go");
    });
  }

  it("names what the session does hold, and counts it", async () => {
    const interviewer = createInterviewer({
      gateway: gateway({ ...base, reply: "We have done nearly everything." }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(api(["I0.investor_type", "I0.organisation_name"]), "where are we?"),
    );
    expect(outcome.reply).toContain("2 of 3 answered");
    expect(outcome.reply).toContain("1 to go");
    expect(outcome.reply).toContain("Zino Aviation");
    // And the model's own sentence does not survive beside it.
    expect(outcome.reply).not.toContain("nearly everything");
  });

  it("does not read a bare field label out as the question they are on", async () => {
    const bare = api([]);
    const interviewer = createInterviewer({
      gateway: gateway({ ...base, reply: "" }),
      logger,
    });
    const outcome = await interviewer.turn(turn(bare, "where are we?"));
    // This session's current step IS a question, so it is included; the
    // guard is that a label without a question mark never would be.
    expect(outcome.reply).toContain("Which sectors do you focus on");
  });
});

describe("what was said and not kept is carried to the next turn", () => {
  it("tells the model, in the platform's own notes, that it was not recorded", async () => {
    const seen: unknown[] = [];
    const watching: InterviewGateway = {
      execute: (request: unknown) => {
        seen.push(request);
        return Promise.reject(new Error("no configured model is eligible"));
      },
    };
    const interviewer = createInterviewer({ gateway: watching, logger });
    const fetchFake = api([]);

    // A turn with no model route: the utterance goes nowhere.
    const first = await interviewer.turn(
      turn(fetchFake, "I'm an angel, and my firm is Zino Aviation."),
    );
    expect(first.degraded).toBe(true);
    expect(first.recorded).toEqual([]);

    // The next turn's prompt must say so, so that the transcript stops
    // looking like evidence for every surface that reads it.
    await interviewer.turn(turn(fetchFake, "anything else?"));
    const rendered = JSON.stringify(seen);
    expect(rendered).toContain("was NOT recorded");
    expect(rendered).toContain("I'm an angel, and my firm is Zino Aviation.");
  });
});
