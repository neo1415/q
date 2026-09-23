import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import type { InterviewConductorResult } from "@capital-q/q-core";

import { createInterviewer } from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * Q stops asking the question that is not working (Workstream A).
 *
 * Two components each behaving correctly can still build a loop, and the
 * person inside one has no way out: they answer, the reading fails to
 * place, the same words come back, and each repetition makes them less
 * willing to rephrase. Live, "which sectors and product areas?" was
 * asked four times running, and the fourth was word for word the first.
 *
 * The count is the platform's own — taken from what the platform asked,
 * not inferred from the transcript — so it is right even when the model
 * has lost the thread entirely. At the third time of asking, and
 * immediately when the person says they have already answered, Q stops.
 * What it says instead is composed from state: what it is holding for
 * them, and the one thing it does not have, in ordinary words.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const ANSWERED = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino",
  "I1.deployment_status": "actively_investing",
};

/** A turn that places nothing and asks the same step again. */
const ASKS_AGAIN: InterviewConductorResult = {
  ...base,
  intent: "UNCLEAR",
  reply: "Sorry, which stages do you invest at?",
  askNext: "I2.stages",
};

describe("the same question is not asked a third time", () => {
  it("says what is missing instead of repeating the question that failed", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_AGAIN),
      logger,
    });

    const first = await interviewer.turn(turn(world, "early ones"));
    const second = await interviewer.turn(turn(world, "the early ones"));
    const third = await interviewer.turn(
      turn(world, "early stage, like I said"),
    );

    // The first two are the model's own question; the third is not.
    expect(first.reply).toContain("which stages");
    expect(second.reply).toContain("which stages");
    expect(third.reply).not.toBe(second.reply);
    expect(third.reply).toMatch(/you did tell me/i);
    // And it names what it can actually take, which is the one thing
    // that had not been tried.
    expect(third.reply).toContain("Pre-seed");
    expect(third.reply).toContain("Series A");
  });

  it("resets when a turn actually records something", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        ASKS_AGAIN,
        ASKS_AGAIN,
        {
          ...base,
          intent: "ANSWER",
          reply: "Seed, good.",
          answers: [
            {
              stepKey: "I2.stages",
              value: ["seed"],
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          askNext: "I2.currency",
        },
        {
          ...base,
          intent: "UNCLEAR",
          reply: "Which currency?",
          askNext: "I2.currency",
        },
      ),
      logger,
    });

    await interviewer.turn(turn(world, "early ones"));
    await interviewer.turn(turn(world, "the early ones"));
    // Progress: the exchange is working, whatever it looked like.
    await interviewer.turn(turn(world, "seed"));
    const after = await interviewer.turn(turn(world, "hmm"));

    expect(after.reply).toContain("Which currency?");
    expect(after.reply).not.toMatch(/you did tell me/i);
  });
});

describe("somebody who says they have already answered is believed", () => {
  it("does not repeat the failed parse, and says plainly what is missing", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
      // A currency the journey will not take yet, so the ledger holds
      // something and Q can honestly say what it does have.
      refuseUntil: { "I2.currency": "I2.stages" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "Sterling, noted.",
          answers: [
            {
              stepKey: "I2.currency",
              value: "gbp",
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          askNext: "I2.stages",
        },
        {
          ...base,
          intent: "UNCLEAR",
          reply: "Sorry, which stages do you invest at?",
          askNext: "I2.stages",
          frustrated: true,
        },
      ),
      logger,
    });

    await interviewer.turn(turn(world, "We write in sterling."));
    const angry = await interviewer.turn(
      turn(world, "I already told you. I'm getting annoyed."),
    );

    // Not the question that failed.
    expect(angry.reply).not.toContain("Sorry, which stages do you invest at?");
    expect(angry.reply).toMatch(/you did tell me/i);
    // It accounts for what it is holding rather than claiming it is saved.
    expect(angry.reply).toContain("Pound sterling");
    expect(angry.reply).toMatch(/onto your record/i);
    // And it names the one thing it still needs.
    expect(angry.reply).toContain("Pre-seed");
  });
});
