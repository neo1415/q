import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * What Q does when it cannot think, and what it may claim (QX-004 §0.4,
 * §0.5).
 *
 * This is written from a real hosted transcript. Every provider was
 * ineligible or rate-limited, and the interview answered every turn with
 * "I'm having trouble thinking just now. Let's keep going: Your firm" —
 * a bare field label, repeated after each failure, while the person kept
 * answering into nothing. Eleven turns of it.
 *
 * Two properties end that, and neither depends on a provider being
 * available:
 *
 * **A failure is said once and does not pretend to advance.** No step is
 * asked, no label is read out, and the person is told their answers are
 * safe rather than being made to guess.
 *
 * **Q may not narrate a save the runtime refused.** The reply is the
 * model's prose and the commit is the runtime's result; the model's words
 * are not evidence that anything happened.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-22T09:00:00.000Z";
const BEARER = "eyPRIVATE.NEVER-EMITTED.bearer";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

/**
 * The founder session from the working harness, sitting on a step whose
 * prompt is a bare label — which is what the hosted transcript read out.
 */
function view(
  overrides: Partial<OnboardingSessionView> = {},
): OnboardingSessionView {
  return {
    session: {
      id: SESSION_ID,
      journeyType: "founder",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: 2,
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
      prompt: "Your firm",
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
        { stepKey: "F0.intent", required: true, status: "COMPLETED" },
        { stepKey: "F1.company_name", required: true, status: "COMPLETED" },
        { stepKey: "F1.country", required: true, status: "IN_PROGRESS" },
        { stepKey: "F1.stage", required: true, status: "IN_PROGRESS" },
        { stepKey: "F4.founder_role", required: true, status: "PENDING" },
        { stepKey: "F6.target_amount", required: false, status: "PENDING" },
        { stepKey: "F1.categories", required: false, status: "PENDING" },
      ],
      eligibleStepCount: 7,
      completedEligibleStepCount: 2,
      canGoBack: false,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        stepKey: "F1.company_name",
        responseType: "TEXT",
        value: { type: "TEXT", text: "Northstar" },
        sourceModality: "TYPED_TEXT",
        createdAt: NOW,
      },
    ],
    pendingQuestions: [],
    ...overrides,
  };
}

function api(options: { readonly acceptWrites: boolean }) {
  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";
    if (
      !options.acceptWrites &&
      method !== "GET" &&
      !url.includes("/taxonomy/")
    ) {
      // The runtime refuses the answer — a stale version, a validation
      // failure, anything. What matters is that Q does not claim it saved.
      return Promise.resolve(
        Response.json({ title: "Conflict", status: 409 }, { status: 409 }),
      );
    }
    return Promise.resolve(Response.json(view()));
  };
  return fetchFake;
}

/** A model that is simply not reachable, as every provider being out looks. */
function unreachableGateway(): InterviewGateway {
  return {
    execute: () => Promise.reject(new Error("no configured model is eligible")),
  };
}

function gatewayReturning(result: InterviewConductorResult): InterviewGateway {
  return {
    execute: () =>
      Promise.resolve({
        output: { kind: "STRUCTURED", value: result },
      } as never),
  };
}

