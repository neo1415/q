import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * Research-assisted onboarding (QX-004 §1.1, §1.2, §1.5, §1.6).
 *
 * Once Q knows what the journey is about, it should go and read the
 * public web rather than making somebody type what is already published.
 * The mechanism is the lookup path the model already has — same tools,
 * same egress policy, same treatment of a page's text as data — fired by
 * the runtime instead of waiting to be asked.
 *
 * Three properties matter, and they are the ones a proactive lookup gets
 * wrong if nobody holds it to them:
 *
 * **It happens once.** Research costs somebody's budget, and a person who
 * has heard what the web says about their company does not need to hear
 * it again on the next turn.
 *
 * **It is about the subject, never the person.** A founder's company and
 * an investor's organisation; a name is not a research subject.
 *
 * **It never displaces the person.** A question they actually asked wins.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-22T09:00:00.000Z";
const BEARER = "eyPRIVATE.NEVER-EMITTED.bearer";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function view(options: {
  readonly journeyType: "founder" | "investor";
  readonly responses: readonly { stepKey: string; text: string }[];
}): OnboardingSessionView {
  return {
    session: {
      id: SESSION_ID,
      journeyType: options.journeyType,
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: options.journeyType === "founder" ? 2 : 1,
      status: "ACTIVE",
      subject: null,
      currentStepKey: "F1.stage",
      version: 3,
      startedAt: NOW,
      lastActivityAt: NOW,
      completedAt: null,
    },
    phases: [],
    currentStep: {
      stepKey: "F1.stage",
      stepType: "single_select",
      required: true,
      prompt: "What stage is the company at?",
      presentation: {
        stepType: "single_select",
        options: [
          { optionKey: "seed", label: "Seed" },
          { optionKey: "series_a", label: "Series A" },
        ],
      },
    },
    progress: {
      currentStepKey: "F1.stage",
      currentPhaseKey: null,
      eligibleSteps: [
        { stepKey: "F1.stage", required: true, status: "IN_PROGRESS" },
      ],
      eligibleStepCount: 1,
      completedEligibleStepCount: 0,
      canGoBack: false,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: options.responses.map((r, index) => ({
      id: `33333333-3333-4333-8333-00000000000${String(index)}`,
      stepKey: r.stepKey,
      responseType: "TEXT",
      value: { type: "TEXT", text: r.text },
      sourceModality: "TYPED_TEXT",
      createdAt: NOW,
    })),
    pendingQuestions: [],
  } as unknown as OnboardingSessionView;
}

function api(current: () => OnboardingSessionView): typeof fetch {
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
    return Promise.resolve(Response.json(current()));
  };
}

const quiet: InterviewConductorResult = {
  reply: "Seed, got it.",
  intent: "ANSWER",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: null,
  showOptions: false,
  questionForQ: null,
  navigate: null,
  lookup: null,
  pronounce: null,
};

function gateway(
  ...results: readonly InterviewConductorResult[]
): InterviewGateway {
  const queue = [...results];
  return {
    execute: () =>
      Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: queue.shift() ?? quiet,
        },
      } as never),
  };
}

function turn(fetchFake: typeof fetch, journeyType: "founder" | "investor") {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: BEARER,
      fetch: fetchFake,
    },
    onboardingSessionId: SESSION_ID,
    journeyType,
    channel: "voice" as const,
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      correlationId: "cor_test",
    },
    utterance: "We're at seed",
    recentTurns: [],
  };
}

describe("QX-004 §1 · Q looks the subject up once it is named", () => {
  it("researches a founder's company as soon as the name is recorded", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "founder",
        responses: [{ stepKey: "F1.company_name", text: "Zino Aviation" }],
      }),
    );
    const interviewer = createInterviewer({ gateway: gateway(), logger });
    const outcome = await interviewer.turn(turn(fetchFake, "founder"));

    expect(outcome.questionForQ).not.toBeNull();
    expect(outcome.questionForQ).toContain("Zino Aviation");
    // Presented for confirmation, never as fact: the lookup itself says so.
    expect(outcome.questionForQ).toContain("unverified public context");
  });

  it("prefers the website when the founder has given one", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "founder",
        responses: [
          { stepKey: "F1.company_name", text: "Zino Aviation" },
          { stepKey: "F1.website", text: "zinoaviation.com" },
        ],
      }),
    );
    const interviewer = createInterviewer({ gateway: gateway(), logger });
    const outcome = await interviewer.turn(turn(fetchFake, "founder"));
    expect(outcome.questionForQ).toContain("zinoaviation.com");
  });

  it("researches an investor's organisation, and never the person", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "investor",
        responses: [
          { stepKey: "I0.organisation_name", text: "Meridian Ventures" },
          { stepKey: "I0.business_title", text: "Joe" },
        ],
      }),
    );
    const interviewer = createInterviewer({ gateway: gateway(), logger });
    const outcome = await interviewer.turn(turn(fetchFake, "investor"));
    expect(outcome.questionForQ).toContain("Meridian Ventures");
    // Person ≠ Investor Organisation. Their name is not a research subject.
    expect(outcome.questionForQ).not.toContain("Joe");
  });

  it("does it once, not on every turn", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "founder",
        responses: [{ stepKey: "F1.company_name", text: "Zino Aviation" }],
      }),
    );
    const interviewer = createInterviewer({ gateway: gateway(), logger });
    const first = await interviewer.turn(turn(fetchFake, "founder"));
    const second = await interviewer.turn(turn(fetchFake, "founder"));
    expect(first.questionForQ).not.toBeNull();
    expect(second.questionForQ).toBeNull();
  });

  it("says nothing to look up before the subject is named", async () => {
    const fetchFake = api(() =>
      view({ journeyType: "founder", responses: [] }),
    );
    const interviewer = createInterviewer({ gateway: gateway(), logger });
    const outcome = await interviewer.turn(turn(fetchFake, "founder"));
    expect(outcome.questionForQ).toBeNull();
  });

  it("never displaces a question the person actually asked", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "founder",
        responses: [{ stepKey: "F1.company_name", text: "Zino Aviation" }],
      }),
    );
    const asked: InterviewConductorResult = {
      ...quiet,
      intent: "QUESTION_FOR_Q",
      questionForQ: "What does Series A usually mean?",
    };
    const interviewer = createInterviewer({
      gateway: gateway(asked),
      logger,
    });
    const outcome = await interviewer.turn(turn(fetchFake, "founder"));
    expect(outcome.questionForQ).toBe("What does Series A usually mean?");
  });
});
