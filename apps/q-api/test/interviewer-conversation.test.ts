import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import type {
  ConversationTurnReading,
  InterviewConductorResult,
} from "@capital-q/q-core";

import {
  createInterviewer,
  type InterviewGateway,
} from "../src/voice/interviewer.js";

import {
  base,
  gateway,
  investorSession,
  turn,
} from "./interviewer-fixtures.js";

/**
 * The onboarding conversation is a conversation, not a form (CQ-QX-005).
 *
 * Every case here is one of the ways the hosted session failed, asserted
 * on what the runtime recorded and on the conversation core's own state —
 * never on a model's opinion. A model double supplies the reading; code
 * decides what it may do.
 */

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

const SESSION_ID = "f0000000-0000-4000-8000-000000000010";

const ANSWERED = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Zino Aviation",
  "I1.deployment_status": "actively_investing",
};

const clear = (
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

/** Q asking the founding-team question, so it is the question in hand. */
const ASKS_FOUNDERS: InterviewConductorResult = {
  ...base,
  intent: "ANSWER",
  reply: "Which capabilities in a founding team matter to you?",
  askNext: "I5.founder_preferences",
  showOptions: true,
  reading: clear({ kind: "CONTROL" }),
};

describe("a question to Q is answered, not treated as a failed answer", () => {
  it("answers advice in the turn, writes nothing, and keeps the open question on screen", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_FOUNDERS, {
        ...base,
        intent: "QUESTION_FOR_Q",
        reply:
          "Given you're an angel writing early cheques, I'd weight domain expertise and evidence of resilience over pedigree — that's my suggestion, not your preference. Back to the founding team: which of those matter to you?",
        askNext: null,
        reading: clear({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "ADVICE",
            text: "What do you think I should look for?",
            about: [],
          },
        }),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const before = world.attempts().length;
    const outcome = await interviewer.turn(
      turn(world, "What do you think I should look for?"),
    );
    expect(outcome.recorded).toEqual([]);
    expect(world.attempts().length).toBe(before);
    expect(outcome.reply).toMatch(/^Given you're an angel/);
    // No repair, no apology: a question is a question.
    expect(outcome.reply).not.toMatch(/didn't catch|couldn't place/i);
    expect(outcome.questionForQ).toBeNull();
    expect(outcome.asking?.stepKey).toBe("I5.founder_preferences");
    expect(outcome.trace?.classification.question).toBe("ADVICE");
    expect(interviewer.conversation(SESSION_ID).answering).toBeNull();
  });
});

describe("a choice made by pointing at the screen", () => {
  it("records 'the last two' against the options Q actually showed", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_FOUNDERS, {
        ...base,
        intent: "ANSWER",
        reply: "Domain expertise and enterprise sales, then.",
        askNext: "I6.green_flags",
        reading: clear({
          references: [
            { target: "I5.founder_preferences", select: "LAST", count: 2 },
          ],
        }),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const outcome = await interviewer.turn(turn(world, "the last two"));
    expect(outcome.recorded).toEqual(["I5.founder_preferences"]);
    expect(world.recordedValue("I5.founder_preferences")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["deep_domain_expertise", "enterprise_sales_experience"],
    });
    expect(outcome.trace?.extracted.references).toEqual([
      "I5.founder_preferences:LAST",
    ]);
  });

  it("records 'the last four' — the live utterance that was refused as 'I couldn't place that'", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_FOUNDERS, {
        ...base,
        intent: "ANSWER",
        reply: "All four, then. What makes you lean in on a company?",
        askNext: "I6.green_flags",
        reading: clear({
          references: [
            { target: "I5.founder_preferences", select: "LAST", count: 4 },
          ],
        }),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const outcome = await interviewer.turn(turn(world, "the last four"));
    expect(outcome.recorded).toEqual(["I5.founder_preferences"]);
    expect(world.recordedValue("I5.founder_preferences")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: [
        "technical_founding_capability",
        "repeat_founder_experience",
        "deep_domain_expertise",
        "enterprise_sales_experience",
      ],
    });
    expect(outcome.reply).not.toMatch(/couldn't place/i);
    expect(outcome.trace?.repair).toBeNull();
  });

  it("adds 'and the second one too' to a selection already on the record, and never replaces it by plain pointing", async () => {
    for (const select of ["ADD", "ORDINAL"] as const) {
      const world = investorSession({
        currentStepKey: "I6.custom_criteria",
        recorded: { ...ANSWERED, "I6.green_flags": "high_retention" },
      });
      const interviewer = createInterviewer({
        gateway: gateway({
          ...base,
          intent: "ANSWER",
          reply: "Capital efficiency as well.",
          askNext: "I6.custom_criteria",
          reading: clear({
            references: [{ target: "I6.green_flags", select, ordinals: [2] }],
          }),
        }),
        logger,
      });
      const outcome = await interviewer.turn(
        turn(world, "and the second one too"),
      );
      if (select === "ADD") {
        expect(outcome.recorded).toEqual(["I6.green_flags"]);
        expect(world.recordedValue("I6.green_flags")).toEqual({
          type: "MULTI_SELECT",
          optionKeys: ["high_retention", "capital_efficiency"],
        });
      } else {
        expect(outcome.recorded).toEqual([]);
        expect(world.recordedValue("I6.green_flags")).toEqual({
          type: "MULTI_SELECT",
          optionKeys: ["high_retention"],
        });
      }
    }
  });

  it("asks rather than guessing when nothing was on screen to point at", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "The second one.",
        askNext: null,
        reading: clear({
          references: [
            {
              target: "I5.founder_preferences",
              select: "ORDINAL",
              ordinals: [9],
            },
          ],
        }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "the ninth one"));
    expect(outcome.recorded).toEqual([]);
    expect(outcome.reply).toContain("founding-team capabilities");
    expect(outcome.asking?.stepKey).toBe("I5.founder_preferences");
  });
});

