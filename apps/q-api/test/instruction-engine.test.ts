import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import {
  handleEverythingGrant,
  type InstructionGrant,
} from "@capital-q/contracts";
import {
  DRAFT_INTEGRITY_RULES,
  DRAFT_RUBRIC_CRITERIA,
  type InstructionPlanResult,
  type InstructionThreadFacts,
} from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInstructionEngine,
  inScope,
  MAX_REPLANS,
  meetingWithinWorkingHours,
  staleCards,
  validateStep,
  withinWorkingHours,
  type InstructionPerson,
  type InstructionPlanStep,
} from "../src/composition/instructions/engine.js";
import {
  companyCardFacts,
  mandateFacts,
  type InstructionMaterial,
} from "../src/composition/instructions/material.js";
import { createIntroducedReader } from "../src/composition/instructions/introduced.js";
import { createOutwardReview } from "../src/composition/workforce/review.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";
import type { ThreadRead } from "../src/composition/instructions/quarantine.js";
import type {
  InstructionRow,
  InstructionStore,
  WaitingCard,
} from "../src/composition/instructions/store.js";

/**
 * ADR 0043 S3: Q plans; code decides. Fake declarations and ports, no
 * model: every verdict below is code's, never the planner's.
 */

const userId = randomUUID();
const tenantId = randomUUID();
const actor = ActorContextSchema.parse({
  userId,
  tenantId,
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const REL = randomUUID();
const OTHER_REL = randomUUID();
const COMPANY = randomUUID();
// Wednesday 2026-10-07, 10:00 in London (09:00 UTC).
const IN_HOURS = new Date("2026-10-07T09:00:00Z");
// Wednesday 2026-10-07, 21:00 in London.
const AFTER_HOURS = new Date("2026-10-07T20:00:00Z");

const ran: { name: string; key: string; input: unknown }[] = [];

function declared(
  name: string,
  input: z.ZodType,
  consequence?: "TERMS" | "MONEY" | "COMMITMENT",
): AnyAppAction {
  return {
    name,
    classification: "CONSEQUENTIAL",
    does: `Does ${name}.`,
    input,
    ...(consequence === undefined ? {} : { consequence }),
    authorize: () => Promise.resolve({ ok: true }),
    run: (
      _ports: unknown,
      context: { idempotencyKey: string },
      value: unknown,
    ) => {
      ran.push({ name, key: context.idempotencyKey, input: value });
      return Promise.resolve({});
    },
  } as unknown as AnyAppAction;
}

const Key = z.string().min(8);
const ACTIONS: readonly AnyAppAction[] = [
  declared(
    "chat.message.send",
    z
      .object({
        relationshipId: z.string(),
        idempotencyKey: Key,
        input: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("TEXT"), body: z.string() }).strict(),
          z
            .object({ kind: z.literal("ATTACHMENT"), documentId: z.string() })
            .strict(),
        ]),
      })
      .strict(),
  ),
  declared(
    "relationship.interest.express",
    z
      .object({
        companyId: z.string(),
        idempotencyKey: Key,
        input: z.object({}).strict(),
      })
      .strict(),
  ),
  declared(
    "schedule.meeting.book",
    z
      .object({
        relationshipId: z.string(),
        idempotencyKey: Key,
        input: z
          .object({
            purpose: z.string(),
            startsAt: z.string(),
            durationMinutes: z.number(),
          })
          .strict(),
      })
      .strict(),
  ),
  declared(
    "relationship.outcome.change",
    z.object({ relationshipId: z.string(), outcome: z.string() }).strict(),
    "COMMITMENT",
  ),
];

const PEOPLE: readonly InstructionPerson[] = [
  {
    relationshipId: REL,
    counterpartKind: "COMPANY",
    counterpartId: COMPANY,
    name: "Acme Robotics",
    state: "CONNECTED",
  },
  {
    relationshipId: OTHER_REL,
    counterpartKind: "COMPANY",
    counterpartId: randomUUID(),
    name: "Beta Foods",
    state: "CONNECTED",
  },
];

function grant(overrides: Partial<InstructionGrant> = {}): InstructionGrant {
  return {
    ...handleEverythingGrant({
      timeZone: "Europe/London",
      topics: ["introductions", "times to meet"],
    }),
    ...overrides,
  };
}

function chat(
  body: string,
  overrides: Partial<InstructionPlanStep> = {},
  relationshipId: string = REL,
): InstructionPlanStep {
  return {
    action: "chat.message.send",
    argumentsJson: JSON.stringify({
      relationshipId,
      idempotencyKey: "model-written-key",
      input: { kind: "TEXT", body },
    }),
    topic: "introductions",
    touchesTermsOrMoney: false,
    words: "Say hello to Acme.",
    ...overrides,
  };
}

function validate(
  step: InstructionPlanStep,
  options: {
    grant?: InstructionGrant;
    now?: Date;
    sent?: Map<string, number>;
    request?: "PREPARE" | "EXECUTE";
    people?: readonly InstructionPerson[];
    awaiting?: ReadonlySet<string>;
  } = {},
) {
  return validateStep(step, {
    grant: options.grant ?? grant(),
    actions: ACTIONS,
    people: options.people ?? PEOPLE,
    ...(options.awaiting === undefined ? {} : { awaiting: options.awaiting }),
    sent: options.sent ?? new Map<string, number>(),
    now: options.now ?? IN_HOURS,
    stepKey: "instr:test:run:0",
    ...(options.request === undefined ? {} : { request: options.request }),
  });
}

const verdictOf = (result: ReturnType<typeof validate>) =>
  result.verdict === "REFUSED"
    ? `REFUSED:${result.code}`
    : `${result.verdict}${result.code === null ? "" : `:${result.code}`}`;

describe("chat only where it can be sent (live seed, Zino)", () => {
  const body =
    "Hello from Zino Aviation. Your pilot results caught our eye; could we compare notes on your roadmap?";
  it("refuses a message to someone who has not accepted yet, so no card is approved only to fail", () => {
    const people = PEOPLE.map((person) =>
      person.relationshipId === REL
        ? { ...person, state: "INTEREST_EXPRESSED" }
        : person,
    );
    // Either guard refuses it (founder rule NOT_CONNECTED_YET runs first).
    expect(verdictOf(validate(chat(body), { people }))).toMatch(
      /^REFUSED:NOT_CONNECTED(_YET)?$/,
    );
  });

  it("holds a new message while a card to the same person still waits for a yes", () => {
    const held = validate(chat(body), { awaiting: new Set([REL]) });
    expect(held.verdict).toBe("HOLD");
    expect(held.verdict === "HOLD" ? held.code : null).toBe("ALREADY_ASKED");
    // Someone else is not held by it.
    expect(
      validate(chat(body, {}, OTHER_REL), { awaiting: new Set([REL]) }).verdict,
    ).not.toBe("HOLD");
  });
});

describe("working hours", () => {
  const hours = grant().workingHours;
  it("reads the person's own zone", () => {
    expect(withinWorkingHours(IN_HOURS, hours)).toBe(true);
    expect(withinWorkingHours(AFTER_HOURS, hours)).toBe(false);
    // Saturday 10:00 London.
    expect(withinWorkingHours(new Date("2026-10-10T09:00:00Z"), hours)).toBe(
      false,
    );
    expect(
      withinWorkingHours(IN_HOURS, { ...hours, timeZone: "Not/AZone" }),
    ).toBe(false);
  });
  it("a meeting must end inside the same working day", () => {
    expect(meetingWithinWorkingHours(IN_HOURS, 30, hours)).toBe(true);
    // 16:45 London + 30 minutes ends after 17:00.
    expect(
      meetingWithinWorkingHours(new Date("2026-10-07T15:45:00Z"), 30, hours),
    ).toBe(false);
  });
});

