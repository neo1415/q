import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * Research is intentional (CQ-QX-005 §11, §13, §16).
 *
 * The interview used to look the subject up on the first turn after its
 * name landed, whatever that turn was — which is how "what else should I
 * look for?" sent Q to the public web about the person's own organisation.
 * A named subject's public presence is read detached, off the committed
 * response, by the presence path. In the conversation, research runs only
 * when the person asks for something real, named and current; never on an
 * answer turn; never over a transport that cannot carry it; never once the
 * route has shown itself to be down — and when it runs, the conversation
 * knows where to return to.
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
  answerFromState: null,
  skipRemainingOptional: false,
  unrestricted: [],
  frustrated: false,
  reading: null,
  delivery: null,
  offered: [],
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

describe("CQ-QX-005 §11 · research runs only when asked for", () => {
  it("does not research the subject just because its name was recorded", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "investor",
        responses: [{ stepKey: "I0.organisation_name", text: "Zino Aviation" }],
      }),
    );
    const interviewer = createInterviewer({ gateway: gateway(), logger });
    const first = await interviewer.turn(turn(fetchFake, "investor"));
    const second = await interviewer.turn(turn(fetchFake, "investor"));
    expect(first.questionForQ).toBeNull();
    expect(first.researching).toBeNull();
    expect(second.questionForQ).toBeNull();
  });

  it("runs for a real-world example the person asks for, and knows where to return to", async () => {
    const fetchFake = api(() =>
      view({
        journeyType: "investor",
        responses: [{ stepKey: "I0.organisation_name", text: "Zino Aviation" }],
      }),
    );
    const asks: InterviewConductorResult = {
      ...quiet,
      reply: "Let me look for one.",
      intent: "QUESTION_FOR_Q",
      questionForQ:
        "Give an example of a real aviation-focused investor with a similar profile.",
      askNext: null,
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        references: [],
        qualitative: [],
        question: {
          kind: "REAL_WORLD_EXAMPLE",
          text: "Can you give me an example of a real investor similar to me?",
        },
        suggestions: [],
        tensions: [],
        clears: [],
      },
    };
    const interviewer = createInterviewer({
      gateway: gateway({ ...quiet, askNext: "F1.stage" }, asks),
      logger,
    });
    // Q asks the stage first, so there is an open question to come back to.
    await interviewer.turn(turn(fetchFake, "founder"));
    const outcome = await interviewer.turn(turn(fetchFake, "founder"));
    expect(outcome.questionForQ).toContain("aviation-focused investor");
    expect(outcome.researching).toContain("real investor similar to me");
    expect(outcome.resume?.stepKey).toBe("F1.stage");
    expect(outcome.recorded).toEqual([]);
    expect(interviewer.conversation(SESSION_ID).research?.resumeTopic).toBe(
      "F1.stage",
    );
  });

  it("carries a typed request for a real example to the surface, and lets the next typed turn look again", async () => {
    const fetchFake = api(() =>
      view({ journeyType: "investor", responses: [] }),
    );
    const asks: InterviewConductorResult = {
      ...quiet,
      reply: "Let me look for one.",
      intent: "QUESTION_FOR_Q",
      questionForQ: "a real aviation investor with a similar profile",
      askNext: null,
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        references: [],
        qualitative: [],
        question: {
          kind: "REAL_WORLD_EXAMPLE",
          text: "a real investor like me?",
        },
        suggestions: [],
        tensions: [],
        clears: [],
      },
    };
    const interviewer = createInterviewer({
      gateway: gateway({ ...quiet, askNext: "F1.stage" }, asks, asks),
      logger,
    });
    const typed = (utterance: string) =>
      interviewer.turn({
        ...turn(fetchFake, "founder"),
        channel: "text",
        utterance,
      });
    await typed("We're at seed");
    const first = await typed("a real investor like me?");
    expect(first.researching).toContain("a real investor like me");
    // The surface answered it before the person typed again; the next
    // typed request is not refused as "already running".
    const second = await typed("and another one?");
    expect(second.researching).not.toBeNull();
    expect(second.trace?.research).toMatchObject({ run: true });
  });

  it("never promises a look-up in a deployment that cannot research", async () => {
    const fetchFake = api(() =>
      view({ journeyType: "investor", responses: [] }),
    );
    const asks: InterviewConductorResult = {
      ...quiet,
      reply: "I'll look that up.",
      intent: "QUESTION_FOR_Q",
      questionForQ: "Who are the active aviation investors right now?",
      askNext: null,
    };
    const interviewer = createInterviewer({
      gateway: gateway({ ...quiet, askNext: "F1.stage" }, asks),
      logger,
      research: { available: () => false },
    });
    await interviewer.turn({ ...turn(fetchFake, "founder"), channel: "text" });
    const typed = await interviewer.turn({
      ...turn(fetchFake, "founder"),
      channel: "text",
    });
    expect(typed.questionForQ).toBeNull();
    expect(typed.researching).toBeNull();
    expect(typed.reply).toMatch(/live research isn't reachable/i);
    // And the conversation comes back to the question that was open.
    expect(typed.reply).toContain("What stage is the company at");
    expect(typed.asking?.stepKey).toBe("F1.stage");
  });

  it("keeps Q's own answer when research is out of reach, and returns to the open question", async () => {
    const fetchFake = api(() =>
      view({ journeyType: "investor", responses: [] }),
    );
    // A model that did what the platform told it: no look-up promised,
    // an answer from general knowledge, the question left open.
    const answered: InterviewConductorResult = {
      ...quiet,
      reply:
        "I can't reach live sources from here, but in general aviation-focused funds tend to back asset-light models. Back to it — what stage is the company at?",
      intent: "QUESTION_FOR_Q",
      questionForQ: null,
      askNext: null,
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        references: [],
        qualitative: [],
        question: {
          kind: "REAL_WORLD_EXAMPLE",
          text: "Who invests in aviation startups like mine?",
        },
        suggestions: [],
        tensions: [],
        clears: [],
      },
    };
    const interviewer = createInterviewer({
      gateway: gateway({ ...quiet, askNext: "F1.stage" }, answered),
      logger,
      research: { available: () => false },
    });
    await interviewer.turn({ ...turn(fetchFake, "founder"), channel: "text" });
    const typed = await interviewer.turn({
      ...turn(fetchFake, "founder"),
      channel: "text",
    });
    expect(typed.reply).toBe(answered.reply);
    expect(typed.questionForQ).toBeNull();
    expect(typed.researching).toBeNull();
    expect(typed.recorded).toEqual([]);
    expect(typed.trace?.research).toEqual({
      run: false,
      because: "UNAVAILABLE",
    });
    expect(typed.asking?.stepKey).toBe("F1.stage");
    // Nothing is waiting on a look-up that will never come back.
    expect(interviewer.conversation(SESSION_ID).research).toBeNull();
  });

  it("stops sending people to a research route that keeps failing", async () => {
    const fetchFake = api(() =>
      view({ journeyType: "investor", responses: [] }),
    );
    const asks: InterviewConductorResult = {
      ...quiet,
      reply: "Let me look.",
      intent: "QUESTION_FOR_Q",
      questionForQ: "Who are the active aviation investors right now?",
      askNext: null,
    };
    // This file's gateway is a queue that falls back to a quiet answer:
    // the same request three times over.
    const interviewer = createInterviewer({
      gateway: gateway(asks, asks, asks),
      logger,
    });
    const first = await interviewer.turn(turn(fetchFake, "founder"));
    expect(first.questionForQ).not.toBeNull();
    interviewer.researchEnded(SESSION_ID, false);
    const second = await interviewer.turn(turn(fetchFake, "founder"));
    expect(second.questionForQ).not.toBeNull();
    interviewer.researchEnded(SESSION_ID, false);
    const third = await interviewer.turn(turn(fetchFake, "founder"));
    // Two failures running: the route is down, and Q says so once,
    // narrowly, instead of sending a third question into it.
    expect(third.questionForQ).toBeNull();
    expect(third.reply).toMatch(/live research still isn't reachable/i);
    expect(third.reply).toMatch(/what you've told me and what I already know/i);
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
    expect(outcome.questionForQ).not.toContain("Zino Aviation");
  });
});
