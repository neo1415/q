import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import type { ConversationTurnReading } from "@capital-q/q-core";

import { createInterviewer } from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * H, the product-acceptance directive of 2026-09-24: "What do you have on
 * me so far?" is answered as a synthesis of the record, then the
 * interview resumes. Never a count, never a label-colon-value dump, and
 * never anything the session does not hold.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const reading = (
  overrides: Partial<ConversationTurnReading>,
): ConversationTurnReading => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  references: [],
  qualitative: [],
  question: null,
  suggestions: [],
  tensions: [],
  clears: [],
  ...overrides,
});

const RECORDED = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino Aviation",
  "I0.business_title": "Founder",
  "I1.deployment_status": "actively_investing",
  "I2.stages": "pre_seed",
  "I2.currency": "eur",
  "I5.founder_preferences": "deep_domain_expertise",
};

function expectSynthesis(reply: string): void {
  expect(reply).toContain("Zino Aviation");
  expect(reply).toContain("Founder");
  expect(reply).toMatch(/pre-seed/i);
  expect(reply).toMatch(/deep domain expertise/i);
  expect(reply).not.toMatch(/\d+ of \d+|\d+ to go|answered/);
  expect(reply).not.toMatch(
    /How do you invest:|Your firm:|On your record so far/,
  );
  // The model's claim from its memory of the conversation never survives.
  expect(reply).not.toContain("strong revenue growth");
}

describe("H · what Q has on them is a synthesis of the record", () => {
  it("answers 'what do you have on me so far?' in sentences, then resumes", async () => {
    const world = investorSession({
      currentStepKey: "I6.custom_criteria",
      recorded: RECORDED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "You love strong revenue growth.",
        answerFromState: "PROGRESS",
        reading: reading({
          question: { kind: "PROGRESS", text: "what do you have", about: [] },
        }),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "What do you have on me so far?"),
    );

    expectSynthesis(outcome.reply);
    expect(outcome.asking?.stepKey ?? "I6.custom_criteria").toBe(
      "I6.custom_criteria",
    );
  });

  it("answers 'describe who I am to you' the same way", async () => {
    const world = investorSession({
      currentStepKey: "I6.custom_criteria",
      recorded: RECORDED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "You love strong revenue growth.",
        reading: reading({
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "Describe who I am to you",
            about: [],
          },
        }),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(
        world,
        "Based on everything I've talked about, describe who I am to you.",
      ),
    );

    expectSynthesis(outcome.reply);
    expect(world.attempts()).toEqual([]);
  });

  it("answers a records question that names every step as the synthesis, not a list of yeses", async () => {
    const world = investorSession({
      currentStepKey: "I6.custom_criteria",
      recorded: RECORDED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "You love strong revenue growth.",
        reading: reading({
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "Tell me what you know about me",
            about: Object.keys(RECORDED),
          },
        }),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(
        world,
        "Talk to me like a normal person about what you know about me.",
      ),
    );

    expectSynthesis(outcome.reply);
    expect(outcome.reply).not.toMatch(/is on your record/);
  });
});
