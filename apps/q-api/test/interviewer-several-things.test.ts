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

describe("ACC a · a preference about revenue is not a figure to read back", () => {
  it("records the revenue expectation straight away instead of holding it for a yes", async () => {
    const world = investorSession({
      currentStepKey: "I4.revenue_state",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Revenue expected. What else matters to you?",
        answers: [
          {
            stepKey: "I4.revenue_state",
            value: "revenue_required",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "they need to have revenue"),
    );
    expect(outcome.recorded).toEqual(["I4.revenue_state"]);
    expect(outcome.trace?.persisted.held).toEqual([]);
  });
});

describe("ACC d · Q never states a value as recorded when the write did not happen", () => {
  it("says a sector exclusion that matched nothing is not down yet, and asks it again", async () => {
    const world = investorSession({
      currentStepKey: "I3.sectors_avoid",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply:
          "Gambling and tobacco avoided, got it. What business models do you like?",
        // Something else in the same turn does land, so nothing looks
        // like a failed turn — the live shape of the defect.
        answers: [
          {
            stepKey: "I4.revenue_state",
            value: "revenue_required",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        categoryPhrases: [
          { stepKey: "I3.sectors_avoid", phrases: ["gambling", "tobacco"] },
        ],
        askNext: "I4.business_models",
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "gambling and tobacco, hard no, and they need revenue"),
    );
    expect(outcome.recorded).toEqual(["I4.revenue_state"]);
    expect(outcome.reply).not.toMatch(/got it/i);
    expect(outcome.reply).toMatch(/haven't got .* down yet/i);
    expect(outcome.asking?.stepKey).toBe("I3.sectors_avoid");
  });
});

describe("ACC e · Q offers to finish only when the journey can finish", () => {
  it("names what is left instead of letting a wrap-up offer stand over an open required step", async () => {
    const world = investorSession({
      currentStepKey: "I4.revenue_state",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply:
          "That covers the essentials. Shall we wrap up and head to your discovery feed?",
        answers: [
          {
            stepKey: "I4.revenue_state",
            value: "revenue_required",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: null,
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "they need revenue, that's all"),
    );
    expect(outcome.recorded).toEqual(["I4.revenue_state"]);
    expect(outcome.reply).not.toMatch(/wrap up/i);
    expect(outcome.reply).toMatch(/Before we finish, one more thing\./);
    expect(outcome.asking).not.toBeNull();
    expect(outcome.navigate).toBeNull();
  });
});

describe("round 1 #1 · a yes covers the value on screen", () => {
  it("commits the read-back value when the model confirmed another held value instead", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_min",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(HOLDS_CHEQUES, {
        ...base,
        intent: "ANSWER",
        reply: "Good.",
        // The model attached the yes to the value they mentioned, not to
        // the one Q read back.
        confirmations: [{ stepKey: "I2.cheque_max", decision: "CONFIRMED" }],
        reading: reading({}),
      }),
      logger,
    });
    const held = await interviewer.turn(turn(world, "25k to 250k"));
    expect(held.asking?.stepKey).toBe("I2.cheque_min");
    const outcome = await interviewer.turn(
      turn(world, "yep. and the 250k top end stands"),
    );
    expect(outcome.recorded).toEqual(
      expect.arrayContaining(["I2.cheque_min", "I2.cheque_max"]),
    );
    expect(outcome.reply).not.toMatch(/differently/i);
  });
});

describe("round 1 #5 · only what committed is said as committed", () => {
  it("names the place it could not find instead of confirming both", async () => {
    const world = investorSession({
      currentStepKey: "I3.geography",
      recorded: MANDATE_SO_FAR,
      taxonomy: { ghana: "a1b2c3d4-0000-4000-8000-000000000001" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Got it, just Ghana and Côte d'Ivoire. How firm is that?",
        categoryPhrases: [
          { stepKey: "I3.geography", phrases: ["Ghana", "Côte d'Ivoire"] },
        ],
        askNext: "I3.geography_strength",
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "just ghana and cote d'ivoire"),
    );
    expect(outcome.recorded).toEqual(["I3.geography"]);
    expect(outcome.reply).not.toMatch(/Got it, just Ghana and/);
    expect(outcome.reply).toMatch(/I've put down Ghana\./);
    expect(outcome.reply).toMatch(/couldn't find Côte d'Ivoire/);
  });
});

describe("round 1 #7 · a settled step is not asked again", () => {
  it("does not re-ask an avoid-list the person already set aside", async () => {
    const world = investorSession({
      currentStepKey: "I4.revenue_state",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Nothing to avoid, then.",
        unrestricted: [{ stepKey: "I3.sectors_avoid" }],
        askNext: "I3.sectors_avoid",
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "there's nothing else to avoid"),
    );
    expect(outcome.skipped).toEqual(["I3.sectors_avoid"]);
    expect(outcome.asking?.stepKey).not.toBe("I3.sectors_avoid");
  });
});

describe("round 1 #8 · never a bare step label as Q's line", () => {
  it("asks the step properly when the reply is only its label", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_typical",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Typical cheque",
        askNext: "I2.cheque_typical",
        reading: reading({ kind: "CONTROL" }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "ok"));
    expect(outcome.reply).not.toBe("Typical cheque");
    expect(outcome.reply).toMatch(/\?/);
  });
});

describe("the interview thread is kept server-side (CQ-QX-006)", () => {
  it("appends what the person said and what Q said, once per turn, on the channel it came by", async () => {
    const world = investorSession({
      currentStepKey: "I4.revenue_state",
      recorded: MANDATE_SO_FAR,
    });
    const kept: unknown[] = [];
    const fetch: typeof globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/turns")) {
        kept.push(
          JSON.parse(typeof init?.body === "string" ? init.body : "null"),
        );
        return Promise.resolve(Response.json({ written: true }));
      }
      return world.fetch(input, init);
    };
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Revenue expected, then. What else matters to you?",
        answers: [
          {
            stepKey: "I4.revenue_state",
            value: "revenue_required",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });
    await interviewer.turn(
      turn({ ...world, fetch }, "they need to have revenue"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      turns: [
        {
          role: "PERSON",
          text: "they need to have revenue",
          channel: "TEXT",
          stepKey: "I4.revenue_state",
        },
        { role: "Q", channel: "TEXT" },
      ],
    });
  });
});

