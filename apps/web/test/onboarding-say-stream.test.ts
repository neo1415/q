import { describe, expect, it } from "vitest";

import type { OnboardingSessionView } from "@capital-q/contracts";

import { OnboardingClientError } from "../src/features/onboarding-kit/client";
import { sayStreaming } from "../src/features/onboarding-kit/say-stream";

/**
 * L9 (onboarding speed 2026-10-20): a typed onboarding turn shows Q's
 * sentences as they are written, then settles on the whole turn. A stream
 * that ends without its settled turn is a failure, never a half-reply.
 */

const SESSION_ID = "f0000000-0000-4000-8000-000000000001";
const VIEW: OnboardingSessionView = {
  session: {
    id: SESSION_ID,
    journeyType: "investor",
    definitionVersionId: "f0000000-0000-4000-8000-0000000000d1",
    definitionVersion: 1,
    status: "ACTIVE",
    subject: null,
    currentStepKey: "I0.investor_type",
    version: 3,
    startedAt: "2026-09-22T09:00:00.000Z",
    lastActivityAt: "2026-09-22T09:00:00.000Z",
    completedAt: null,
  },
  phases: [{ phaseKey: "mandate", label: "Mandate" }],
  currentStep: null,
  progress: {
    currentStepKey: "I0.investor_type",
    currentPhaseKey: "mandate",
    eligibleSteps: [],
    eligibleStepCount: 0,
    completedEligibleStepCount: 0,
    canGoBack: false,
    canSkipCurrentStep: false,
    canComplete: false,
  },
  pendingSuggestions: [],
  responses: [],
};

const TURN = {
  reply: "Angel investor, noted. Which firm do you invest through?",
  intent: "ANSWER",
  asking: null,
  recorded: ["I0.investor_type"],
  skipped: [],
  questionForQ: null,
  researching: null,
  navigate: null,
  handoff: null,
  degraded: false,
  askingAbout: [],
  pending: { recommendations: [], held: [] },
};

/** A response whose body arrives in the chunks given, split anywhere. */
function streamed(chunks: readonly string[], status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks)
              controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        { status, headers: { "content-type": "application/x-ndjson" } },
      ),
    );
}

const INPUT = {
  sessionId: SESSION_ID,
  text: "I'm an angel investor.",
  recentTurns: [],
};

describe("a typed onboarding turn, streamed", () => {
  it("hands over each sentence as it arrives, then settles on the whole turn", async () => {
    const heard: string[] = [];
    const done = JSON.stringify({ type: "done", turn: TURN, view: VIEW });
    const outcome = await sayStreaming(
      INPUT,
      (sentence) => heard.push(sentence),
      streamed([
        '{"type":"sentence","text":"Angel investor, noted."}\n{"type":"sen',
        'tence","text":"Which firm do you invest through?"}\n',
        `${done.slice(0, 40)}`,
        `${done.slice(40)}\n`,
      ]),
    );
    expect(heard).toEqual([
      "Angel investor, noted.",
      "Which firm do you invest through?",
    ]);
    expect(outcome.reply).toBe(TURN.reply);
    expect(outcome.view.session.id).toBe(SESSION_ID);
    expect(outcome.understood).toBeNull();
  });

  it("fails, rather than presenting a half-reply, when the stream ends early", async () => {
    await expect(
      sayStreaming(
        INPUT,
        () => undefined,
        streamed(['{"type":"sentence","text":"Angel investor, noted."}\n']),
      ),
    ).rejects.toBeInstanceOf(OnboardingClientError);
  });

  it("carries the interviewer's own failure as a failure", async () => {
    await expect(
      sayStreaming(
        INPUT,
        () => undefined,
        streamed([
          '{"type":"error","code":"UNAVAILABLE","message":"Q couldn\'t answer that just now. Try again."}\n',
        ]),
      ),
    ).rejects.toThrow("Q couldn't answer that just now");
  });

  it("is a retryable failure when the route cannot be reached", async () => {
    const error = await sayStreaming(
      INPUT,
      () => undefined,
      () => Promise.reject(new TypeError("offline")),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OnboardingClientError);
    expect((error as OnboardingClientError).retryable).toBe(true);
  });
});
