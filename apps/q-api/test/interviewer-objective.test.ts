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
 * C, the product-acceptance directive of 2026-09-24: Q reasons over the
 * active objective, and the step in front is background, not a router.
 * A question about what is left is answered as one, never turned into an
 * audit of empty fields or a rephrase of the current question.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const reading = (
  overrides: Partial<ConversationTurnReading>,
): ConversationTurnReading => ({
  kind: "ANSWER",
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

const SO_FAR = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino Aviation",
  "I1.deployment_status": "actively_investing",
};

const REMAINING = [
  "I6.custom_criteria",
  "I7.avoid",
  "I7.hard_exclusions",
  "I7.sector_exclusions",
  "I9.discovery_mode",
  "I10.inbound_preference",
];

const ANSWER_ABOUT_WHAT_IS_LEFT =
  "Mostly what you'd rather not see, how adventurous discovery should be, and how founders reach you.";

describe("C · 'what other questions do you want to know?' is answered as asked", () => {
  it("keeps the answer about what is left when the reading names many empty steps", async () => {
    // Live (luna): read as THEIR_OWN_RECORDS about six empty steps, and
    // answered "Not yet: nothing is on your record for …" six times.
    const world = investorSession({
      currentStepKey: "I6.custom_criteria",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: ANSWER_ABOUT_WHAT_IS_LEFT,
        askNext: "I6.custom_criteria",
        reading: reading({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "What other questions do you want answered?",
            about: REMAINING,
          },
        }),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "What other questions do you want to know the answers to?"),
    );

    expect(outcome.reply).toContain(ANSWER_ABOUT_WHAT_IS_LEFT);
    expect(outcome.reply).not.toMatch(/nothing is on your record/i);
  });

  it("does not answer a request for advice from the record", async () => {
    const world = investorSession({
      currentStepKey: "I7.sector_exclusions",
      recorded: SO_FAR,
    });
    const advice = "Sectors that often clash with a thesis like yours are …";
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: advice,
        askNext: "I7.sector_exclusions",
        reading: reading({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "ADVICE",
            text: "Pick three sectors I would not like.",
            about: ["I7.sector_exclusions"],
          },
        }),
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Pick three sectors for me that you think I would not like."),
    );

    expect(outcome.reply).toContain(advice);
    expect(outcome.reply).not.toMatch(/nothing is on your record/i);
  });

  it("still answers 'did gambling go in?' from the record", async () => {
    const world = investorSession({
      currentStepKey: "I9.discovery_mode",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "Yes, gambling is a hard no.",
        reading: reading({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "Did gambling go in?",
            about: ["I7.hard_exclusions"],
          },
        }),
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "Did gambling go in?"));

    // The model's "yes" is not what the record says.
    expect(outcome.reply).not.toMatch(/hard no/i);
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
  });
});