describe("noise is a transcription matter, and never a reasoning one", () => {
  it("asks for a fragment once more, writes nothing, and does not say the same thing twice", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const fragment: InterviewConductorResult = {
      ...base,
      intent: "UNCLEAR",
      reply: "Sorry?",
      askNext: "I5.founder_preferences",
      answers: [
        {
          stepKey: "I5.founder_preferences",
          value: ["repeat_founder_experience"],
          confidence: "HIGH",
          clarity: "SETTLED",
        },
      ],
      reading: clear({ kind: "UNCLEAR_TRANSCRIPT", transcript: "FRAGMENT" }),
    };
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_FOUNDERS, fragment, fragment, fragment),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const first = await interviewer.turn(turn(world, "the— rep—"));
    const second = await interviewer.turn(turn(world, "rep— the"));
    const third = await interviewer.turn(turn(world, "—"));
    // Nothing the model half-heard is written.
    expect(world.recordedValue("I5.founder_preferences")).toBeUndefined();
    expect(first.reply).toMatch(/say it once more/i);
    expect(first.reply).not.toMatch(/understand|place/i);
    expect(second.reply).not.toBe(first.reply);
    expect(third.reply).not.toBe(second.reply);
    expect(first.trace?.transcript).toBe("FRAGMENT");
    expect(interviewer.conversation(SESSION_ID).failures.TRANSCRIPT).toBe(3);
    expect(interviewer.conversation(SESSION_ID).failures.PARSE).toBe(0);
  });
});