const answered: InterviewConductorResult = {
  reply: "Seed, got it.",
  intent: "ANSWER",
  answers: [
    {
      stepKey: "F1.stage",
      value: "seed",
      confidence: "HIGH",
    },
  ],
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

function turn(fetchFake: typeof fetch, utterance: string) {
  return {
    session: {
      baseUrl: "http://api.test",
      accessToken: BEARER,
      fetch: fetchFake,
    },
    onboardingSessionId: SESSION_ID,
    journeyType: "founder" as const,
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

describe("QX-004 §0.4 · Q with no model route", () => {
  it("says it once, asks nothing, and never reads the bare field label back", async () => {
    const fetchFake = api({ acceptWrites: true });
    const interviewer = createInterviewer({
      gateway: unreachableGateway(),
      logger,
    });

    const first = await interviewer.turn(turn(fetchFake, "Zino Aviation"));
    expect(first.degraded).toBe(true);
    // The loop's signature: the step's prompt read out as if it were a
    // question. It must not appear at all.
    expect(first.reply).not.toContain("Your firm");
    expect(first.reply).not.toContain("Let's keep going");
    // And nothing is asked, so the surface does not pretend to advance.
    expect(first.asking).toBeNull();
    expect(first.recorded).toEqual([]);
    // It is honest about what happened, and — QX-004 §5 — it does not
    // reassure them about a thing that was not saved. The first version
    // of this line said "nothing you've told me is lost" while the
    // browser was showing "Capital Q couldn't save that".
    expect(first.reply.toLowerCase()).toContain("can't reach");
    expect(first.reply.toLowerCase()).toContain("hasn't been saved");
    expect(first.reply.toLowerCase()).not.toContain("nothing you");
    expect(first.reply.toLowerCase()).not.toContain("is saved;");
    // What it may stand behind is what this turn actually read back: the
    // one answer already on the session.
    expect(first.reply).toContain("The one answer you have given me is on");

    const second = await interviewer.turn(turn(fetchFake, "Zino Aviation"));
    expect(second.degraded).toBe(true);
    expect(second.reply).not.toContain("Your firm");
    // The second failure does not repeat the first apology verbatim; a
    // person saying the same thing twice into the same wall should be
    // told something has not changed, not read the same sentence.
    expect(second.reply).not.toBe(first.reply);
    expect(second.asking).toBeNull();
  });

  it("recovers cleanly once a model answers again", async () => {
    const fetchFake = api({ acceptWrites: true });
    const failing = createInterviewer({
      gateway: unreachableGateway(),
      logger,
    });
    await failing.turn(turn(fetchFake, "Zino Aviation"));

    const working = createInterviewer({
      gateway: gatewayReturning(answered),
      logger,
    });
    const recovered = await working.turn(turn(fetchFake, "Zino Aviation"));
    expect(recovered.degraded).toBe(false);
    expect(recovered.recorded).toContain("F1.stage");
    expect(recovered.reply).toContain("Seed");
  });
});

describe("QX-004 core gate §5 · Q may not narrate a save it never made", () => {
  it("replaces an acknowledgement when the model took nothing in at all", async () => {
    // Live, 2026-09-22: "Zino Aviation, got it." — and the session
    // recorded no organisation name, because the model's structured
    // answer carried none. Nothing was refused, so the guard for a
    // REFUSED commit had nothing to catch; the acknowledgement was
    // simply untrue, and the step came round again later as if never
    // asked.
    const fetchFake = api({ acceptWrites: true });
    const interviewer = createInterviewer({
      gateway: gatewayReturning({
        ...answered,
        reply: "Zino Aviation, got it.",
        // An ANSWER that carries no answer: nothing to commit, nothing to
        // read back, nothing set aside.
        answers: [],
      }),
      logger,
    });

    const result = await interviewer.turn(turn(fetchFake, "Zino Aviation."));
    expect(result.recorded).toEqual([]);
    expect(result.reply).not.toContain("got it");
    expect(result.reply.toLowerCase()).toContain("didn't catch that");
    // And it asks the step again rather than leaving the person to find
    // out later that it never went in.
    expect(result.asking?.stepKey).toBe("F1.stage");
  });

  it("leaves a real acknowledgement alone", async () => {
    const fetchFake = api({ acceptWrites: true });
    const interviewer = createInterviewer({
      gateway: gatewayReturning(answered),
      logger,
    });
    const result = await interviewer.turn(turn(fetchFake, "Seed."));
    expect(result.recorded).toContain("F1.stage");
    expect(result.reply).toContain("Seed");
  });
});

describe("QX-004 §0.5 · Q may not narrate a save that failed", () => {
  it("replaces the model's confirmation when the runtime refused the answer", async () => {
    const fetchFake = api({ acceptWrites: false });
    const interviewer = createInterviewer({
      gateway: gatewayReturning(answered),
      logger,
    });

    const result = await interviewer.turn(turn(fetchFake, "Zino Aviation"));
    // The model said "got it". The runtime said no. The person hears the
    // runtime.
    expect(result.recorded).toEqual([]);
    expect(result.reply).not.toContain("got it");
    expect(result.reply.toLowerCase()).toContain("couldn't save");
    expect(result.asking).toBeNull();
  });
});
