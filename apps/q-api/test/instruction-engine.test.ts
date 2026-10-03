import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import {
  handleEverythingGrant,
  type InstructionGrant,
} from "@capital-q/contracts";
import type {
  InstructionPlanResult,
  InstructionThreadFacts,
} from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInstructionEngine,
  inScope,
  MAX_REPLANS,
  meetingWithinWorkingHours,
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
import type { ThreadRead } from "../src/composition/instructions/quarantine.js";
import type {
  InstructionRow,
  InstructionStore,
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
  } = {},
) {
  return validateStep(step, {
    grant: options.grant ?? grant(),
    actions: ACTIONS,
    people: PEOPLE,
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
      expect(result.done).toBe(6);
      expect(result.deferred).toBe(2);
      // Six steps taken, and one NOTED line naming who waits (QA run
      // 8a1d57b9: Tallyloom was skipped with no record).
      expect(recorded.size).toBe(7);
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
      expect(first).toEqual(["Hello 0", "Second to the first"]);
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
    "Our typical cheque is $250k, and yes, we lead rounds. What are you raising for?",
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