describe("the validator: code decides each step", () => {
  it("runs an on-topic message in hours on its own, under the step's own key", () => {
    const result = validate(chat("Hello from Ada's Q."));
    expect(verdictOf(result)).toBe("AUTO");
    expect(
      result.verdict === "AUTO" &&
        (result.input as { idempotencyKey: string }).idempotencyKey,
    ).toBe("instr:test:run:0");
  });

  it.each([
    [
      "an undeclared action",
      { action: "money.wire.send" },
      "REFUSED:UNKNOWN_ACTION",
    ],
    [
      "arguments that do not fit",
      { argumentsJson: "{not json" },
      "REFUSED:BAD_ARGUMENTS",
    ],
    [
      "a message about terms or money",
      { touchesTermsOrMoney: true },
      "ASK:TERMS_OR_MONEY",
    ],
    ["a topic they did not approve", { topic: "valuation" }, "ASK:OFF_TOPIC"],
  ] as const)("%s", (_label, overrides, expected) => {
    expect(verdictOf(validate(chat("Hi", overrides)))).toBe(expected);
  });

  it("a goal read as PREPARE asks for an AUTO-granted step (weekend test 6ea17898)", () => {
    expect(verdictOf(validate(chat("Hello."), { request: "PREPARE" }))).toBe(
      "ASK:ASKED_TO_PREPARE",
    );
    expect(verdictOf(validate(chat("Hello."), { request: "EXECUTE" }))).toBe(
      "AUTO",
    );
  });

  it("refuses someone the instruction does not cover", () => {
    expect(verdictOf(validate(chat("Hi", {}, randomUUID())))).toBe(
      "REFUSED:OUT_OF_SCOPE",
    );
    const listed = grant({
      counterparts: {
        scope: "LISTED",
        relationshipIds: [REL],
        includeNewCompanies: false,
        exclude: [],
      },
    });
    expect(
      verdictOf(validate(chat("Hi", {}, OTHER_REL), { grant: listed })),
    ).toBe("REFUSED:OUT_OF_SCOPE");
  });

  it("refuses an action the grant does not name", () => {
    expect(
      verdictOf(
        validate(chat("Hi"), {
          grant: grant({
            actions: [{ action: "schedule.meeting.book", mode: "AUTO" }],
          }),
        }),
      ),
    ).toBe("REFUSED:NOT_IN_GRANT");
  });

  it("asks after the per-person message cap", () => {
    const sent = new Map([[REL, 7]]);
    expect(verdictOf(validate(chat("One more"), { sent }))).toBe("AUTO");
    expect(verdictOf(validate(chat("And another"), { sent }))).toBe(
      "ASK:OVER_MESSAGE_CAP",
    );
    expect(sent.get(REL)).toBe(8);
  });

  it("waits outside working hours", () => {
    expect(verdictOf(validate(chat("Hi"), { now: AFTER_HOURS }))).toBe(
      "REFUSED:OUTSIDE_HOURS",
    );
  });

  it("asks before sharing a document", () => {
    const step = chat("x", {
      argumentsJson: JSON.stringify({
        relationshipId: REL,
        idempotencyKey: "k".repeat(8),
        input: { kind: "ATTACHMENT", documentId: randomUUID() },
      }),
    });
    expect(verdictOf(validate(step))).toBe("ASK:ATTACHMENT");
  });

  it("books on its own only inside working hours", () => {
    const book = (startsAt: string): InstructionPlanStep => ({
      action: "schedule.meeting.book",
      argumentsJson: JSON.stringify({
        relationshipId: REL,
        idempotencyKey: "x".repeat(8),
        input: { purpose: "Intro", startsAt, durationMinutes: 30 },
      }),
      topic: null,
      touchesTermsOrMoney: false,
      words: "Book an intro call.",
    });
    expect(verdictOf(validate(book("2026-10-08T10:00:00Z")))).toBe("AUTO");
    expect(verdictOf(validate(book("2026-10-08T18:00:00Z")))).toBe(
      "ASK:MEETING_OUTSIDE_HOURS",
    );
  });

  it("expresses interest in a new company only when the grant includes new companies", () => {
    const fresh = randomUUID();
    const step: InstructionPlanStep = {
      action: "relationship.interest.express",
      argumentsJson: JSON.stringify({
        companyId: fresh,
        idempotencyKey: "y".repeat(8),
        input: {},
      }),
      topic: null,
      touchesTermsOrMoney: false,
      words: "Express interest in New Co.",
    };
    const people: InstructionPerson[] = [
      ...PEOPLE,
      {
        relationshipId: null,
        counterpartKind: "COMPANY",
        counterpartId: fresh,
        name: "New Co",
        state: "IN_FEED_NOT_CONTACTED",
      },
    ];
    const check = (includeNewCompanies: boolean) =>
      verdictOf(
        validateStep(step, {
          grant: grant({
            counterparts: {
              scope: "ALL_MY_RELATIONSHIPS",
              relationshipIds: [],
              includeNewCompanies,
              exclude: [],
            },
          }),
          actions: ACTIONS,
          people,
          sent: new Map<string, number>(),
          now: IN_HOURS,
          stepKey: "instr:test:run:0",
        }),
      );
    expect(check(false)).toBe("REFUSED:OUT_OF_SCOPE");
    expect(check(true)).toBe("AUTO");
  });

  it("where they raised terms or money, or declined, Q's message is their card (code reads the thread's facts)", () => {
    const facts = (over: Partial<InstructionThreadFacts>) =>
      new Map<string, InstructionThreadFacts>([
        [
          REL,
          {
            lastFrom: "THEM",
            asksQuestion: false,
            wantsToMeet: false,
            proposedTime: null,
            topicNumbers: [],
            mentionsTermsOrMoney: false,
            declined: false,
            tone: "NEUTRAL",
            ...over,
          },
        ],
      ]);
    const check = (over: Partial<InstructionThreadFacts>) =>
      verdictOf(
        validateStep(chat("Thanks!"), {
          grant: grant(),
          actions: ACTIONS,
          people: PEOPLE,
          sent: new Map<string, number>(),
          now: IN_HOURS,
          stepKey: "instr:test:run:0",
          facts: facts(over),
        }),
      );
    expect(check({})).toBe("AUTO");
    expect(check({ mentionsTermsOrMoney: true })).toBe("ASK:THEY_RAISED_TERMS");
    expect(check({ declined: true })).toBe("ASK:THEY_DECLINED");
  });

  it("routine replies go on their own where messages ask, when the grant says so (founder 2026-10-05)", () => {
    const thread = (over: Partial<InstructionThreadFacts>) =>
      new Map<string, InstructionThreadFacts>([
        [
          REL,
          {
            lastFrom: "THEM",
            asksQuestion: false,
            wantsToMeet: false,
            proposedTime: null,
            topicNumbers: [1],
            mentionsTermsOrMoney: false,
            declined: false,
            tone: "POSITIVE",
            ...over,
          },
        ],
      ]);
    const asking = (routineReplies?: boolean) =>
      grant({
        actions: [{ action: "chat.message.send", mode: "ASK" }],
        ...(routineReplies === undefined ? {} : { routineReplies }),
      });
    const check = (
      over: Partial<InstructionThreadFacts>,
      routineReplies?: boolean,
      body = "Thanks, good to hear from you.",
    ) =>
      verdictOf(
        validateStep(chat(body), {
          grant: asking(routineReplies),
          actions: ACTIONS,
          people: PEOPLE,
          sent: new Map<string, number>(),
          now: IN_HOURS,
          stepKey: "instr:test:run:0",
          facts: thread(over),
        }),
      );
    // A reply to what they wrote: on its own.
    expect(check({}, true)).toBe("AUTO");
    // Still theirs: the grant does not say so, we wrote last (a follow-up),
    // they raised terms or money, or they said no.
    expect(check({})).toBe("ASK");
    expect(check({ lastFrom: "US" }, true)).toBe("ASK");
    expect(check({ mentionsTermsOrMoney: true }, true)).toBe(
      "ASK:THEY_RAISED_TERMS",
    );
    expect(check({ declined: true }, true)).toBe("ASK:THEY_DECLINED");
  });

  it("never lets a grant make a commitment Q's alone", () => {
    const forged = grant({
      actions: [{ action: "relationship.outcome.change", mode: "AUTO" }],
    });
    const step: InstructionPlanStep = {
      action: "relationship.outcome.change",
      argumentsJson: JSON.stringify({ relationshipId: REL, outcome: "PASS" }),
      topic: null,
      touchesTermsOrMoney: false,
      words: "Pass on Acme.",
    };
    expect(verdictOf(validate(step, { grant: forged }))).toBe(
      "ASK:NOT_DELEGABLE",
    );
  });
});

// ---------------------------------------------------------------------------
// One firing, end to end over fakes
// ---------------------------------------------------------------------------

const PEOPLE_OVERRIDE: { value: readonly InstructionPerson[] | null } = {
  value: null,
};
/** QA run 8a1d57b9: the material a case's messages are checked against. */
const MATERIAL_OVERRIDE: { value: InstructionMaterial | null } = {
  value: null,
};
/** QA run 8a1d57b9: what the quarantined reader returns, when a case sets it. */
const THREAD_OVERRIDE: { value: ThreadRead | null } = { value: null };
const WAITING_OVERRIDE: { value: WaitingCard[] } = { value: [] };

