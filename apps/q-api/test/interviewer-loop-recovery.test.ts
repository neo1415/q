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
 * Q stops repeating the question that is not working (CQ-QX-005 §6, §7).
 *
 * Two components each behaving correctly can still build a loop, and the
 * person inside one has no way out: they answer, the reading fails to
 * place, the same words come back, and each repetition makes them less
 * willing to rephrase. Live, "which sectors and product areas?" was
 * asked four times running, and the fourth was word for word the first.
 *
 * Repair is now a ladder over the conversation core's own count of
 * failures on the topic — never the same rung twice running — and a
 * person who says they have already answered is believed at once: Q names
 * what it is holding for them and the one thing it does not have.
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

describe("the same repair is never said twice running", () => {
  it("changes strategy on every failed turn and ends by offering a way out", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_AGAIN),
      logger,
    });

    const replies: string[] = [];
    for (const said of [
      "early ones",
      "the early ones",
      "early stage, like I said",
      "EARLY",
    ]) {
      replies.push((await interviewer.turn(turn(world, said))).reply);
    }

    // Never the model's own failed question repeated, and never the
    // same repair line twice in a row.
    for (let i = 1; i < replies.length; i += 1) {
      expect(replies[i]).not.toBe(replies[i - 1]);
    }
    for (const reply of replies) {
      expect(reply).not.toBe("Sorry, which stages do you invest at?");
      // Reasoning trouble is never blamed on hearing.
      expect(reply.toLowerCase()).not.toContain("didn't catch");
    }
    // The gap is named in the step's own terms along the way…
    expect(replies.join(" ")).toContain("Pre-seed");
    expect(replies.join(" ")).toContain("Series A");
    // …and the ladder reaches the floor: a way out, not a fifth ask.
    expect(replies.join(" ")).toMatch(/tap(?:ping)? Type/i);
    expect(
      interviewer.conversation(turn(world, "").onboardingSessionId).repair,
    ).not.toBeNull();
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
    const recorded = await interviewer.turn(turn(world, "seed"));
    expect(recorded.recorded).toEqual(["I2.stages"]);
    const after = await interviewer.turn(turn(world, "hmm"));

    // A fresh topic starts the ladder again from its first rung.
    expect(after.reply).toMatch(/^Let me ask that differently\./);
    expect(after.reply).toContain("currency");
    expect(after.reply).not.toMatch(/tap(?:ping)? Type/i);
  });
});

describe("somebody who says they have already answered is believed", () => {
  it("does not repeat the failed parse, and says plainly what is missing and what is held", async () => {
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
    expect(angry.reply).not.toMatch(/saved|recorded/i);
    // And it names the one thing it still needs, and what it can take.
    expect(angry.reply).toContain("still missing");
    expect(angry.reply).toContain("Pre-seed");
  });
});
