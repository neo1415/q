import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import {
  handleEverythingGrant,
  type InstructionGrant,
} from "@capital-q/contracts";
import type { InstructionPlanResult } from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInstructionEngine,
  MAX_REPLANS,
  meetingWithinWorkingHours,
  validateStep,
  withinWorkingHours,
  type InstructionPerson,
  type InstructionPlanStep,
} from "../src/composition/instructions/engine.js";
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
  relationshipId = REL,
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
  } = {},
) {
  return validateStep(step, {
    grant: options.grant ?? grant(),
    actions: ACTIONS,
    people: PEOPLE,
    sent: options.sent ?? new Map<string, number>(),
    now: options.now ?? IN_HOURS,
    stepKey: "instr:test:run:0",
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

  it("refuses someone the instruction does not cover", () => {
    expect(verdictOf(validate(chat("Hi", {}, randomUUID())))).toBe(
      "REFUSED:OUT_OF_SCOPE",
    );
    const listed = grant({
      counterparts: { scope: "LISTED", relationshipIds: [REL] },
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

function world(plans: readonly InstructionPlanResult[], autoEnabled = true) {
  const row: InstructionRow = {
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: userId,
    organisation_id: null,
    goal_text: "Handle all the work for me",
    status: "ACTIVE",
    grant_version: 1,
    budget_usd_month: "5.00",
    spent_usd_month: "0",
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
  } as unknown as InstructionStore;
  const engine = createInstructionEngine({
    store,
    actions: ACTIONS,
    ports: {},
    actorFor: () => Promise.resolve(actor),
    people: () => Promise.resolve(PEOPLE),
    plan: (_who, variables) => {
      planned.push(variables.refusals);
      const plan = plans[Math.min(call, plans.length - 1)] ?? null;
      call += 1;
      return Promise.resolve(plan);
    },
    ask: (_actor, card) => {
      asked.push({ actionType: card.actionType, key: card.key });
      return Promise.resolve({ qActionId: randomUUID() });
    },
    now: () => IN_HOURS,
    autoEnabled,
  });
  return { engine, row, steps, asked, planned };
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
});
