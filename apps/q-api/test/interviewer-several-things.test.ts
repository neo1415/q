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
 * The acceptance walkthrough's interview defects (CQ-QX-005 E1, E2, E3),
 * as deterministic doubles: the model's reading is given; what the
 * platform writes, holds, says and asks is asserted.
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

const MANDATE_SO_FAR = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino Aviation",
  "I1.deployment_status": "actively_investing",
  "I2.currency": "usd",
};

/** Q hears two cheque figures and holds both for a yes. */
const HOLDS_CHEQUES = {
  ...base,
  intent: "ANSWER" as const,
  reply: "Noted.",
  answers: [
    {
      stepKey: "I2.cheque_min",
      value: "100000",
      confidence: "HIGH" as const,
      clarity: "SETTLED" as const,
    },
    {
      stepKey: "I2.cheque_max",
      value: "250000",
      confidence: "HIGH" as const,
      clarity: "SETTLED" as const,
    },
  ],
  reading: reading({}),
};

describe("E1 · one turn confirms, corrects and asks", () => {
  it("writes the yes, holds the correction for its own yes, and still answers the question", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(HOLDS_CHEQUES, {
        ...base,
        intent: "CORRECTION",
        reply:
          "If I were you I'd look hardest at how capital-efficient the team is at your cheque size.",
        confirmations: [{ stepKey: "I2.cheque_min", decision: "CONFIRMED" }],
        answers: [
          {
            stepKey: "I2.cheque_max",
            value: "300000",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({
          kind: "CORRECTION",
          question: {
            kind: "ADVICE",
            text: "what would you look for in a company if you were me?",
          },
        }),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "100k to 250k"));
    const outcome = await interviewer.turn(
      turn(
        world,
        "yes thats right. oh wait actually the max is more like 300k, not 250. and what would you look for in a company if you were me?",
      ),
    );
    // The yes landed.
    expect(world.recordedValue("I2.cheque_min")).toMatchObject({
      value: "100000",
    });
    // The question was answered, not dropped...
    expect(outcome.reply).toContain("capital-efficient");
    expect(outcome.trace?.classification.question).toBe("ADVICE");
    // ...and the corrected figure is read back for its own yes, never
    // claimed as saved.
    expect(outcome.trace?.persisted.held).toContain("I2.cheque_max");
    expect(outcome.reply).toMatch(/300,000\. Is that right\?$/);
  });
});

describe("E2 · a yes is never lost to answers committed beside it", () => {
  it("records every held value the yes confirms, in the same turn as other answers", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(HOLDS_CHEQUES, {
        ...base,
        intent: "ANSWER",
        reply: "Good. What's your title there?",
        confirmations: [
          { stepKey: "I2.cheque_min", decision: "CONFIRMED" },
          { stepKey: "I2.cheque_max", decision: "CONFIRMED" },
        ],
        answers: [
          {
            stepKey: "I2.stages",
            value: ["seed"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "100k to 250k"));
    const outcome = await interviewer.turn(
      turn(world, "yes thats right, and we do seed"),
    );
    expect(outcome.recorded).toEqual(
      expect.arrayContaining(["I2.cheque_min", "I2.cheque_max", "I2.stages"]),
    );
    expect(outcome.trace?.persisted.held).toEqual([]);
  });
});

describe("E3 · the opening re-presents what is actually pending", () => {
  it("opens on the held confirmation, whatever the model would have asked", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(HOLDS_CHEQUES, {
        ...base,
        intent: "OPENING",
        // A single question: the model's own opener is not kept in front.
        reply: "What's your title at Zino Aviation?",
        askNext: "I0.business_title",
        reading: reading({ kind: "CONTROL" }),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "100k to 250k"));
    // A reload: the surface opens the interview again with no words.
    const opening = await interviewer.turn(turn(world, ""));
    expect(opening.asking?.stepKey).toBe("I2.cheque_min");
    expect(opening.reply).toMatch(
      /Minimum cheque: \$100,000\. Is that right\?/,
    );
    expect(opening.reply).not.toMatch(/title/i);
  });
});
