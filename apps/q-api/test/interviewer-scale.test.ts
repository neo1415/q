import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import {
  chequeContradiction,
  createInterviewer,
} from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * A figure with no scale is asked about, never guessed (Workstream A).
 *
 * "Maximum cheque is one hundred" names the field unmistakably and
 * leaves the amount completely open. The range step accepts anything
 * from zero to a trillion, so 100 validated cleanly and went in — and a
 * maximum cheque of one hundred pounds removes this investor from
 * essentially every opportunity on the platform, silently, for the rest
 * of the account's life. Guessing 100,000,000 instead is the same
 * mistake in the other direction.
 *
 * Two layers, and neither of them guesses. The model marks the reading
 * SCALE_UNCLEAR, which is it reporting what the words did and did not
 * fix. And the platform independently refuses a cheque figure that
 * contradicts one already on the record, because minimum ≤ typical ≤
 * maximum is a domain invariant and not a threshold anybody invented.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const ANSWERED = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino",
  "I1.deployment_status": "actively_investing",
  "I2.currency": "gbp",
};

describe("a figure whose magnitude was never said", () => {
  it("is not recorded, and the scale is asked for in one question", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_max",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "A hundred, got it.",
        answers: [
          {
            stepKey: "I2.cheque_max",
            value: "100",
            confidence: "HIGH",
            clarity: "SCALE_UNCLEAR",
          },
        ],
        askNext: "I2.investment_role",
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Maximum cheque is one hundred."),
    );

    // Neither guess was made.
    expect(world.recordedValue("I2.cheque_max")).toBeUndefined();
    expect(outcome.recorded).not.toContain("I2.cheque_max");
    // And the question is answerable in one word.
    expect(outcome.reply).toMatch(/thousands, millions, or exactly that/i);
    expect(outcome.asking?.stepKey).toBe("I2.cheque_max");
    // The model's own "got it" does not survive next to it.
    expect(outcome.reply).not.toContain("got it");
  });

  it("refuses a maximum smaller than a minimum already on the record", async () => {
    // The model read it as settled; the platform knows better, because
    // it can see the minimum.
    const world = investorSession({
      currentStepKey: "I2.cheque_max",
      recorded: { ...ANSWERED, "I2.cheque_min": "50000" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Noted.",
        answers: [
          {
            stepKey: "I2.cheque_max",
            value: "100",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "Max is one hundred."));

    expect(world.recordedValue("I2.cheque_max")).toBeUndefined();
    expect(outcome.reply).toMatch(/scale/i);
  });

  it("records a figure whose scale is settled", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_max",
      recorded: { ...ANSWERED, "I2.cheque_min": "50000" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Noted.",
        answers: [
          {
            stepKey: "I2.cheque_max",
            value: "250000",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Up to two hundred and fifty thousand."),
    );

    // Money is still read back before it is written — that has not
    // changed, and should not.
    expect(outcome.reply).toMatch(/£250,000/);
    expect(outcome.reply).toMatch(/is that right/i);
  });
});

describe("the cheque ordering invariant", () => {
  const recorded = new Map([
    ["I2.cheque_min", 50_000],
    ["I2.cheque_max", 250_000],
  ]);

  it("catches a maximum below the minimum", () => {
    expect(
      chequeContradiction(
        "I2.cheque_max",
        { type: "RANGE", value: "100" },
        recorded,
      ),
    ).toBe(true);
  });

  it("catches a minimum above the maximum", () => {
    expect(
      chequeContradiction(
        "I2.cheque_min",
        { type: "RANGE", value: "900000" },
        recorded,
      ),
    ).toBe(true);
  });

  it("accepts a typical cheque inside the envelope", () => {
    expect(
      chequeContradiction(
        "I2.cheque_typical",
        { type: "RANGE", value: "100000" },
        recorded,
      ),
    ).toBe(false);
  });

  it("says nothing about steps that are not cheques", () => {
    expect(
      chequeContradiction(
        "I4.revenue_state",
        { type: "RANGE", value: "1" },
        recorded,
      ),
    ).toBe(false);
  });
});