describe("a correction after a misinterpretation reaches the record", () => {
  it("rewrites the step that was already answered", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "CORRECTION",
        reply: "A family office, not an angel — changed.",
        answers: [
          {
            stepKey: "I0.investor_type",
            value: "family_office",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I2.stages",
        reading: clear({ kind: "CORRECTION" }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "No — we're a family office, not an angel."),
    );
    expect(outcome.recorded).toEqual(["I0.investor_type"]);
    expect(world.recordedValue("I0.investor_type")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "family_office",
    });
  });

  it("does not ask the corrected step again: it says what changed and moves on", async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      recorded: { "I0.investor_type": "vc" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "CORRECTION",
        // Live, 2026-09-24: the model asked the very step it had just
        // corrected, so the person heard Q ignore the correction.
        reply:
          "No problem at all. Are you investing as an individual angel, or through a syndicate?",
        answers: [
          {
            stepKey: "I0.investor_type",
            value: "angel",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I0.investor_type",
        reading: clear({ kind: "CORRECTION" }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(
        world,
        "No wait, sorry — I'm actually an angel investor, not a fund.",
      ),
    );
    expect(outcome.recorded).toEqual(["I0.investor_type"]);
    expect(outcome.asking?.stepKey).not.toBe("I0.investor_type");
    // What changed, by the step's name — not its option label read back.
    expect(outcome.reply).toMatch(/^I've updated your /);
    expect(outcome.reply).not.toMatch(/individual angel/);
  });

  it("does not let a clarification, an aside or a question rewrite anything", async () => {
    for (const kind of [
      "CLARIFICATION",
      "SMALL_TALK",
      "QUESTION_TO_Q",
    ] as const) {
      const world = investorSession({
        currentStepKey: "I2.stages",
        recorded: ANSWERED,
      });
      const interviewer = createInterviewer({
        gateway: gateway({
          ...base,
          intent: "ANSWER",
          reply: "…",
          answers: [
            {
              stepKey: "I0.investor_type",
              value: "family_office",
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          reading: clear({
            kind,
            question:
              kind === "QUESTION_TO_Q"
                ? { kind: "ADVICE", text: "what would you do?", about: [] }
                : null,
          }),
        }),
        logger,
      });
      const outcome = await interviewer.turn(turn(world, "…"));
      expect(outcome.recorded, kind).toEqual([]);
      expect(world.recordedValue("I0.investor_type"), kind).toEqual({
        type: "SINGLE_SELECT",
        optionKey: "angel",
      });
    }
  });
});

describe("meaning the options cannot hold is kept, not reduced", () => {
  it("keeps 'as long as they've got the grit' beside the field, sets no option, and skips nothing", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(ASKS_FOUNDERS, {
        ...base,
        intent: "ANSWER",
        reply:
          "Grit over pedigree — I'll keep that in your words. Anything on the list that matters too, or shall we move on?",
        askNext: "I5.founder_preferences",
        reading: clear({
          qualitative: [
            {
              target: "I5.founder_preferences",
              meaning:
                "Grit and resilience matter; prior pedigree, repeat-founder or technical status are not required.",
            },
          ],
        }),
      }),
      logger,
    });
    await interviewer.turn(turn(world, "ok"));
    const outcome = await interviewer.turn(
      turn(
        world,
        "it doesn't really matter as long as they've got the grit to do it",
      ),
    );
    expect(world.recordedValue("I5.founder_preferences")).toBeUndefined();
    expect(world.skippedSteps()).toEqual([]);
    expect(outcome.qualitative).toEqual([
      {
        target: "I5.founder_preferences",
        meaning:
          "Grit and resilience matter; prior pedigree, repeat-founder or technical status are not required.",
      },
    ]);
    // The model's own words stand: this was not a failure to place.
    expect(outcome.reply).toMatch(/^Grit over pedigree/);
    expect(outcome.trace?.repair).toBeNull();
  });

  it("writes the kept meaning as the response's own note when a value for the step lands", async () => {
    const bodies: unknown[] = [];
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const recording: typeof fetch = (input, init) => {
      if (init?.method === "POST" && typeof init.body === "string") {
        bodies.push(JSON.parse(init.body));
      }
      return world.fetch(input, init);
    };
    const interviewer = createInterviewer({
      gateway: gateway(
        {
          ...base,
          intent: "ANSWER",
          reply: "Noted in your words.",
          askNext: "I5.founder_preferences",
          reading: clear({
            qualitative: [
              {
                target: "I5.founder_preferences",
                meaning: "Grit matters more than pedigree.",
              },
            ],
          }),
        },
        {
          ...base,
          intent: "ANSWER",
          reply: "Domain expertise as well.",
          answers: [
            {
              stepKey: "I5.founder_preferences",
              value: ["deep_domain_expertise"],
              confidence: "HIGH",
              clarity: "SETTLED",
            },
          ],
          askNext: "I6.green_flags",
        },
      ),
      logger,
    });
    const input = turn(world, "as long as they've got the grit");
    const session = { ...input.session, fetch: recording };
    await interviewer.turn({ ...input, session });
    const outcome = await interviewer.turn({
      ...turn(world, "and domain expertise"),
      session,
    });
    expect(outcome.recorded).toEqual(["I5.founder_preferences"]);
    expect(bodies).toContainEqual(
      expect.objectContaining({
        stepKey: "I5.founder_preferences",
        response: {
          value: {
            type: "MULTI_SELECT",
            optionKeys: ["deep_domain_expertise"],
          },
          note: "Grit matters more than pedigree.",
        },
      }),
    );
  });
});

describe("confidence decides what is written", () => {
  it("holds an inferred (MEDIUM) reading for a yes instead of writing it", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Early stage, so seed?",
        answers: [
          {
            stepKey: "I2.stages",
            value: ["seed"],
            confidence: "MEDIUM",
            clarity: "SETTLED",
          },
        ],
        askNext: "I2.stages",
        reading: clear({ confidence: "MEDIUM" }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "the early ones"));
    expect(outcome.recorded).toEqual([]);
    expect(world.recordedValue("I2.stages")).toBeUndefined();
    // The model's own read-back question stands; the runtime asks the
    // held step rather than moving on past it.
    expect(outcome.reply).toMatch(/\?$/);
    expect(outcome.asking?.stepKey).toBe("I2.stages");
    expect(outcome.trace?.persisted.held).toEqual(["I2.stages"]);
  });

  it("asks a targeted question with its best reading when it was guessing (LOW)", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Seed, I think.",
        answers: [
          {
            stepKey: "I2.stages",
            value: ["seed"],
            confidence: "MEDIUM",
            clarity: "SETTLED",
          },
        ],
        askNext: "I2.stages",
        reading: clear({ confidence: "LOW" }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "the small ones"));
    expect(outcome.recorded).toEqual([]);
    expect(outcome.trace?.persisted.held).toEqual([]);
    expect(outcome.reply).toMatch(/^Do you mean Seed\?/);
    expect(outcome.trace?.repair).toBe("OFFER_INTERPRETATION");
  });
});

