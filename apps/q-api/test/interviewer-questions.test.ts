import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * The interview answers questions about itself (QX-004 core gate §8).
 *
 * From the live transcript. Halfway through being asked which sectors
 * they invest in, somebody asked "what sectors and product areas are
 * there?". Q sent the question away to be researched, went quiet for
 * thirty seconds, and then asked "which sectors and product areas?"
 * again as though nothing had been said. The same happened to "where are
 * we so far on this onboarding?".
 *
 * Neither needs looking up. The options are on the step the person is
 * standing on and the progress is on their session — the interview was
 * holding both while it sent somebody away to find them.
 *
 * So the model names which of the two they meant, in a closed field, and
 * the sentence is written here from the authoritative state. Two things
 * follow, and both matter: the answer is true, because no model wrote
 * it; and it arrives with no provider available at all, which is exactly
 * when somebody is most likely to be asking where they have got to.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-22T09:00:00.000Z";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function view(): OnboardingSessionView {
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
      prompt: "Which sectors and product areas do you focus on?",
      presentation: {
        stepType: "multi_select",
        options: [
          { optionKey: "fintech", label: "Fintech" },
          { optionKey: "enterprise", label: "Enterprise software" },
          { optionKey: "health", label: "Health" },
          { optionKey: "climate", label: "Climate" },
        ],
        minSelections: 1,
        maxSelections: 4,
        exclusiveOptionKeys: [],
      },
    },
    progress: {
      currentStepKey: "I2.sectors",
      currentPhaseKey: null,
      eligibleSteps: [
        { stepKey: "I0.investor_type", required: true, status: "COMPLETED" },
        {
          stepKey: "I0.organisation_name",
          required: true,
          status: "COMPLETED",
        },
        { stepKey: "I1.cheque", required: true, status: "COMPLETED" },
        { stepKey: "I2.sectors", required: true, status: "IN_PROGRESS" },
        { stepKey: "I3.geography", required: true, status: "PENDING" },
      ],
      eligibleStepCount: 5,
      completedEligibleStepCount: 3,
      canGoBack: true,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [
      {
        id: "33333333-3333-4333-8333-333333333331",
        stepKey: "I0.investor_type",
        responseType: "SINGLE_SELECT",
        value: { type: "SINGLE_SELECT", optionKey: "angel" },
        sourceModality: "TYPED_TEXT",
        createdAt: NOW,
      },
    ],
    pendingQuestions: [],
  } as unknown as OnboardingSessionView;
}

const api: typeof fetch = (input) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes("/taxonomy/")) {
    return Promise.resolve(Response.json({ candidates: [] }));
  }
  return Promise.resolve(Response.json(view()));
};

const base: InterviewConductorResult = {
  reply: "Of course.",
  intent: "QUESTION_FOR_Q",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: null,
  showOptions: false,
  questionForQ: null,
  answerFromState: null,
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

function turn(utterance: string) {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      fetch: api,
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
    recentTurns: [],
  };
}

describe("QX-004 core gate §8 · questions the interview can answer itself", () => {
  it("names the choices on the step instead of sending the question away", async () => {
    const interviewer = createInterviewer({
      gateway: gateway({ ...base, answerFromState: "OPTIONS" }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn("what sectors and product areas are there?"),
    );
    expect(outcome.reply).toContain("Fintech");
    expect(outcome.reply).toContain("Enterprise software");
    expect(outcome.reply).toContain("Climate");
    // Nothing is looked up, so nothing waits thirty seconds for a run.
    expect(outcome.questionForQ).toBeNull();
    // And it does not pretend the question answered the field.
    expect(outcome.recorded).toEqual([]);
  });

  it("says how far along they are, counted from the session", async () => {
    const interviewer = createInterviewer({
      gateway: gateway({ ...base, answerFromState: "PROGRESS" }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn("where are we so far on this onboarding?"),
    );
    expect(outcome.reply).toContain("3 of 5 answered");
    expect(outcome.reply).toContain("2 to go");
    expect(outcome.reply).toContain("Which sectors and product areas");
    expect(outcome.questionForQ).toBeNull();
    expect(outcome.recorded).toEqual([]);
  });

  it("still sends a real question away to be looked up", async () => {
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        answerFromState: null,
        questionForQ: "What does pre-seed usually mean?",
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn("what does pre-seed usually mean?"),
    );
    expect(outcome.questionForQ).toBe("What does pre-seed usually mean?");
  });
});
