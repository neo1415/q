import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import { createInterviewer } from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * How a reply should sound travels beside it, never inside it
 * (CQ-VOICE-010).
 *
 * What the interviewer returns as `reply` is what the transcript shows and
 * the thread stores. The model's delivery cue comes back separately, as
 * the closed delivery the speech layer renders. It comes back only for the
 * words the model actually wrote: a laugh meant for one sentence must not
 * land on a repair the runtime said instead.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

describe("the interviewer's delivery", () => {
  it("returns the model's cue beside a reply that is left exactly as written", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "An angel, lovely. What's your organisation called?",
        answers: [
          {
            stepKey: "I0.investor_type",
            value: "angel",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I0.organisation_name",
        delivery: "CHUCKLE",
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "an angel, obviously, you asked me twice"),
    );
    expect(outcome.reply).not.toMatch(/\[|chuckle/i);
    expect(outcome.reply.startsWith("An angel, lovely.")).toBe(true);
    expect(outcome.delivery).toMatchObject({
      reaction: "CHUCKLE",
      reactionAt: 0,
    });
  });

  it("has no delivery when the model asked for none", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "An angel. What's your organisation called?",
        answers: [
          {
            stepKey: "I0.investor_type",
            value: "angel",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I0.organisation_name",
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "an angel"));
    expect(outcome.delivery).toMatchObject({
      reaction: null,
      pauseAfter: [],
    });
  });

  it("drops the cue when the runtime replaced the words it was meant for", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    // No model route at all: the runtime speaks its own notice, and no cue
    // from anywhere rides on it.
    const interviewer = createInterviewer({
      gateway: {
        execute: () => Promise.reject(new Error("no route")),
      },
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "hello"));
    expect(outcome.reply.length).toBeGreaterThan(0);
    expect(outcome.delivery ?? null).toBeNull();
  });
});
