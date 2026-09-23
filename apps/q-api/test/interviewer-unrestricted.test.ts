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
 * "Everywhere on the planet" is an answer (Workstream A).
 *
 * It was not being treated as one. The phrase went to the taxonomy
 * classifier, which correctly found no node called everywhere, so
 * nothing was recorded and the geography question came round again —
 * three times in the live transcript, the person saying it more
 * emphatically each time and Q hearing it less each time.
 *
 * The journey has always had a way to say this. Its own copy for the
 * geography step reads "Leave empty for anywhere", and its investment
 * role step offers all three roles at once. What was missing was
 * anything to connect a person's phrasing to the journey's
 * representation of it, so the model reads that no restriction was
 * placed and the STEP decides what that means — a list of every option
 * where that is the answer, nothing listed where that is, and a plain
 * question where the step genuinely cannot say it.
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

describe("no restriction is recorded the way the journey records it", () => {
  it("records 'everywhere on the planet' as no geography, not as a repeated question", async () => {
    const world = investorSession({
      currentStepKey: "I3.geography",
      recorded: ANSWERED,
      // The classifier finds nothing, exactly as it does live.
      taxonomy: {},
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Anywhere it is.",
        unrestricted: [{ stepKey: "I3.geography" }],
        askNext: "I3.sectors",
      }),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(world, "Everywhere on the planet."),
    );

    expect(outcome.skipped).toContain("I3.geography");
    expect(world.skippedSteps()).toContain("I3.geography");
    // And Q moves on rather than asking the same thing again.
    expect(outcome.asking?.stepKey).not.toBe("I3.geography");
  });

  it("records 'it can be anyone' as every investment role", async () => {
    const world = investorSession({
      currentStepKey: "I2.investment_role",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "No preference there.",
        unrestricted: [{ stepKey: "I2.investment_role" }],
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "It can be anyone."));

    expect(outcome.recorded).toContain("I2.investment_role");
    // The journey's own way of saying "no preference": all of them.
    expect(world.recordedValue("I2.investment_role")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["lead", "co_invest", "follow"],
    });
  });

  it("records 'no preference' as the vocabulary's own no-preference code", async () => {
    const world = investorSession({
      currentStepKey: "I4.capital_intensity",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Not fussed either way.",
        unrestricted: [{ stepKey: "I4.capital_intensity" }],
      }),
      logger,
    });

    await interviewer.turn(turn(world, "We don't mind either way."));

    expect(world.recordedValue("I4.capital_intensity")).toEqual({
      type: "SINGLE_SELECT",
      // `any` is a canonical code in the Investor constraint registry,
      // not a word matched in what they said.
      optionKey: "any",
    });
  });

  it("does not invent an answer for a step that cannot express it", async () => {
    // A free-text firm name has no representation of "anything", and
    // making one up would be worse than asking.
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "angel" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Which firm is it?",
        unrestricted: [{ stepKey: "I0.organisation_name" }],
        askNext: "I0.organisation_name",
      }),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "Anything, really."));

    expect(outcome.recorded).not.toContain("I0.organisation_name");
    expect(outcome.skipped).not.toContain("I0.organisation_name");
    expect(world.recordedValue("I0.organisation_name")).toBeUndefined();
  });
});

describe("exclusions volunteered before their own step are retained", () => {
  it("reads them back at once, holds them across turns, and never re-asks", async () => {
    /**
     * I7 is several phases past where this is said. Exclusions are
     * material, so the platform will not write one on a single say-so —
     * and before this, a material value said out of turn was dropped
     * entirely, which made the one thing an investor most wants
     * honoured the thing most likely to be lost.
     */
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "Understood.",
          answers: [
            {
              stepKey: "I7.hard_exclusions",
              value: ["gambling", "adult_content"],
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          askNext: "I2.stages",
        },
        // A turn about something else entirely.
        { ...base, intent: "SMALL_TALK", reply: "Of course." },
        // And finally the yes.
        {
          ...base,
          intent: "ANSWER",
          reply: "Right you are.",
          confirmations: [
            { stepKey: "I7.hard_exclusions", decision: "CONFIRMED" },
          ],
        },
      ),
      logger,
    });

    const first = await interviewer.turn(
      turn(world, "Whatever happens, no gambling or adult content."),
    );
    // Read back in their own words, and not written on one say-so.
    expect(first.reply).toContain("Gambling");
    expect(first.reply).toContain("Adult content");
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();

    // A turn about something else does not lose it.
    await interviewer.turn(turn(world, "sorry, my dog was barking"));
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();

    // And the yes, whenever it comes, writes exactly what they said —
    // without the question ever having been asked a second time.
    await interviewer.turn(turn(world, "Yes, that's right."));
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling", "adult_content"],
    });
  });

  it("keeps a confirmed exclusion the journey is not ready for", async () => {
    // Said yes to, and refused for a prerequisite. This is the worst
    // place to lose a value: they have read it back and agreed to it.
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: ANSWERED,
      refuseUntil: { "I7.hard_exclusions": "I2.stages" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "Understood.",
          answers: [
            {
              stepKey: "I7.hard_exclusions",
              value: ["gambling"],
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
        },
        {
          ...base,
          intent: "ANSWER",
          reply: "Noted.",
          confirmations: [
            { stepKey: "I7.hard_exclusions", decision: "CONFIRMED" },
          ],
        },
        { ...base, intent: "SMALL_TALK", reply: "Sure." },
      ),
      logger,
    });

    await interviewer.turn(turn(world, "Never gambling."));
    await interviewer.turn(turn(world, "Yes."));
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();

    // The prerequisite lands in the ordinary course of the interview,
    // and the confirmed value goes in without being asked for again.
    world.record("I2.stages", { type: "MULTI_SELECT", optionKeys: ["seed"] });
    await interviewer.turn(turn(world, "carry on"));
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling"],
    });
  });
});