describe("a suggestion of Q's is never the declared mandate", () => {
  it("is held until the person says yes, then written as their own answer; a no drops it", async () => {
    const suggestion = {
      target: "I6.green_flags",
      value: ["capital_efficiency"],
      because: "pre-seed with a small cheque",
    };
    const suggests: InterviewConductorResult = {
      ...base,
      intent: "ANSWER",
      reply:
        "Given the small cheques, you may also care about capital efficiency — shall I add that?",
      askNext: "I6.green_flags",
      reading: clear({ kind: "SMALL_TALK", suggestions: [suggestion] }),
    };
    const yes: InterviewConductorResult = {
      ...base,
      intent: "ANSWER",
      reply: "Added.",
      confirmations: [{ stepKey: "I6.green_flags", decision: "CONFIRMED" }],
      askNext: "I6.custom_criteria",
      reading: clear({ kind: "ANSWER" }),
    };
    const no: InterviewConductorResult = {
      ...yes,
      reply: "Left out.",
      confirmations: [{ stepKey: "I6.green_flags", decision: "REJECTED" }],
    };

    const agreed = investorSession({
      currentStepKey: "I6.green_flags",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway(suggests, yes),
      logger,
    });
    const offered = await interviewer.turn(turn(agreed, "hmm"));
    expect(offered.recorded).toEqual([]);
    expect(agreed.recordedValue("I6.green_flags")).toBeUndefined();
    expect(interviewer.conversation(SESSION_ID).proposals).toHaveLength(1);
    const taken = await interviewer.turn(turn(agreed, "yes, add it"));
    expect(taken.recorded).toEqual(["I6.green_flags"]);
    expect(agreed.recordedValue("I6.green_flags")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["capital_efficiency"],
    });
    expect(interviewer.conversation(SESSION_ID).proposals).toHaveLength(0);

    const declined = investorSession({
      currentStepKey: "I6.green_flags",
      recorded: ANSWERED,
    });
    const refusing = createInterviewer({
      gateway: gateway(suggests, no),
      logger,
    });
    await refusing.turn(turn(declined, "hmm"));
    const dropped = await refusing.turn(turn(declined, "no thanks"));
    expect(dropped.recorded).toEqual([]);
    expect(declined.recordedValue("I6.green_flags")).toBeUndefined();
    expect(refusing.conversation(SESSION_ID).proposals).toHaveLength(0);
  });
});

