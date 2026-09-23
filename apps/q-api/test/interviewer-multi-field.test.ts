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
 * One sentence, four answers, and all four are kept (Workstream A).
 *
 * The engine read the current step and discarded the rest. Live, asked
 * for a role:
 *
 *   them  I'm the founder. We just started investing. Mostly fintech and
 *         software, and we're open globally.
 *   Q     Thanks. And are you deploying capital right now?
 *
 * The title went in and the other three vanished, so Q asked for the
 * deployment status it had just been given, and later for the sectors,
 * and later again for the geography. Nothing was broken in any one
 * component: the journey refuses answers whose prerequisites are unmet,
 * and the runtime simply dropped whatever it refused.
 *
 * Two mechanisms are under test. Every reading the model returns is
 * validated against its own step and committed independently of the
 * current one; and a reading the journey will not take yet is carried
 * and re-offered every turn until it lands, rather than thrown away.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

/** The live utterance, read as the four answers it actually contains. */
const FOUR_IN_ONE: InterviewConductorResult = {
  ...base,
  intent: "ANSWER",
  reply: "Founder, and just getting going. Noted.",
  answers: [
    {
      stepKey: "I0.business_title",
      value: "Founder",
      confidence: "HIGH",
      clarity: "SETTLED",
    },
    {
      stepKey: "I1.deployment_status",
      value: "actively_investing",
      confidence: "MEDIUM",
      clarity: "SETTLED",
    },
  ],
  categoryPhrases: [
    { stepKey: "I3.sectors", phrases: ["fintech", "software"] },
  ],
  unrestricted: [{ stepKey: "I3.geography" }],
  askNext: "I0.organisation_name",
};

describe("one utterance answers several steps", () => {
  it("records every reading the journey will take, not just the current step's", async () => {
    const world = investorSession({
      currentStepKey: "I0.business_title",
      recorded: { "I0.investor_type": "angel", "I0.organisation_name": "Zino" },
      taxonomy: {
        fintech: "44444444-4444-4444-8444-000000000001",
        software: "44444444-4444-4444-8444-000000000002",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway(FOUR_IN_ONE),
      logger,
    });

    const outcome = await interviewer.turn(
      turn(
        world,
        "I'm the founder. We just started investing. Mostly fintech and software, and we're open globally.",
      ),
    );

    // Each one validated against its own step and written independently.
    expect(outcome.recorded).toContain("I0.business_title");
    expect(outcome.recorded).toContain("I1.deployment_status");
    expect(outcome.recorded).toContain("I3.sectors");
    // Geography: the journey records "anywhere" as nothing listed.
    expect(outcome.skipped).toContain("I3.geography");

    // And the session agrees, which is the only evidence that counts.
    expect(world.recordedValue("I0.business_title")).toEqual({
      type: "TEXT",
      text: "Founder",
    });
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
  });

  it("does not ask the person to confirm what they plainly said", async () => {
    // MEDIUM confidence used to force a read-back, which is most of a
    // natural conversation: "I'm the founder" came back as "so your role
    // is Founder, is that right?".
    const world = investorSession({
      currentStepKey: "I0.business_title",
      recorded: { "I0.investor_type": "angel", "I0.organisation_name": "Zino" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(FOUR_IN_ONE),
      logger,
    });

    const outcome = await interviewer.turn(turn(world, "I'm the founder."));

    expect(outcome.recorded).toContain("I1.deployment_status");
    expect(outcome.reply).not.toMatch(/is that right/i);
  });
});

describe("an answer given before its step is never asked for again", () => {
  it("carries a reading the journey refuses, and records it once it will", async () => {
    /**
     * The journey refuses anything in I2 until the stages are in. So a
     * cheque currency volunteered during I0 cannot be written on the
     * turn it is said — and before this it was simply lost.
     */
    const world = investorSession({
      currentStepKey: "I0.business_title",
      recorded: { "I0.investor_type": "angel", "I0.organisation_name": "Zino" },
      // A prerequisite the session does not meet yet.
      refuseUntil: { "I2.currency": "I2.stages" },
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "Noted.",
          answers: [
            {
              stepKey: "I2.currency",
              value: "gbp",
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          askNext: "I0.business_title",
        },
        // The second turn is about something else entirely and says
        // nothing about currency.
        {
          ...base,
          intent: "RESUME",
          reply: "We were on your role.",
          askNext: "I0.business_title",
        },
      ),
      logger,
    });

    // Turn one: refused by the journey, and held rather than dropped.
    const first = await interviewer.turn(turn(world, "We write in sterling."));
    expect(first.recorded).not.toContain("I2.currency");
    expect(world.recordedValue("I2.currency")).toBeUndefined();

    // The prerequisite is met by the ordinary course of the interview.
    world.record("I2.stages", { type: "MULTI_SELECT", optionKeys: ["seed"] });

    // Turn two says nothing about currency at all. The ledger still
    // offers it, and this time the journey takes it.
    const second = await interviewer.turn(turn(world, "What were we saying?"));
    expect(second.recorded).toContain("I2.currency");
    expect(world.recordedValue("I2.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "gbp",
    });
  });

  it("tells the model what it is holding, so Q does not ask for it again", async () => {
    const world = investorSession({
      currentStepKey: "I0.business_title",
      recorded: { "I0.investor_type": "angel", "I0.organisation_name": "Zino" },
      refuseUntil: { "I2.currency": "I2.stages" },
    });
    const seen: unknown[] = [];
    const interviewer = createInterviewer({
      gateway: {
        execute: (request: unknown) => {
          seen.push(request);
          return Promise.resolve({
            output: {
              kind: "STRUCTURED",
              value: {
                ...base,
                intent: "ANSWER",
                reply: "Noted.",
                answers: [
                  {
                    stepKey: "I2.currency",
                    value: "gbp",
                    confidence: "HIGH",
                    clarity: "SETTLED",
                  },
                ],
              },
            },
          } as never);
        },
      },
      logger,
    });

    await interviewer.turn(turn(world, "We write in sterling."));
    await interviewer.turn(turn(world, "Anything else?"));

    // The second prompt carries it, and says plainly that it is held
    // rather than saved — the platform's own state, not the transcript.
    const second = JSON.stringify(seen[1]);
    expect(second).toContain("CARRIED");
    expect(second).toContain("I2.currency");
    expect(second).toContain("never say they are saved");
  });
});