function world(
  plans: readonly (Omit<InstructionPlanResult, "cannot"> & {
    readonly request?: "PREPARE" | "EXECUTE";
    readonly cannot: readonly (InstructionPlanResult["cannot"][number] & {
      readonly needs?:
        | "DISCOVERY"
        | "SCHEDULE"
        | "SEQUENCING"
        | "TERMS_OR_MONEY"
        | "NO_SUCH_ACTION";
    })[];
  })[],
  autoEnabled = true,
  at = IN_HOURS,
  spent = "0",
  extra: Partial<Parameters<typeof createInstructionEngine>[0]> = {},
) {
  const spends: number[] = [];
  const paused: string[] = [];
  const notices: { key: string; title: string; priority: string }[] = [];
  const asks: { actionType: string; payload: unknown }[] = [];
  const row: InstructionRow = {
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: userId,
    organisation_id: null,
    goal_text: "Handle all the work for me",
    status: "ACTIVE",
    grant_version: 1,
    budget_usd_month: "5.00",
    spent_usd_month: spent,
    spent_this_month: spent,
    pause_reason: null,
    expires_at: new Date("2026-11-01T00:00:00Z"),
    stopped_at: null,
    conversation_id: null,
    created_at: IN_HOURS,
    updated_at: IN_HOURS,
    grant_payload: grant(),
  };
  const steps = new Map<
    string,
    { status: string; action: string; words: string; reasonCode: string | null }
  >();
  const asked: { actionType: string; key: string }[] = [];
  const planned: string[] = [];
  let call = 0;
  const store = {
    instruction: () => Promise.resolve(row),
    expire: () => Promise.resolve(),
    recordStep: (step: {
      idempotencyKey: string;
      status: string;
      action: string;
      words: string;
      reasonCode: string | null;
    }) => {
      if (steps.has(step.idempotencyKey)) return Promise.resolve(false);
      steps.set(step.idempotencyKey, step);
      return Promise.resolve(true);
    },
    stepDone: (key: string) => Promise.resolve(steps.has(key)),
    messagesSent: () => Promise.resolve(new Map<string, number>()),
    history: () => Promise.resolve([]),
    waitingCards: () => Promise.resolve(WAITING_OVERRIDE.value),
    addSpend: (_id: string, amount: number) => {
      spends.push(amount);
      return Promise.resolve();
    },
    pause: (_id: string, reason: string) => {
      paused.push(reason);
      return Promise.resolve(true);
    },
    notify: (notice: { key: string; title: string; priority: string }) => {
      notices.push(notice);
      return Promise.resolve(true);
    },
  } as unknown as InstructionStore;
  const engine = createInstructionEngine({
    store,
    actions: ACTIONS,
    ports: {},
    actorFor: () => Promise.resolve(actor),
    people: () => Promise.resolve(PEOPLE_OVERRIDE.value ?? PEOPLE),
    ...(MATERIAL_OVERRIDE.value === null
      ? {}
      : { material: () => Promise.resolve(MATERIAL_OVERRIDE.value) }),
    ...(THREAD_OVERRIDE.value === null
      ? {}
      : {
          readThread: (input: { relationshipId: string }) =>
            Promise.resolve(
              input.relationshipId === REL
                ? (THREAD_OVERRIDE.value ?? { facts: null, costUsd: 0 })
                : { facts: null, costUsd: 0 },
            ),
        }),
    plan: (_who, variables, limits) => {
      expect(limits.maxCostUsd).toBeGreaterThanOrEqual(0.08);
      planned.push(variables.refusals);
      const next = plans[Math.min(call, plans.length - 1)];
      call += 1;
      // Handed over unless a case says otherwise.
      const plan =
        next === undefined
          ? null
          : {
              request: "EXECUTE" as const,
              ...next,
              // A can't no action covers, unless a case says what it needs.
              cannot: next.cannot.map((entry) => ({
                needs: "NO_SUCH_ACTION" as const,
                ...entry,
              })),
            };
      return Promise.resolve({ plan, costUsd: 0.01 });
    },
    ask: (_actor, card) => {
      asked.push({ actionType: card.actionType, key: card.key });
      asks.push({ actionType: card.actionType, payload: card.payload });
      return Promise.resolve({ qActionId: randomUUID() });
    },
    now: () => at,
    autoEnabled,
    ...extra,
  });
  return { engine, row, steps, asked, planned, spends, paused, asks, notices };
}