describe("F3 · no instruction to the model is ever said to the person", () => {
  it("removes a platform instruction the model read out verbatim", async () => {
    const world = investorSession({
      currentStepKey: "I4.revenue_state",
      recorded: MANDATE_SO_FAR,
    });
    const leaked =
      "Live public research is NOT reachable right now: put nothing in questionForQ and never promise to look something up.";
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: `${leaked} Which revenue stage do you expect?`,
        askNext: "I4.revenue_state",
        reading: reading({ kind: "CONTROL" }),
      }),
      logger,
      research: { available: () => false },
    });
    const outcome = await interviewer.turn(turn(world, "ok"));
    expect(outcome.reply).not.toContain("questionForQ");
    expect(outcome.reply).not.toContain("NOT reachable");
    expect(outcome.reply).toContain("Which revenue stage do you expect?");
  });

  it("offers Type once over voice, in the platform's own words, on a question with nothing to tap", async () => {
    const world = investorSession({
      currentStepKey: "I0.business_title",
      recorded: MANDATE_SO_FAR,
    });
    const asks = {
      ...base,
      intent: "ANSWER" as const,
      reply: "What's your title there?",
      askNext: "I0.business_title",
      reading: reading({ kind: "CONTROL" }),
    };
    const interviewer = createInterviewer({
      gateway: gateway(asks, asks),
      logger,
    });
    const voice = (said: string) =>
      interviewer.turn({ ...turn(world, said), channel: "voice" });
    const first = await voice("ok");
    const second = await voice("hmm");
    expect(first.reply).toMatch(/tap Type/);
    expect(second.reply).not.toMatch(/tap Type/);
    expect(first.reply).not.toMatch(/mention once|Once only/);
  });
});

