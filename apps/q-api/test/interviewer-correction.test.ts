import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

/**
 * Correcting something already on the record (QX-004 core gate §8).
 *
 * Live, an investor who had said "I'm an angel" and had it recorded then
 * said "actually, scrap that — we're not an angel, we're a family
 * office". The model read it as a CORRECTION. The runtime threw it away,
 * because the step was COMPLETED and completed steps were skipped
 * outright. The record went on saying angel, and Q went on truthfully
 * reporting angel — truthful about the record and wrong about the person,
 * which is the worse of the two failures.
 *
 * A correction is the one case where a step already answered is answered
 * again. The model says it is a correction; the runtime does the writing;
 * the owning service supersedes rather than erases.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";
const NOW = "2026-09-22T09:00:00.000Z";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function view(stage: string): OnboardingSessionView {
  return {
    session: {
      id: SESSION_ID,
      journeyType: "founder",
      definitionVersionId: "22222222-2222-4222-8222-222222222222",
      definitionVersion: 2,
      status: "ACTIVE",
      subject: null,
      currentStepKey: "F1.country",
      version: 4,
      startedAt: NOW,
      lastActivityAt: NOW,
      completedAt: null,
    },
    phases: [],
    currentStep: {
      stepKey: "F1.country",
      stepType: "short_text",
      required: true,
      prompt: "Where is the company based?",
      presentation: { stepType: "short_text", minLength: 1, maxLength: 120 },
    },
    progress: {
      currentStepKey: "F1.country",
      currentPhaseKey: null,
      eligibleSteps: [
        { stepKey: "F1.stage", required: true, status: "COMPLETED" },
        { stepKey: "F1.country", required: true, status: "IN_PROGRESS" },
      ],
      eligibleStepCount: 2,
      completedEligibleStepCount: 1,
      canGoBack: true,
      canSkipCurrentStep: false,
      canComplete: false,
    },
    pendingSuggestions: [],
    responses: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        stepKey: "F1.stage",
        responseType: "SINGLE_SELECT",
        value: { type: "SINGLE_SELECT", optionKey: stage },
        sourceModality: "TYPED_TEXT",
        createdAt: NOW,
      },
    ],
    pendingQuestions: [],
  } as unknown as OnboardingSessionView;
}

function api() {
  const written: { stepKey: string; value: unknown }[] = [];
  let stage = "seed";
  const fetchFake: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes("/taxonomy/")) {
      return Promise.resolve(Response.json({ candidates: [] }));
    }
    if ((init?.method ?? "GET") === "POST" && url.includes("/responses")) {
      const raw = typeof init?.body === "string" ? init.body : "{}";
      const parsed = JSON.parse(raw) as {
        stepKey: string;
        response: { value: { optionKey?: string } };
      };
      written.push({ stepKey: parsed.stepKey, value: parsed.response.value });
      // The owning service supersedes: the latest value is what a later
      // read returns, and the earlier one is its own row in its history.
      if (parsed.response.value.optionKey !== undefined) {
        stage = parsed.response.value.optionKey;
      }
      return Promise.resolve(Response.json(view(stage)));
    }
    return Promise.resolve(Response.json(view(stage)));
  };
  return { fetchFake, written, current: () => stage };
}

const base: InterviewConductorResult = {
  reply: "",
  intent: "ANSWER",
  answers: [],
  categoryPhrases: [],
  confirmations: [],
  skips: [],
  askNext: null,
  showOptions: false,
  questionForQ: null,
  answerFromState: null,
  skipRemainingOptional: false,
  navigate: null,
  lookup: null,
  pronounce: null,
  unrestricted: [],
  frustrated: false,
  reading: null,
  delivery: null,
  offered: [],
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
    journeyType: "founder" as const,
    channel: "voice" as const,
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      correlationId: "cor_test",
    },
    utterance,
    // The old value is still in the transcript. It must not be able to
    // bring itself back.
    recentTurns: [
      { role: "person" as const, text: "We're at seed." },
      { role: "q" as const, text: "Seed, got it." },
    ],
  };
}

describe("a correction reaches the record", () => {
  it("writes a step that was already answered, when it is a correction", async () => {
    const { fetchFake, written, current } = api();
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "CORRECTION",
        reply: "Series A, then — not seed.",
        answers: [
          {
            stepKey: "F1.stage",
            value: "series_a",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });

    const corrected = await interviewer.turn(
      turn(fetchFake, "Actually, scrap that — we're at Series A."),
    );
    expect(corrected.recorded).toContain("F1.stage");
    expect(written).toHaveLength(1);
    expect(JSON.stringify(written[0]?.value)).toContain("series_a");
    // And a later read gives the corrected value, not the first one.
    expect(current()).toBe("series_a");
  });

  it("still refuses an ordinary re-answer of a step already on the record", async () => {
    // Only a correction may overwrite. A stray ANSWER naming a completed
    // step is the accident this guard exists for.
    const { fetchFake, written } = api();
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Series A, got it.",
        answers: [
          {
            stepKey: "F1.stage",
            value: "series_a",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });

    await interviewer.turn(turn(fetchFake, "Where are we based? Lagos."));
    expect(written).toEqual([]);
  });

  it("reports the corrected value afterwards, not the one still in the transcript", async () => {
    const { fetchFake } = api();
    const corrector = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "CORRECTION",
        reply: "Series A, then.",
        answers: [
          {
            stepKey: "F1.stage",
            value: "series_a",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });
    await corrector.turn(turn(fetchFake, "Actually we're at Series A."));

    // A progress answer is written by the runtime from the session, so
    // the transcript's "We're at seed" cannot bring seed back.
    const asking = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        answerFromState: "PROGRESS",
        reply: "",
      }),
      logger,
    });
    const progress = await asking.turn(turn(fetchFake, "where are we?"));
    expect(progress.reply).toContain("Series A");
    expect(progress.reply).not.toContain("Seed");
  });
});