describe("a firing", () => {
  it("re-plans with code's reasons, then acts: AUTO runs, ASK cards, can't said at once", async () => {
    ran.length = 0;
    const { engine, row, steps, asked, planned } = world([
      {
        steps: [chat("Hi", { action: "money.wire.send" })],
        cannot: [],
      },
      {
        steps: [
          chat("Hello from Ada's Q."),
          chat("About the valuation", { touchesTermsOrMoney: true }),
        ],
        cannot: [
          {
            what: "negotiate the terms",
            reason: "terms are always yours to agree",
            instead: "I can prepare the points for you to send",
          },
        ],
      },
    ]);
    const result = await engine.fire(row.id, "run-0001");
    expect(result).toMatchObject({
      outcome: "RAN",
      done: 1,
      asked: 1,
      refused: 0,
    });
    expect(planned).toEqual(["None.", "money.wire.send: UNKNOWN_ACTION"]);
    expect(ran).toEqual([
      expect.objectContaining({
        name: "chat.message.send",
        key: `instr:${row.id}:run-0001:0`,
      }),
    ]);
    expect(asked).toEqual([
      {
        actionType: "app.chat.message.send",
        key: `instr:${row.id}:run-0001:1`,
      },
    ]);
    const words = [...steps.values()].map((step) => step.words);
    expect(words).toContain(
      "Can't negotiate the terms: terms are always yours to agree. Instead: I can prepare the points for you to send",
    );
    expect(words.some((line) => line.includes("touches terms or money"))).toBe(
      true,
    );

    // The same firing again runs nothing twice.
    await engine.fire(row.id, "run-0001");
    expect(ran).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("plans nothing (and spends nothing) outside their working hours", async () => {
    const { engine, row, planned } = world(
      [{ steps: [chat("Hi")], cannot: [] }],
      true,
      AFTER_HOURS,
    );
    expect((await engine.fire(row.id, "run-0004")).outcome).toBe(
      "OUTSIDE_HOURS",
    );
    expect(planned).toHaveLength(0);
  });

  it(`re-plans at most ${String(MAX_REPLANS)} times, then records the refusal in plain words`, async () => {
    ran.length = 0;
    const { engine, row, steps, planned } = world([
      { steps: [chat("Hi", {}, randomUUID())], cannot: [] },
    ]);
    const result = await engine.fire(row.id, "run-0002");
    expect(planned).toHaveLength(MAX_REPLANS + 1);
    expect(result.refused).toBe(1);
    expect(ran).toHaveLength(0);
    expect([...steps.values()][0]).toMatchObject({
      status: "REFUSED",
      reasonCode: "OUT_OF_SCOPE",
    });
    expect([...steps.values()][0]?.words).toContain(
      "isn't among the people this instruction covers",
    );
  });

  it("with autonomy off (CQ_INSTRUCTIONS_AUTO), every AUTO step is a card instead", async () => {
    ran.length = 0;
    const { engine, row, steps, asked } = world(
      [{ steps: [chat("Hello from Ada's Q.")], cannot: [] }],
      false,
    );
    const result = await engine.fire(row.id, "run-0003");
    expect(result).toMatchObject({ done: 0, asked: 1 });
    expect(ran).toHaveLength(0);
    expect(asked).toEqual([
      {
        actionType: "app.chat.message.send",
        key: `instr:${row.id}:run-0003:0`,
      },
    ]);
    expect([...steps.values()][0]).toMatchObject({
      status: "ASKED",
      reasonCode: "AUTONOMY_OFF",
    });
  });

  it("adds each planning call's cost to the instruction", async () => {
    const { engine, row, spends } = world([{ steps: [], cannot: [] }]);
    await engine.fire(row.id, "run-0005");
    expect(spends).toEqual([0.01]);
  });

  it("with the month's budget used, it pauses and asks to continue -- no planning call", async () => {
    const { engine, row, planned, paused, asks } = world(
      [{ steps: [chat("Hi")], cannot: [] }],
      true,
      IN_HOURS,
      "4.95",
    );
    const result = await engine.fire(row.id, "run-0006");
    expect(result.outcome).toBe("OVER_BUDGET");
    expect(planned).toHaveLength(0);
    expect(paused).toEqual(["BUDGET_EXHAUSTED"]);
    expect(asks).toEqual([
      {
        actionType: "q.instruction.grant",
        payload: expect.objectContaining({
          instructionId: row.id,
          continuation: "BUDGET",
          grant: expect.objectContaining({
            budgetUsdMonth: "10.00",
          }) as unknown,
        }) as unknown,
      },
    ]);
  });

  it("stops re-planning when the budget runs out mid-firing", async () => {
    // 0.09 left: one call (0.01) leaves 0.08, a second leaves 0.07 -- a
    // third would risk going over, so it pauses and asks instead.
    const { engine, row, planned, paused, spends } = world(
      [{ steps: [chat("Hi", { action: "money.wire.send" })], cannot: [] }],
      true,
      IN_HOURS,
      "4.91",
    );
    const result = await engine.fire(row.id, "run-0007");
    expect(planned).toHaveLength(2);
    expect(spends).toEqual([0.01, 0.01]);
    expect(result.outcome).toBe("OVER_BUDGET");
    expect(paused).toEqual(["BUDGET_EXHAUSTED"]);
  });

  it("reads covered threads through the quarantine first; the planner gets the facts line and the spend is counted", async () => {
    const { engine, row, spends } = world([{ steps: [], cannot: [] }]);
    void engine;
    const seen: string[] = [];
    const reads: string[] = [];
    const quarantined = createInstructionEngine({
      store: {
        instruction: () => Promise.resolve(row),
        expire: () => Promise.resolve(),
        recordStep: () => Promise.resolve(true),
        stepDone: () => Promise.resolve(false),
        messagesSent: () => Promise.resolve(new Map<string, number>()),
        history: () => Promise.resolve([]),
        addSpend: (_id: string, amount: number) => {
          spends.push(amount);
          return Promise.resolve();
        },
        pause: () => Promise.resolve(true),
        notify: () => Promise.resolve(true),
      },
      actions: ACTIONS,
      ports: {},
      actorFor: () => Promise.resolve(actor),
      people: () => Promise.resolve(PEOPLE),
      plan: (_who, variables) => {
        seen.push(variables.people);
        return Promise.resolve({
          plan: { steps: [], cannot: [], request: "EXECUTE" as const },
          costUsd: 0,
        });
      },
      readThread: (input) => {
        reads.push(input.relationshipId);
        return Promise.resolve({
          facts: {
            lastFrom: "THEM",
            asksQuestion: true,
            wantsToMeet: true,
            proposedTime: null,
            topicNumbers: [2],
            mentionsTermsOrMoney: false,
            declined: false,
            tone: "POSITIVE",
            questionAbout: [],
          },
          costUsd: 0.002,
        });
      },
      ask: () => Promise.resolve(null),
      now: () => IN_HOURS,
      autoEnabled: true,
    });
    await quarantined.fire(row.id, "run-0008");
    expect(reads).toEqual([REL, OTHER_REL]);
    expect(spends).toEqual([0.002, 0.002]);
    expect(seen[0]).toContain(
      "chat: last from THEM; asks a question; wants to meet; about: times to meet; tone POSITIVE",
    );
  });

  it("S7: what waits on their yes is one NEEDS_YOU notice per firing; a budget pause is one too", async () => {
    const asking = world([
      {
        steps: [
          chat("About terms", { touchesTermsOrMoney: true }),
          chat("And the round", {
            touchesTermsOrMoney: true,
            words: "Ask about the round.",
          }),
        ],
        cannot: [],
      },
    ]);
    await asking.engine.fire(asking.row.id, "run-0009");
    expect(asking.notices).toEqual([
      expect.objectContaining({
        key: "run-0009:needs",
        priority: "NEEDS_YOU",
        title: '2 things need your yes for "Handle all the work for me"',
      }),
    ]);
    const broke = world([{ steps: [], cannot: [] }], true, IN_HOURS, "5.00");
    await broke.engine.fire(broke.row.id, "run-0010");
    expect(broke.notices).toEqual([
      expect.objectContaining({ priority: "NEEDS_YOU", key: "budget-2026-10" }),
    ]);
    const quiet = world([{ steps: [], cannot: [] }]);
    await quiet.engine.fire(quiet.row.id, "run-0011");
    expect(quiet.notices).toEqual([]);
  });

  it("S8: acts for at most 5 people per firing; the rest wait, unrecorded; each person's steps stay in order", async () => {
    ran.length = 0;
    const many: InstructionPerson[] = Array.from({ length: 7 }, (_, n) => ({
      relationshipId: randomUUID(),
      counterpartKind: "COMPANY" as const,
      counterpartId: randomUUID(),
      name: `Co ${String(n)}`,
      state: "CONNECTED",
    }));
    const steps = many.flatMap((person, n) => [
      chat(`Hello ${String(n)}`, {}, person.relationshipId ?? ""),
      ...(n === 0
        ? [chat("Second to the first", {}, person.relationshipId ?? "")]
        : []),
    ]);
    const { engine, row, steps: recorded } = world([{ steps, cannot: [] }]);
    // People come from the world's PEOPLE; widen it for this firing.
    PEOPLE_OVERRIDE.value = many;
    try {
      const result = await engine.fire(row.id, "run-0012");
      // ADR 0050: one message Q sends on its own per person per sitting, so
      // the second to the first company is held (and says why).
      expect(result.done).toBe(5);
      expect(result.deferred).toBe(2);
      // Five sent, one held, and one NOTED line naming who waits (QA run
      // 8a1d57b9: Tallyloom was skipped with no record).
      expect(recorded.size).toBe(7);
      expect(
        [...recorded.values()].find(
          (step) => step.reasonCode === "PACE_ONE_AT_A_TIME",
        ),
      ).toMatchObject({
        status: "NOTED",
        words:
          "Holding off: Say hello to Acme. -- one message to them at a time; the next waits for their reply.",
      });
      expect(recorded.get(`instr:${row.id}:run-0012:199`)).toMatchObject({
        status: "NOTED",
        action: "q.note",
        reasonCode: "FANOUT_NEXT_FIRING",
        words: "Next firing: Co 5, Co 6. I act for at most 5 people at a time.",
      });
      const first = ran
        .filter(
          (entry) =>
            (entry.input as { relationshipId: string }).relationshipId ===
            many[0]?.relationshipId,
        )
        .map(
          (entry) => (entry.input as { input: { body: string } }).input.body,
        );
      expect(first).toEqual(["Hello 0"]);
    } finally {
      PEOPLE_OVERRIDE.value = null;
    }
  });

  it("says so on their work page when it does nothing: outside hours, or nothing to do -- once a day", async () => {
    const late = world([{ steps: [], cannot: [] }], true, AFTER_HOURS);
    await late.engine.fire(late.row.id, "run-0013");
    await late.engine.fire(late.row.id, "run-0014");
    expect([...late.steps.values()]).toEqual([
      expect.objectContaining({
        status: "NOTED",
        reasonCode: "OUTSIDE_HOURS",
        words:
          "Waiting for your working hours (Mon-Fri 09:00-17:00, Europe/London) before I start.",
      }),
    ]);
    const idle = world([{ steps: [], cannot: [] }]);
    await idle.engine.fire(idle.row.id, "run-0015");
    expect([...idle.steps.values()]).toEqual([
      expect.objectContaining({
        status: "NOTED",
        reasonCode: "NOTHING_TO_DO",
        words:
          "Looked at 2 people: nothing to do right now. I'll look again later.",
      }),
    ]);
  });
});

describe("a goal to prepare (weekend test 6ea17898)", () => {
  it("an AUTO-granted step of a PREPARE plan is asked, never taken", async () => {
    ran.length = 0;
    const { engine, row, asked } = world([
      { steps: [chat("Hello from Ada's Q.")], cannot: [], request: "PREPARE" },
    ]);
    const result = await engine.fire(row.id, "run-0002");
    expect(result).toMatchObject({ outcome: "RAN", done: 0, asked: 1 });
    expect(ran).toEqual([]);
    expect(asked).toEqual([
      {
        actionType: "app.chat.message.send",
        key: `instr:${row.id}:run-0002:0`,
      },
    ]);
  });
});

describe("the engine's own abilities are never a can't (QA run 40021ae5)", () => {
  it("drops can't-lines that need discovery, a schedule or sequencing; keeps the real ones", async () => {
    ran.length = 0;
    const { engine, row, steps } = world([
      {
        steps: [],
        cannot: [
          {
            what: "Find and assess new founders",
            reason: "No listed action performs founder discovery",
            instead: "I can work with your feed",
            needs: "DISCOVERY",
          },
          {
            what: "Run this every weekend",
            reason: "No listed action creates a recurring schedule",
            instead: "Ask me each weekend",
            needs: "SCHEDULE",
          },
          {
            what: "Send introductory messages immediately after expressing interest",
            reason: "No action chains steps",
            instead: "I can send them separately",
            needs: "SEQUENCING",
          },
          {
            what: "Negotiate the valuation",
            reason: "terms are always yours to agree",
            instead: "I can prepare the points for you",
            needs: "TERMS_OR_MONEY",
          },
        ],
      },
    ]);
    await engine.fire(row.id, "run-0003");
    const words = [...steps.values()].map((step) => step.words);
    expect(words.some((line) => line.includes("Negotiate the valuation"))).toBe(
      true,
    );
    for (const gone of [
      "founder discovery",
      "every weekend",
      "immediately after",
    ]) {
      expect(words.some((line) => line.includes(gone))).toBe(false);
    }
  });
});

describe("someone they said to leave out ('except Acme')", () => {
  const without = (base: InstructionGrant = grant()): InstructionGrant => ({
    ...base,
    counterparts: {
      ...base.counterparts,
      exclude: [{ counterpartId: COMPANY, name: "Acme Robotics" }],
    },
  });

  it("is never covered, and a step for them is refused, whatever else allows it", () => {
    expect(inScope(without(), PEOPLE).map((p) => p.name)).toEqual([
      "Beta Foods",
    ]);
    // By relationship, and by company id.
    expect(verdictOf(validate(chat("Hello"), { grant: without() }))).toBe(
      "REFUSED:EXCLUDED",
    );
    expect(
      verdictOf(
        validate(
          {
            ...chat("Hello"),
            action: "relationship.interest.express",
            argumentsJson: JSON.stringify({
              companyId: COMPANY,
              idempotencyKey: "k",
              input: {},
            }),
          },
          { grant: without() },
        ),
      ),
    ).toBe("REFUSED:EXCLUDED");
    // Everyone else as before.
    expect(
      verdictOf(validate(chat("Hello", {}, OTHER_REL), { grant: without() })),
    ).not.toContain("REFUSED");
  });
});

describe("messages Q writes are grounded (QA run 8a1d57b9)", () => {
  const material: InstructionMaterial = {
    sender: { side: "INVESTOR", facts: [] },
    counterparts: new Map([
      [
        COMPANY,
        companyCardFacts(
          {
            currentStageCode: "seed",
            headquartersCountry: null,
            shortDescription:
              "Acme Robotics builds warehouse picking robots for grocery retailers.",
          },
          () => undefined,
          "their Capital Q profile",
        ),
      ],
    ]),
  };

  it("a generic first message is refused with code's reason and re-planned; the grounded one is sent", async () => {
    ran.length = 0;
    MATERIAL_OVERRIDE.value = material;
    try {
      const { engine, row, planned } = world([
        {
          steps: [
            chat(
              "Hi — I've been following Acme Robotics and would be glad to compare notes. If useful, perhaps we could find a time to meet.",
            ),
          ],
          cannot: [],
        },
        {
          steps: [
            chat(
              "Hi Acme team — your profile says you build warehouse picking robots for grocery retailers. Which retailers are you piloting with?",
            ),
          ],
          cannot: [],
        },
      ]);
      const result = await engine.fire(row.id, "run-0201");
      expect(planned).toEqual(["None.", "chat.message.send: FALSE_HISTORY"]);
      expect(result.done).toBe(1);
      expect(
        ran.map(
          (entry) => (entry.input as { input: { body: string } }).input.body,
        ),
      ).toEqual([expect.stringContaining("warehouse picking robots")]);
    } finally {
      MATERIAL_OVERRIDE.value = null;
    }
  });

  it("a message still ungrounded after the re-plans is recorded as not sent, in plain words", async () => {
    ran.length = 0;
    MATERIAL_OVERRIDE.value = material;
    try {
      const { engine, row, steps } = world([
        { steps: [chat("Hi Acme, keen to compare notes.")], cannot: [] },
      ]);
      const result = await engine.fire(row.id, "run-0202");
      expect(result).toMatchObject({ done: 0, refused: 1 });
      expect(ran).toHaveLength(0);
      expect([...steps.values()][0]?.words).toContain(
        "didn't name anything specific",
      );
    } finally {
      MATERIAL_OVERRIDE.value = null;
    }
  });
});

describe("their question gets an answer or goes to the person (QA run 8a1d57b9)", () => {
  const asked: ThreadRead = {
    facts: {
      lastFrom: "THEM",
      asksQuestion: true,
      wantsToMeet: false,
      proposedTime: null,
      topicNumbers: [],
      mentionsTermsOrMoney: false,
      declined: false,
      tone: "POSITIVE",
      questionAbout: ["CHEQUE_SIZE", "LEAD_OR_FOLLOW"],
    },
    costUsd: 0,
    question: {
      messageId: "msg-0001",
      text: "What's your typical cheque size and do you lead?",
    },
  };
  const mandate = (cheque: boolean) =>
    mandateFacts(
      {
        cheque: cheque ? { currency: "USD", typical: "250000" } : null,
        stage: { minStageCode: null, maxStageCode: null },
        constraints: [
          {
            dimension: "investment_role",
            operator: "IN",
            value: { kind: "codes", values: ["lead"] },
            isHardExclusion: false,
          },
        ],
        taxonomyPreferences: [],
      },
      (code) => (code === "lead" ? "Lead rounds" : undefined),
    );
  const reply = chat(
    "Our typical cheque is USD 250,000. We lead rounds. What are you raising for?",
  );

  it("answers from the declared mandate, within MESSAGES AUTO", async () => {
    ran.length = 0;
    MATERIAL_OVERRIDE.value = {
      sender: { side: "INVESTOR", facts: mandate(true) },
      counterparts: new Map(),
    };
    THREAD_OVERRIDE.value = asked;
    try {
      const { engine, row, notices } = world([{ steps: [reply], cannot: [] }]);
      const result = await engine.fire(row.id, "run-0301");
      expect(result.done).toBe(1);
      expect(notices).toEqual([]);
    } finally {
      MATERIAL_OVERRIDE.value = null;
      THREAD_OVERRIDE.value = null;
    }
  });

  it("with no cheque size declared: never invented -- NEEDS_YOU with the question quoted, noted, and no reply sent", async () => {
    ran.length = 0;
    MATERIAL_OVERRIDE.value = {
      sender: { side: "INVESTOR", facts: mandate(false) },
      counterparts: new Map(),
    };
    THREAD_OVERRIDE.value = asked;
    try {
      const { engine, row, notices, steps } = world([
        { steps: [reply], cannot: [] },
      ]);
      const result = await engine.fire(row.id, "run-0302");
      expect(result.done).toBe(0);
      expect(ran).toHaveLength(0);
      expect(notices).toEqual([
        expect.objectContaining({
          key: "question:msg-0001",
          priority: "NEEDS_YOU",
          title: "Acme Robotics asked something only you can answer",
          body: expect.stringContaining(
            '"What\'s your typical cheque size and do you lead?"',
          ) as string,
        }),
      ]);
      const recorded = [...steps.entries()];
      expect(recorded).toContainEqual([
        `instr:${row.id}:question:msg-0001`,
        expect.objectContaining({ status: "NOTED" }),
      ]);
      expect(
        recorded.some(
          ([, step]) =>
            step.status === "REFUSED" &&
            step.reasonCode === "UNANSWERED_QUESTION",
        ),
      ).toBe(true);
    } finally {
      MATERIAL_OVERRIDE.value = null;
      THREAD_OVERRIDE.value = null;
    }
  });

  it("terms or money stay theirs: the question goes to them, and a reply is their card", async () => {
    MATERIAL_OVERRIDE.value = {
      sender: { side: "INVESTOR", facts: mandate(true) },
      counterparts: new Map(),
    };
    THREAD_OVERRIDE.value = {
      ...asked,
      facts:
        asked.facts === null
          ? null
          : { ...asked.facts, mentionsTermsOrMoney: true },
    };
    try {
      const {
        engine,
        row,
        notices,
        asked: cards,
      } = world([{ steps: [reply], cannot: [] }]);
      await engine.fire(row.id, "run-0303");
      expect(notices.map((notice) => notice.key)).toContain(
        "question:msg-0001",
      );
      expect(cards.map((card) => card.actionType)).toEqual([
        "app.chat.message.send",
      ]);
    } finally {
      MATERIAL_OVERRIDE.value = null;
      THREAD_OVERRIDE.value = null;
    }
  });
});

describe("a stopped or paused instruction never fires (QA run 8a1d57b9)", () => {
  it.each(["STOPPED", "PAUSED"] as const)(
    "%s: a firing claimed just before is NOT_ACTIVE -- no plan, no step",
    async (status) => {
      ran.length = 0;
      const { engine, row, planned, steps } = world([
        { steps: [chat("Hello.")], cannot: [] },
      ]);
      (row as { status: string }).status = status;
      const result = await engine.fire(row.id, "run-0401");
      expect(result.outcome).toBe("NOT_ACTIVE");
      expect(planned).toEqual([]);
      expect(steps.size).toBe(0);
      expect(ran).toHaveLength(0);
    },
  );
});

describe("live QA (instruction 76d6f281): code decides from the conversation", () => {
  const SEED_ONLY: InstructionMaterial = {
    sender: {
      side: "INVESTOR",
      facts: mandateFacts(
        {
          cheque: { currency: "USD", min: "250000", max: "1000000" },
          stage: { minStageCode: "seed", maxStageCode: "seed" },
          constraints: [
            {
              dimension: "investment_role",
              operator: "IN",
              value: { kind: "codes", values: ["lead"] },
              isHardExclusion: false,
            },
          ],
          taxonomyPreferences: [],
        },
        (code) =>
          ({ seed: "Seed", series_b: "Series B", lead: "Lead rounds" })[code],
      ),
      criteria: {
        minStageCode: "seed",
        maxStageCode: "seed",
        countries: [],
        excludedCountries: [],
      },
    },
    counterparts: new Map([
      [
        COMPANY,
        companyCardFacts(
          {
            currentStageCode: "series_b",
            headquartersCountry: null,
            shortDescription:
              "Acme Robotics builds warehouse picking robots for grocery retailers.",
          },
          (code) => ({ series_b: "Series B" })[code],
          "their Capital Q profile",
        ),
      ],
    ]),
  };
  const firstMessage = chat(
    "Warehouse picking robots for grocery retailers, as your profile puts it -- which retailers are you piloting with?",
    { message: { kind: "FIRST", asks: "QUESTION" } },
  );
  const check = (
    step: InstructionPlanStep,
    options: {
      grant?: InstructionGrant;
      introduced?: ReadonlySet<string>;
      material?: InstructionMaterial;
      facts?: ReadonlyMap<
        string,
        InstructionThreadFacts & {
          questionAbout?: readonly ("CHEQUE_SIZE" | "LEAD_OR_FOLLOW")[];
        }
      >;
    } = {},
  ) =>
    validateStep(step, {
      grant: options.grant ?? grant(),
      actions: ACTIONS,
      people: PEOPLE,
      sent: new Map(),
      now: IN_HOURS,
      stepKey: "instr:test:run:0",
      ...(options.introduced === undefined
        ? {}
        : { introduced: options.introduced }),
      ...(options.material === undefined ? {} : { material: options.material }),
      ...(options.facts === undefined ? {} : { facts: options.facts }),
    });

  it("a first message where their side already wrote (another instruction, the night before) is refused; a follow-up only where the grant allows", () => {
    const written = new Set([REL]);
    expect(
      check(firstMessage, {
        introduced: written,
        grant: grant({ followUps: false }),
      }),
    ).toMatchObject({ verdict: "REFUSED", code: "ALREADY_INTRODUCED" });
    // A follow-up under a first-message-only grant: refused too.
    expect(
      check(
        chat("Any news on the pilots?", {
          message: { kind: "FOLLOW_UP", asks: "QUESTION" },
        }),
        {
          introduced: written,
          grant: grant({ followUps: false }),
        },
      ),
    ).toMatchObject({ verdict: "REFUSED", code: "ALREADY_INTRODUCED" });
    // Follow-ups allowed: it is sent as one.
    expect(check(firstMessage, { introduced: written })).toMatchObject({
      verdict: "AUTO",
    });
    // Nothing from their side yet: a first message.
    expect(
      check(firstMessage, {
        introduced: new Set(),
        grant: grant({ followUps: false }),
      }),
    ).toMatchObject({ verdict: "AUTO" });
  });

  it("no first message to a company outside the declared stages; no claim of fit either", () => {
    expect(
      check(firstMessage, { introduced: new Set(), material: SEED_ONLY }),
    ).toMatchObject({ verdict: "REFUSED", code: "OUTSIDE_MANDATE" });
  });

  it("they wrote first: a cold introduction back is refused, a reply to them is not (live seed, 7 Oct)", () => {
    const theyWrote = new Map([
      [
        REL,
        {
          lastFrom: "THEM" as const,
          asksQuestion: false,
          wantsToMeet: true,
          proposedTime: null,
          topicNumbers: [],
          mentionsTermsOrMoney: false,
          declined: false,
          tone: "POSITIVE" as const,
        },
      ],
    ]);
    expect(
      check(
        chat(
          "Hello Ledgerline team -- checking every invoice at creation brings compliance into the workflow. I came across the company through your Capital Q profile. How are SMEs responding to the product?",
          { message: { kind: "FIRST", asks: "QUESTION" } },
        ),
        { introduced: new Set(), facts: theyWrote },
      ),
    ).toMatchObject({ verdict: "REFUSED", code: "COLD_OPEN_IN_REPLY" });
    expect(
      check(
        chat(
          "Thanks for writing, Tobenna. Please do share the deck -- how are SMEs responding to checks at invoice creation?",
          { message: { kind: "REPLY", asks: "QUESTION" } },
        ),
        { introduced: new Set(), facts: theyWrote },
      ),
    ).toMatchObject({ verdict: "AUTO" });
    // No message from them: the same words are a first message, not refused here.
    expect(
      check(firstMessage, { introduced: new Set(), facts: new Map() }),
    ).toMatchObject({ verdict: "AUTO" });
  });

  it("a message the planner says asks for a meeting is refused without AUTO booking", () => {
    const noBooking = grant({
      actions: grant().actions.filter(
        (entry) => entry.action !== "schedule.meeting.book",
      ),
    });
    expect(
      check(
        chat("Thanks for the update on the pilots. Would next week suit?", {
          message: { kind: "FOLLOW_UP", asks: "MEETING" },
        }),
        {
          grant: noBooking,
          material: {
            sender: { side: "INVESTOR", facts: [] },
            counterparts: new Map(),
          },
        },
      ),
    ).toMatchObject({ verdict: "REFUSED", code: "MEETING_NOT_ALLOWED" });
  });

  it("a declared cheque range, in code's words, answering their question, runs AUTO even when the planner flags money", () => {
    const facts = new Map([
      [
        REL,
        {
          lastFrom: "THEM" as const,
          asksQuestion: true,
          wantsToMeet: false,
          proposedTime: null,
          topicNumbers: [],
          mentionsTermsOrMoney: false,
          declined: false,
          tone: "POSITIVE" as const,
          questionAbout: ["CHEQUE_SIZE" as const, "LEAD_OR_FOLLOW" as const],
        },
      ],
    ]);
    const answer = chat(
      "We write cheques from USD 250,000 to USD 1,000,000. We lead rounds. What are you raising for?",
      {
        touchesTermsOrMoney: true,
        message: { kind: "REPLY", asks: "QUESTION" },
      },
    );
    expect(
      check(answer, { material: SEED_ONLY, facts, introduced: new Set([REL]) }),
    ).toMatchObject({ verdict: "AUTO" });
    // ASK card f3e411b7's words: refused, AUTO or not.
    expect(
      check(
        chat(
          "We typically invest USD 600,000, with a usual range of USD 250,000 to USD 1,000,000. We can lead rounds or co-invest alongside a lead.",
          { touchesTermsOrMoney: true },
        ),
        { material: SEED_ONLY, facts, introduced: new Set([REL]) },
      ),
    ).toMatchObject({ verdict: "REFUSED", code: "UNGROUNDED_NUMBER" });
  });

  it("where they wrote first and your side hasn't, the planner is told to reply, not introduce (live seed, 7 Oct)", async () => {
    const { row } = world([{ steps: [], cannot: [] }]);
    const seen: string[] = [];
    const wired = createInstructionEngine({
      store: {
        instruction: () => Promise.resolve({ ...row, grant_payload: grant() }),
        expire: () => Promise.resolve(),
        recordStep: () => Promise.resolve(true),
        stepDone: () => Promise.resolve(false),
        messagesSent: () => Promise.resolve(new Map<string, number>()),
        history: () => Promise.resolve([]),
        addSpend: () => Promise.resolve(),
        pause: () => Promise.resolve(true),
        notify: () => Promise.resolve(true),
      },
      actions: ACTIONS,
      ports: {},
      actorFor: () => Promise.resolve(actor),
      people: () => Promise.resolve(PEOPLE),
      introduced: () => Promise.resolve(new Set<string>()),
      readThread: (input: { relationshipId: string }) =>
        Promise.resolve({
          facts:
            input.relationshipId === REL
              ? {
                  lastFrom: "THEM" as const,
                  asksQuestion: false,
                  wantsToMeet: true,
                  proposedTime: null,
                  topicNumbers: [],
                  mentionsTermsOrMoney: false,
                  declined: false,
                  tone: "POSITIVE" as const,
                }
              : null,
          costUsd: 0,
        }),
      plan: (_who, variables) => {
        seen.push(variables.people);
        return Promise.resolve({
          plan: { request: "EXECUTE", steps: [], cannot: [] },
          costUsd: 0,
        });
      },
      ask: () => Promise.resolve(null),
      now: () => IN_HOURS,
      autoEnabled: true,
    });
    await wired.fire(row.id, "run-0402");
    expect(seen[0]).toContain(
      "they wrote first and your side hasn't replied: any message is a reply to them, not an introduction",
    );
    // The other conversation, with nothing from them: still a first message.
    expect(seen[0]).toContain("no message from your side yet");
  });

  it("a firing reads each conversation and tells the planner who has heard from them; a failed read counts as written", async () => {
    const reads: string[][] = [];
    const { row } = world([{ steps: [], cannot: [] }]);
    const seen: string[] = [];
    const wired = createInstructionEngine({
      store: {
        instruction: () => Promise.resolve({ ...row, grant_payload: grant() }),
        expire: () => Promise.resolve(),
        recordStep: () => Promise.resolve(true),
        stepDone: () => Promise.resolve(false),
        messagesSent: () => Promise.resolve(new Map<string, number>()),
        history: () => Promise.resolve([]),
        addSpend: () => Promise.resolve(),
        pause: () => Promise.resolve(true),
        notify: () => Promise.resolve(true),
      },
      actions: ACTIONS,
      ports: {},
      actorFor: () => Promise.resolve(actor),
      people: () => Promise.resolve(PEOPLE),
      introduced: (_actor, ids) => {
        reads.push([...ids]);
        return Promise.resolve(new Set([REL]));
      },
      plan: (_who, variables) => {
        seen.push(variables.people);
        return Promise.resolve({
          plan: { request: "EXECUTE", steps: [], cannot: [] },
          costUsd: 0,
        });
      },
      ask: () => Promise.resolve(null),
      now: () => IN_HOURS,
      autoEnabled: true,
    });
    await wired.fire(row.id, "run-0401");
    expect(reads).toEqual([[REL, OTHER_REL]]);
    expect(seen[0]).toContain(
      "your side has already written here: no first message",
    );
    expect(seen[0]).toContain("no message from your side yet");

    // The reader: any message from their side counts, by them or by Q;
    // a failed read, or a window full of the other side's, counts too.
    const message = (from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE") => ({
      id: randomUUID(),
      viaQ: false,
      envelope: null,
      from,
      senderName: "x",
      kind: "TEXT" as const,
      text: "hello",
      attachmentTitle: null,
      sentAt: IN_HOURS.toISOString(),
    });
    const threads: Record<string, ReturnType<typeof message>[] | null> = {
      a: [message("OTHER_SIDE"), message("YOUR_SIDE")],
      b: [message("OTHER_SIDE")],
      c: [],
      d: null,
      e: Array.from({ length: 30 }, () => message("OTHER_SIDE")),
    };
    const written = await createIntroducedReader({
      chat: {
        readForQ: ({ relationshipId }) => {
          const messages = threads[relationshipId];
          return messages === null || messages === undefined
            ? Promise.reject(new Error("unavailable"))
            : Promise.resolve({
                side: "INVESTOR",
                connected: true,
                blocked: false,
                messages,
              } as never);
        },
      },
    })(actor, ["a", "b", "c", "d", "e"]);
    expect([...written].sort()).toEqual(["a", "d", "e"]);
  });
});

describe("any hour (live QA 01a6124a)", () => {
  it("every day 00:00-23:59 is in hours at any minute, the last one too", () => {
    const always = {
      timeZone: "UTC",
      days: [1, 2, 3, 4, 5, 6, 7],
      start: "00:00",
      end: "23:59",
    };
    for (const at of [
      "2026-10-04T00:00:00Z",
      "2026-10-04T03:17:00Z",
      "2026-10-03T23:59:30Z",
    ]) {
      expect(withinWorkingHours(new Date(at), always), at).toBe(true);
    }
  });
});

/**
 * Founder brief J2 at the engine (review gap 2026-10-06): with the reviewer
 * on, a standing instruction's message is graded before it goes. A draft
 * below the bar is redrafted from the reviewer's feedback and the redraft
 * is what is sent; one that never passes is neither sent nor offered; an
 * offered one is tied to its approval card so the person's decision
 * reaches the agents' learning.
 */
describe("a firing with the reviewer on", () => {
  const passing = {
    criteria: DRAFT_RUBRIC_CRITERIA.map((criterion) => ({
      criterion,
      score: 5,
      note: "",
    })),
    integrity: DRAFT_INTEGRITY_RULES.map((rule) => ({
      rule,
      ok: true,
      note: "",
    })),
    feedback: "",
  };
  const failing = {
    ...passing,
    criteria: passing.criteria.map((one) => ({ ...one, score: 1 })),
    feedback: "Asks for a meeting in the first line; start warm.",
  };

  function reviewer(
    grades: readonly (typeof passing)[],
    redraft: string | null,
  ) {
    const store = createInMemoryWorkforceStore();
    const seen: string[] = [];
    let call = 0;
    const review = createOutwardReview({
      store,
      models: {
        review: (_who, _trace, variables) => {
          seen.push(variables.draft);
          const grade = grades[Math.min(call, grades.length - 1)];
          call += 1;
          return Promise.resolve(grade ?? null);
        },
        redraft: () => Promise.resolve(redraft),
      },
    });
    return { store, review, seen };
  }

  it("redrafts a draft below the bar and sends the one that passed", async () => {
    ran.length = 0;
    const { store, review, seen } = reviewer(
      [failing, passing],
      "Ada, your 310 installs stand out.",
    );
    const { engine, row } = world(
      [{ steps: [chat("Could we get 30 minutes this week?")], cannot: [] }],
      true,
      IN_HOURS,
      "0",
      { review, principalName: () => Promise.resolve("Ada Obi") },
    );
    const result = await engine.fire(row.id, "run-review-1");
    expect(result).toMatchObject({ outcome: "RAN", done: 1 });
    expect(seen).toEqual([
      "Could we get 30 minutes this week?",
      "Ada, your 310 installs stand out.",
    ]);
    expect(ran).toHaveLength(1);
    expect(ran[0]?.name).toBe("chat.message.send");
    expect(ran[0]?.input).toMatchObject({
      input: { kind: "TEXT", body: "Ada, your 310 installs stand out." },
    });
    expect(store.rows.drafts.map((d) => d.attempt)).toEqual([1, 2]);
    expect(store.rows.grades.map((g) => g.passed)).toEqual([false, true]);
    expect(store.rows.outcomes).toEqual([
      expect.objectContaining({ outcome: "SENT" }),
    ]);
    expect(store.rows.jobs[0]).toMatchObject({
      source_kind: "INSTRUCTION",
      source_id: row.id,
    });
  });

  it("autopilot P1: the reviewer is told the message is written inside Capital Q, so saying so is grounded", async () => {
    ran.length = 0;
    const store = createInMemoryWorkforceStore();
    const materials: string[] = [];
    const review = createOutwardReview({
      store,
      models: {
        review: (_who, _trace, variables) => {
          materials.push(variables.material);
          return Promise.resolve(passing);
        },
        redraft: () => Promise.resolve(null),
      },
    });
    const { engine, row } = world(
      [{ steps: [chat("I came across your Capital Q profile.")], cannot: [] }],
      true,
      IN_HOURS,
      "0",
      { review, principalName: () => Promise.resolve("Ada Obi") },
    );
    await engine.fire(row.id, "run-review-platform");
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatch(
      /^Platform: Ada Obi writes inside Capital Q, where .+ has a Capital Q profile/u,
    );
  });

  it("never sends or offers a draft that does not pass", async () => {
    ran.length = 0;
    const { store, review } = reviewer([failing], null);
    const { engine, row, asked, steps } = world(
      [{ steps: [chat("Could we get 30 minutes this week?")], cannot: [] }],
      true,
      IN_HOURS,
      "0",
      { review },
    );
    await engine.fire(row.id, "run-review-2");
    expect(ran).toHaveLength(0);
    expect(asked).toHaveLength(0);
    expect(store.rows.outcomes).toEqual([
      expect.objectContaining({ outcome: "HELD" }),
    ]);
    expect(
      [...steps.values()].some((step) => step.reasonCode === "BELOW_THE_BAR"),
    ).toBe(true);
  });

  it("ties an offered draft to its approval card, so the decision teaches", async () => {
    ran.length = 0;
    const { store, review } = reviewer([passing], null);
    const { engine, row, asked } = world(
      [{ steps: [chat("Ada, your installs stand out.")], cannot: [] }],
      false,
      IN_HOURS,
      "0",
      { review },
    );
    await engine.fire(row.id, "run-review-3");
    expect(asked).toHaveLength(1);
    const offered = store.rows.outcomes.find((o) => o.outcome === "OFFERED");
    expect(offered?.q_action_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      await store.draftForAction(
        { tenantId, userId },
        offered?.q_action_id ?? "",
      ),
    ).toBe(offered?.draft_id);
  });
});

describe("founder rule 2026-10-06: nothing but interest before they accept", () => {
  const notYet = (state: string | null): InstructionPerson[] =>
    PEOPLE.map((person, index) =>
      index === 0 ? { ...person, state } : person,
    );
  it.each(["INTEREST_EXPRESSED", "DISCOVERED", null])(
    "a message to someone %s is refused, never a card",
    (state) => {
      const result = validateStep(chat("Hello from Ada's Q."), {
        grant: grant(),
        actions: ACTIONS,
        people: notYet(state),
        sent: new Map<string, number>(),
        now: IN_HOURS,
        stepKey: "instr:test:run:0",
      });
      expect(verdictOf(result)).toBe("REFUSED:NOT_CONNECTED_YET");
    },
  );
  it("a grant that says ASK for messages still never offers the card", () => {
    const asking = grant();
    const result = validateStep(chat("Hello from Ada's Q."), {
      grant: {
        ...asking,
        actions: asking.actions.map((entry) => ({
          ...entry,
          mode: "ASK" as const,
        })),
      },
      actions: ACTIONS,
      people: notYet("INTEREST_EXPRESSED"),
      sent: new Map<string, number>(),
      now: IN_HOURS,
      stepKey: "instr:test:run:0",
    });
    expect(verdictOf(result)).toBe("REFUSED:NOT_CONNECTED_YET");
  });
  it("connected (or later) still writes", () => {
    for (const state of ["CONNECTED", "MEETING_HELD", "IN_DILIGENCE"]) {
      const result = validateStep(chat("Hello from Ada's Q."), {
        grant: grant(),
        actions: ACTIONS,
        people: notYet(state),
        sent: new Map<string, number>(),
        now: IN_HOURS,
        stepKey: "instr:test:run:0",
      });
      expect(verdictOf(result)).toBe("AUTO");
    }
  });
  it("a firing drops the message step without a card or a recorded step", async () => {
    PEOPLE_OVERRIDE.value = notYet("INTEREST_EXPRESSED");
    try {
      const { engine, row, asked, steps } = world(
        [{ steps: [chat("Hello from Ada's Q.")], cannot: [] }],
        false,
      );
      await engine.fire(row.id, "run-nc01");
      expect(asked).toEqual([]);
      expect(
        [...steps.values()].some((step) => step.action === "chat.message.send"),
      ).toBe(false);
    } finally {
      PEOPLE_OVERRIDE.value = null;
    }
  });
});

describe("a card still waiting is never drafted again (founder, 13:34 and 13:54)", () => {
  it("skips an ASK whose card for the same person still waits", async () => {
    WAITING_OVERRIDE.value = [
      {
        action: "chat.message.send",
        relationship_id: REL,
        words: "Say hello to Acme.",
      },
    ];
    try {
      const { engine, row, asked } = world(
        [
          {
            steps: [
              chat("Hello from Ada's Q."),
              chat("Hello Beta.", {}, OTHER_REL),
            ],
            cannot: [],
          },
        ],
        false,
      );
      await engine.fire(row.id, "run-dup1");
      // Autonomy off: both would be cards; only Beta's is new.
      expect(asked).toHaveLength(1);
    } finally {
      WAITING_OVERRIDE.value = [];
    }
  });
});

describe("F24 follow-up: a waiting draft the conversation moved past is superseded, then redrafted (Zino, 7 Oct)", () => {
  const DRAFTED = new Date("2026-10-07T08:03:57Z");
  const APPROVAL = randomUUID();
  // The live card to Ledgerline (action 8c6b06ef), drafted before the fix.
  const COLD =
    "Hello Ledgerline team — checking every invoice at creation and filing VAT returns for Nigerian SMEs brings compliance into the workflow. I came across the company through your Capital Q profile. How are SMEs responding to the product?";
  const card = (body: string | null = COLD): WaitingCard => ({
    action: "chat.message.send",
    relationship_id: REL,
    words: "Waiting for your yes: Introduce Ledgerline specifically",
    created_at: DRAFTED,
    approval_id: APPROVAL,
    body,
  });
  const pace = (lastFromThemAt: Date, lastFrom: "THEM" | "US" = "THEM") => ({
    lastFrom,
    lastFromUsAt: null,
    unansweredFromUs: 0,
    theyHaveWritten: true,
    lastFromThemAt,
  });
  const theyWroteFirst = new Date("2026-10-06T17:27:45Z");

  it("code decides: a newer message from them, or a cold open while they wrote last; an unread thread never", () => {
    const later = new Date(DRAFTED.getTime() + 60_000);
    expect(
      staleCards(
        [card("Thanks Tobenna, yes please send the deck.")],
        new Map([[REL, pace(later)]]),
      ).map((one) => one.reason),
    ).toEqual(["NEWER_MESSAGE_FROM_THEM"]);
    expect(
      staleCards([card()], new Map([[REL, pace(theyWroteFirst)]])).map(
        (one) => one.reason,
      ),
    ).toEqual(["COLD_OPEN_IN_REPLY"]);
    // A reply drafted after their message, and before any new one, stands.
    expect(
      staleCards(
        [card("Thanks Tobenna, yes please send the deck.")],
        new Map([[REL, pace(theyWroteFirst)]]),
      ),
    ).toEqual([]);
    // Unknown is never "moved on"; a card with no open approval is left be.
    expect(staleCards([card()], new Map())).toEqual([]);
    expect(
      staleCards(
        [{ ...card(), approval_id: null }],
        new Map([[REL, pace(theyWroteFirst)]]),
      ),
    ).toEqual([]);
    // Other kinds of card are not chat drafts.
    expect(
      staleCards(
        [{ ...card(), action: "meeting.schedule" }],
        new Map([[REL, pace(later)]]),
      ),
    ).toEqual([]);
  });

  const thread: ThreadRead = {
    facts: {
      lastFrom: "THEM",
      asksQuestion: true,
      wantsToMeet: true,
      proposedTime: null,
      topicNumbers: [1],
      mentionsTermsOrMoney: false,
      declined: false,
      tone: "POSITIVE",
      questionAbout: ["OTHER"],
    },
    costUsd: 0,
    pace: pace(theyWroteFirst),
  };
  const reply = chat(
    "Thanks Tobenna. 1,140 SMEs filing through Ledgerline is real pull; yes, please share the deck.",
    { words: "Reply to Ledgerline's offer of the deck." },
  );

  it("a firing supersedes the stale card through the Approval Engine, notes it, and drafts the reply in its place", async () => {
    const superseded: { approvalId: string; reason: string }[] = [];
    THREAD_OVERRIDE.value = thread;
    WAITING_OVERRIDE.value = [card()];
    try {
      const { engine, row, asked, steps } = world(
        [{ steps: [reply], cannot: [] }],
        false,
        IN_HOURS,
        "0",
        {
          awaitingAnswer: () => Promise.resolve(new Set([REL])),
          supersedeCard: (_actor, input) => {
            superseded.push(input);
            return Promise.resolve(true);
          },
        },
      );
      await engine.fire(row.id, "run-f24a");
      expect(superseded).toEqual([
        { approvalId: APPROVAL, reason: "COLD_OPEN_IN_REPLY" },
      ]);
      const note = [...steps.values()].find(
        (step) => step.reasonCode === "DRAFT_SUPERSEDED",
      );
      expect(note?.status).toBe("NOTED");
      expect(note?.words).toMatch(
        /^Replaced my waiting draft to .+: it introduced you as if they hadn't written to you first\./u,
      );
      // No longer waiting: the reply is drafted as a new card.
      expect(asked.map((one) => one.actionType)).toEqual([
        "app.chat.message.send",
      ]);
    } finally {
      THREAD_OVERRIDE.value = null;
      WAITING_OVERRIDE.value = [];
    }
  });

  it("when the engine cannot supersede it (decided meanwhile), the card still counts as waiting: no second card", async () => {
    THREAD_OVERRIDE.value = thread;
    WAITING_OVERRIDE.value = [card()];
    try {
      const { engine, row, asked, steps } = world(
        [{ steps: [reply], cannot: [] }],
        false,
        IN_HOURS,
        "0",
        {
          awaitingAnswer: () => Promise.resolve(new Set([REL])),
          supersedeCard: () => Promise.resolve(false),
        },
      );
      await engine.fire(row.id, "run-f24b");
      expect(asked).toEqual([]);
      expect(
        [...steps.values()].some(
          (step) => step.reasonCode === "DRAFT_SUPERSEDED",
        ),
      ).toBe(false);
    } finally {
      THREAD_OVERRIDE.value = null;
      WAITING_OVERRIDE.value = [];
    }
  });
});