describe("round 1 c · the step Q asked governs where the answer goes", () => {
  it("holds 'strong' for a read-back instead of writing it to the current step when Q had asked another", async () => {
    const world = investorSession({
      currentStepKey: "I3.geography_strength",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway(
        // Q declared the sector-strength question as asked…
        {
          ...base,
          intent: "ANSWER",
          reply: "How firm is your sector preference?",
          askNext: "I3.sector_strength",
          reading: reading({ kind: "CONTROL" }),
        },
        // …and the model then put the answer on the journey's current step.
        {
          ...base,
          intent: "ANSWER",
          reply: "Strong, then.",
          answers: [
            {
              stepKey: "I3.geography_strength",
              value: "must",
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          reading: reading({}),
        },
      ),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const outcome = await interviewer.turn(turn(world, "strong"));
    expect(outcome.recorded).not.toContain("I3.geography_strength");
    expect(world.recordedValue("I3.geography_strength")).toBeUndefined();
    expect(outcome.trace?.persisted.held).toContain("I3.geography_strength");
    expect(outcome.reply).toMatch(/Is that right\?/);
  });
});

describe("a returning person is never met as new", () => {
  it("opens on the next question, without a first-meeting greeting, when anything is on record", async () => {
    const world = investorSession({
      currentStepKey: "I4.revenue_state",
      recorded: MANDATE_SO_FAR,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "OPENING",
        reply: "Good to meet you, Ama. What revenue do you expect?",
        askNext: "I4.revenue_state",
        reading: reading({ kind: "CONTROL" }),
      }),
      logger,
    });
    const opening = await interviewer.turn(turn(world, ""));
    expect(opening.reply).not.toMatch(/meet you/i);
    expect(opening.asking?.stepKey).toBe("I4.revenue_state");
  });
});

describe("round 2 #1 · words that cannot be placed yet are kept, not dropped", () => {
  it("holds sectors heard before the lookup can run, and records them once it can", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      taxonomy: { senegal: "a1b2c3d4-0000-4000-8000-000000000002" },
    });
    let lookupWorks = false;
    const fetch: typeof globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/taxonomy/candidates") && !lookupWorks) {
        return Promise.resolve(
          Response.json(
            { title: "Forbidden", status: 403, code: "FORBIDDEN" },
            { status: 403 },
          ),
        );
      }
      return world.fetch(input, init);
    };
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "Senegal, got it. How do you invest?",
          categoryPhrases: [{ stepKey: "I3.geography", phrases: ["Senegal"] }],
          askNext: "I0.investor_type",
          reading: reading({}),
        },
        {
          ...base,
          intent: "ANSWER",
          reply: "An angel, then.",
          answers: [
            {
              stepKey: "I0.investor_type",
              value: "angel",
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          reading: reading({}),
        },
      ),
      logger,
    });
    const first = await interviewer.turn(
      turn({ ...world, fetch }, "I only do Senegal"),
    );
    expect(first.recorded).toEqual([]);
    expect(first.reply).not.toMatch(/got it/i);
    expect(first.reply).toMatch(/holding it/);
    lookupWorks = true;
    const second = await interviewer.turn(
      turn({ ...world, fetch }, "I'm an angel"),
    );
    expect(second.recorded).toEqual(
      expect.arrayContaining(["I0.investor_type", "I3.geography"]),
    );
  });
});

describe("round 2 #2 · a write refused early in a turn and landed later is not 'unsaved'", () => {
  it("records the cheque once the firm exists in the same turn, and never says it didn't save", async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "angel" },
      refuseUntil: { "I2.cheque_typical": "I0.organisation_name" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Noted.",
        answers: [
          {
            stepKey: "I2.cheque_typical",
            value: "20000",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
          {
            stepKey: "I0.organisation_name",
            value: "Coastline Capital",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        reading: reading({}),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(
        world,
        "typical is 20 thousand pounds, put the firm down as Coastline Capital",
      ),
    );
    expect(outcome.recorded).toContain("I0.organisation_name");
    expect(outcome.reply).not.toMatch(/didn't save/);
  });
});