describe("a tension is raised like an analyst, not recorded silently", () => {
  it("writes the settled value and holds the one the tension names, in the model's own words", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply:
          "Pre-seed and strong revenue growth as a must-have pull against each other — most pre-seed companies have no revenue yet. Which do you mean?",
        answers: [
          {
            stepKey: "I2.stages",
            value: ["pre_seed"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
          {
            stepKey: "I6.green_flags",
            value: ["strong_revenue_growth"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I6.green_flags",
        reading: clear({
          tensions: [
            {
              targets: ["I6.green_flags"],
              note: "pre-seed with revenue growth as a must-have",
            },
          ],
        }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "Pre-seed, and strong revenue growth is a must."),
    );
    expect(outcome.recorded).toEqual(["I2.stages"]);
    expect(world.recordedValue("I6.green_flags")).toBeUndefined();
    expect(outcome.trace?.persisted.held).toEqual(["I6.green_flags"]);
    expect(outcome.reply).toMatch(/pull against each other/);
    expect(outcome.reply).not.toMatch(/error|invalid/i);
  });
});

describe("one degraded subsystem never makes Q unusable", () => {
  it("names a reasoning outage narrowly, stops nagging, and never says the same thing twice running", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const down: InterviewGateway = {
      execute: () => Promise.reject(new Error("provider 503")),
    };
    const interviewer = createInterviewer({ gateway: down, logger });
    const replies: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const outcome = await interviewer.turn(turn(world, "seed"));
      expect(outcome.degraded).toBe(true);
      expect(outcome.recorded).toEqual([]);
      replies.push(outcome.reply);
    }
    expect(replies[0]).toMatch(/reasoning service/i);
    expect(replies[1]).toMatch(/stop trying/i);
    for (let i = 1; i < replies.length; i += 1) {
      expect(replies[i]).not.toBe(replies[i - 1]);
    }
    for (const reply of replies) {
      expect(reply.toLowerCase()).not.toContain("didn't catch");
    }
    expect(interviewer.conversation(SESSION_ID).failures.MODEL).toBe(4);
  });

  it("returns control to the open question once a research run has ended", async () => {
    const world = investorSession({
      currentStepKey: "I5.founder_preferences",
      recorded: ANSWERED,
    });
    const prompts: string[] = [];
    const results: InterviewConductorResult[] = [
      ASKS_FOUNDERS,
      {
        ...base,
        intent: "QUESTION_FOR_Q",
        reply: "Let me find one.",
        questionForQ:
          "An example of a real aviation-focused early-stage investor.",
        askNext: null,
        reading: clear({
          kind: "QUESTION_TO_Q",
          question: {
            kind: "REAL_WORLD_EXAMPLE",
            text: "Can you give me an example of a real investor similar to me?",
            about: [],
          },
        }),
      },
      {
        ...base,
        intent: "ANSWER",
        reply: "Back to the founding team, then.",
        askNext: "I5.founder_preferences",
        reading: clear({ kind: "CONTROL" }),
      },
    ];
    let index = 0;
    const recording: InterviewGateway = {
      execute: (request) => {
        prompts.push(
          (request.messages as readonly { readonly content: string }[])
            .map((m) => m.content)
            .join("\n"),
        );
        const value = results[Math.min(index, results.length - 1)];
        index += 1;
        return Promise.resolve({
          output: { kind: "STRUCTURED", value },
        } as never);
      },
    };
    const interviewer = createInterviewer({ gateway: recording, logger });
    await interviewer.turn({ ...turn(world, "ok"), channel: "voice" });
    const asked = await interviewer.turn({
      ...turn(world, "give me a real example of an investor like me"),
      channel: "voice",
    });
    expect(asked.questionForQ).not.toBeNull();
    expect(asked.resume?.stepKey).toBe("I5.founder_preferences");
    expect(asked.resume?.question).toContain("founding-team capabilities");
    expect(interviewer.conversation(SESSION_ID).research).not.toBeNull();

    // The caller carried the run and reports how it ended.
    interviewer.researchEnded(SESSION_ID, true);
    expect(interviewer.conversation(SESSION_ID).research).toBeNull();
    expect(interviewer.conversation(SESSION_ID).failures.RESEARCH).toBe(0);

    const after = await interviewer.turn({
      ...turn(world, "thanks"),
      channel: "voice",
    });
    // The model was told, in the platform's own words, which question to
    // return to — and the screen shows it again.
    expect(prompts[2]).toContain("OPEN QUESTION TO RETURN TO");
    expect(prompts[2]).toContain("I5.founder_preferences");
    expect(after.asking?.stepKey).toBe("I5.founder_preferences");
    expect(interviewer.conversation(SESSION_ID).resumeTopic).toBeNull();
  });
});

describe("what the live run taught the placement", () => {
  it("classifies a category given as an answer instead of refusing it as words", async () => {
    const world = investorSession({
      currentStepKey: "I3.sectors",
      recorded: ANSWERED,
      taxonomy: { marketplaces: "aaaaaaaa-0000-4000-8000-000000000001" },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Marketplaces. Where do you invest?",
        answers: [
          {
            stepKey: "I3.sectors",
            value: ["marketplaces"],
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I3.geography",
      }),
      logger,
    });
    const outcome = await interviewer.turn(turn(world, "Marketplaces"));
    expect(outcome.recorded).toEqual(["I3.sectors"]);
    expect(world.recordedValue("I3.sectors")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: ["aaaaaaaa-0000-4000-8000-000000000001"],
    });
    expect(outcome.trace?.repair).toBeNull();
  });

  it("does not treat a restated answer as a failed turn", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "ANSWER",
        reply: "Right, an angel. Which stages do you invest at?",
        answers: [
          {
            stepKey: "I0.investor_type",
            value: "angel",
            confidence: "HIGH",
            clarity: "SETTLED",
          },
        ],
        askNext: "I2.stages",
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "Yes, an angel, as I said."),
    );
    expect(outcome.recorded).toEqual([]);
    expect(outcome.reply).toBe(
      "Right, an angel. Which stages do you invest at?",
    );
    expect(outcome.trace?.repair).toBeNull();
  });

  it("sets aside a step a correction withdraws, and never one a question names", async () => {
    const withdraw = (kind: "CORRECTION" | "QUESTION_TO_Q") =>
      ({
        ...base,
        intent: kind === "CORRECTION" ? "CORRECTION" : "QUESTION_FOR_Q",
        reply: "…",
        askNext: "I4.business_models",
        reading: clear({
          kind,
          clears: ["I3.sectors_avoid"],
          question:
            kind === "QUESTION_TO_Q"
              ? { kind: "ADVICE", text: "should I avoid anything?", about: [] }
              : null,
        }),
      }) satisfies InterviewConductorResult;
    for (const kind of ["CORRECTION", "QUESTION_TO_Q"] as const) {
      const world = investorSession({
        currentStepKey: "I4.business_models",
        recorded: {
          ...ANSWERED,
          "I3.sectors_avoid": "aaaaaaaa-0000-4000-8000-000000000009",
        },
      });
      const interviewer = createInterviewer({
        gateway: gateway(withdraw(kind)),
        logger,
      });
      const outcome = await interviewer.turn(
        turn(world, "there's nothing I'd avoid after all"),
      );
      expect(outcome.skipped, kind).toEqual(
        kind === "CORRECTION" ? ["I3.sectors_avoid"] : [],
      );
    }
  });

  it("says an answer it could not take back still stands, instead of repairing another question", async () => {
    const world = investorSession({
      currentStepKey: "I4.business_models",
      recorded: ANSWERED,
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "CORRECTION",
        reply: "Cleared.",
        askNext: "I4.business_models",
        reading: clear({ kind: "CORRECTION", clears: ["I0.investor_type"] }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "forget what I said about being an angel"),
    );
    expect(outcome.skipped).toEqual([]);
    expect(outcome.recorded).toEqual([]);
    expect(outcome.reply).toMatch(/earlier answer stands/i);
    expect(outcome.reply).not.toBe("Cleared.");
    expect(outcome.trace?.repair).toBeNull();
  });

  it("lets a correction clear an optional step that already holds something", async () => {
    const world = investorSession({
      currentStepKey: "I4.business_models",
      recorded: {
        ...ANSWERED,
        "I3.sectors_avoid": "aaaaaaaa-0000-4000-8000-000000000009",
      },
    });
    const interviewer = createInterviewer({
      gateway: gateway({
        ...base,
        intent: "CORRECTION",
        reply: "Nothing to avoid, then.",
        unrestricted: [{ stepKey: "I3.sectors_avoid" }],
        askNext: "I4.business_models",
        reading: clear({ kind: "CORRECTION" }),
      }),
      logger,
    });
    const outcome = await interviewer.turn(
      turn(world, "Actually there's nothing I'd avoid."),
    );
    expect(outcome.skipped).toEqual(["I3.sectors_avoid"]);
    expect(world.skippedSteps()).toEqual(["I3.sectors_avoid"]);
  });
});
