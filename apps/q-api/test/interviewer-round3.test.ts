import { describe, expect, it } from "vitest";

import { FOUNDER_DEFINITION_V2 } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import { createLogger } from "@capital-q/observability";
import type { ConversationTurnReading } from "@capital-q/q-core";

import { createInterviewer, questionFor } from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * ACC round 3 (acc-inv5, luna): the interview's claims must come from what
 * is stored, a question inside an answer is answered, a held value is never
 * dropped without a yes, and Q never speaks a step label or a fragment.
 * Deterministic doubles: the model's reading is given, the platform's
 * behaviour is asserted.
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
  "I0.organisation_name": "Ember Angels",
  "I1.deployment_status": "actively_investing",
  "I2.currency": "usd",
};

describe("R9 · a claim about the record comes from the record", () => {
  it("holds 'mostly co-investing' for a yes and answers 'did gambling go in?' truthfully when it did not", async () => {
    const world = investorSession({
      currentStepKey: "I2.investment_role",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "QUESTION_FOR_Q",
        // The live reply: two claims, neither true.
        reply:
          "I'll take that as co-investing alongside a lead. And yes, betting and gambling apps are the hard no you mentioned.",
        answers: [
          {
            stepKey: "I2.investment_role",
            value: ["co_invest"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        // The live reading: a question, with values the model still found.
        reading: reading({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "did gambling go in as a hard no?",
            about: ["I7.hard_exclusions"],
          },
        }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(
        world,
        "bet on it being mostly co-investing, we rarely lead. oh and did gambling go in as a hard no?",
      ),
    );
    // Nothing was written blind, and nothing was dropped.
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
    expect(outcome.trace?.persisted.held).toContain("I2.investment_role");
    // No false claim survives.
    expect(outcome.reply).not.toMatch(/and yes/i);
    expect(outcome.reply).not.toMatch(/I'll take that/i);
    // The truthful answer, from the record.
    expect(outcome.reply).toMatch(
      /Not yet: nothing is on your record for your hard exclusions\. Want me to add it\?/,
    );
  });

  it("answers 'did you save the 25k minimum?' from the record while recording the role said in the same breath (A5)", async () => {
    const world = investorSession({
      currentStepKey: "I0.business_title",
      recorded: { ...SO_FAR, "I2.cheque_min": "25000" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Managing partner, got it. Typical cheque",
        answers: [
          {
            stepKey: "I0.business_title",
            value: "Managing partner",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I2.cheque_typical",
        reading: reading({
          question: {
            kind: "THEIR_OWN_RECORDS",
            text: "did you actually save the 25k minimum?",
            about: ["I2.cheque_min"],
          },
        }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(
        world,
        "I'm the lead, managing partner I guess. hang on, did you actually save the 25k minimum? I said yes to that",
      ),
    );
    expect(outcome.recorded).toContain("I0.business_title");
    expect(outcome.reply).toMatch(
      /^Yes, your minimum cheque is on your record: \$25,000\./,
    );
    expect(outcome.reply).toContain("I've also put down your role.");
    // The next question is a whole question, never the bare label.
    expect(outcome.reply).toContain("What's a typical cheque for you?");
    expect(outcome.reply).not.toMatch(/Typical cheque$/);
  });

  it("puts the model's answer back when runtime lines replaced it (a question inside an answer turn)", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Most syndicates in Ghana write 10 to 50 thousand dollars.",
        answers: [
          {
            stepKey: "I2.cheque_min",
            value: "50000",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({
          question: {
            kind: "ADVICE",
            text: "what do other syndicates typically write?",
            about: [],
          },
        }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "fifty grand minimum. what do other syndicates write?"),
    );
    // The figure is read back (material), and the answer is still said.
    expect(outcome.reply).toMatch(/^Most syndicates in Ghana/);
    expect(outcome.reply).toMatch(/Is that right\?$/);
  });
});

describe("a held value is never dropped without a yes", () => {
  it("returns to the held typical cheque once the turn after its read-back has passed", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_typical",
      recorded: SO_FAR,
    });
    const holds = {
      ...base,
      intent: "ANSWER" as const,
      reply: "Noted.",
      answers: [
        {
          stepKey: "I2.cheque_typical",
          value: "20000",
          confidence: "HIGH" as const,
          clarity: "SETTLED" as const,
        },
      ],
      reading: reading({}),
    };
    const elsewhere = {
      ...base,
      intent: "ANSWER" as const,
      reply: "Which stages do you invest at?",
      askNext: "I2.stages",
      reading: reading({ kind: "SMALL_TALK" }),
    };
    const interviewer = createInterviewer({
      gateway: gateway(holds, elsewhere, elsewhere),
      logger,
    });
    const first = await interviewer.turn(turn(world, "20k typical"));
    expect(first.asking?.stepKey).toBe("I2.cheque_typical");
    // The very next turn talks about something else: not asked twice running.
    const second = await interviewer.turn(turn(world, "nice weather today"));
    expect(second.asking?.stepKey).toBe("I2.stages");
    // After that, the held value comes back rather than being forgotten.
    const third = await interviewer.turn(turn(world, "sorry, go on"));
    expect(third.asking?.stepKey).toBe("I2.cheque_typical");
    expect(third.reply).toMatch(/Typical cheque: \$20,000\. Is that right\?$/);
  });
});

describe("never a step label, a fragment, or the step just recorded", () => {
  it("never re-asks the step it has just recorded, even when the model echoes its question (round 2 #4)", async () => {
    const world = investorSession({
      currentStepKey: "I1.deployment_status",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Ember",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Are you deploying capital right now?",
        answers: [
          {
            stepKey: "I1.deployment_status",
            value: "actively_investing",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I1.deployment_status",
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "actively, yeah"));
    expect(outcome.recorded).toEqual(["I1.deployment_status"]);
    expect(outcome.asking?.stepKey).not.toBe("I1.deployment_status");
  });

  it("asks every step of both journeys as a whole question", () => {
    for (const step of [
      ...INVESTOR_DEFINITION_V1.steps,
      ...FOUNDER_DEFINITION_V2.steps,
    ]) {
      const asked = questionFor(step);
      // Starts like a sentence, and is never the bare label with a "?".
      expect(asked.charAt(0), step.stepKey).toMatch(/[A-Z]/);
      expect(asked, step.stepKey).not.toBe(`${step.configuration.prompt}?`);
      expect(asked, step.stepKey).toMatch(/[?.]$/);
      expect(asked.split(/\s+/).length, step.stepKey).toBeGreaterThan(2);
    }
  });

  it("opens after a reload on the question that was on screen, as a whole question (R4)", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "What's a typical cheque for you?",
          askNext: "I2.cheque_typical",
          reading: reading({ kind: "CONTROL" }),
        },
        {
          ...base,
          intent: "OPENING",
          reply: "typical cheque? Just the number is fine.",
          askNext: "I2.cheque_max",
          reading: reading({ kind: "CONTROL" }),
        },
      ),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const opening = await interviewer.turn(turn(world, ""));
    expect(opening.asking?.stepKey).toBe("I2.cheque_typical");
    expect(opening.reply).toBe(
      "What's a typical cheque for you? Just the number is fine.",
    );
  });
});
