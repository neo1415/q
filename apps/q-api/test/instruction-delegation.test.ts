import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import {
  DELEGATION_LIMITS,
  handleEverythingGrant,
  INSTRUCTION_DELEGATION_WORDS,
  type InstructionGrant,
} from "@capital-q/contracts";
import type { InstructionThreadFacts } from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import { createQWorkPagePort } from "../../api/src/q-work-port.js";
import {
  createInstructionEngine,
  validateStep,
  workingDaysBetween,
  type InstructionPerson,
  type InstructionPlanStep,
  type ValidationContext,
} from "../src/composition/instructions/engine.js";
import type { ThreadPace } from "../src/composition/instructions/quarantine.js";
import type {
  InstructionRow,
  InstructionStore,
} from "../src/composition/instructions/store.js";
import { instructionStepDto } from "../src/composition/work/actions.js";
import type {
  OutwardReview,
  OutwardVerdict,
} from "../src/composition/workforce/review.js";

/**
 * Scoped delegation (founder 2026-10-07, CLAUDE.md Authority "unless
 * explicit scoped delegation exists"): with the person's delegation on,
 * routine moves in a conversation that already exists go without a card;
 * everything else still asks first. Fakes only; every verdict is code's.
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
const NEW_REL = randomUUID();
const COMPANY = randomUUID();
const DELEGATION = randomUUID();
const MESSAGE_ID = randomUUID();
// Wednesday 2026-10-07, 10:00 in Lagos (09:00 UTC).
const IN_HOURS = new Date("2026-10-07T09:00:00Z");

const ran: { name: string; key: string }[] = [];

function declared(name: string, input: z.ZodType): AnyAppAction {
  return {
    name,
    classification: "CONSEQUENTIAL",
    does: `Does ${name}.`,
    input,
    authorize: () => Promise.resolve({ ok: true }),
    run: (_ports: unknown, context: { idempotencyKey: string }) => {
      ran.push({ name, key: context.idempotencyKey });
      return Promise.resolve(
        name === "chat.message.send"
          ? { message: { id: MESSAGE_ID }, deduplicated: false }
          : {},
      );
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
  ),
];

const PEOPLE: readonly InstructionPerson[] = [
  {
    relationshipId: REL,
    counterpartKind: "COMPANY",
    counterpartId: COMPANY,
    name: "Ledgerline",
    state: "CONNECTED",
  },
  {
    relationshipId: NEW_REL,
    counterpartKind: "COMPANY",
    counterpartId: randomUUID(),
    name: "Tarmacly",
    state: "INTEREST_EXPRESSED",
  },
];

/** Zino's live grant: messages and bookings ASK (instruction 54e6dba6). */
function zinoGrant(): InstructionGrant {
  return {
    ...handleEverythingGrant({ timeZone: "Africa/Lagos", side: "INVESTOR" }),
    actions: [
      { action: "relationship.interest.express", mode: "AUTO" },
      { action: "chat.message.send", mode: "ASK" },
      { action: "schedule.meeting.book", mode: "ASK" },
      { action: "relationship.outcome.change", mode: "ASK" },
    ],
  };
}

const REPLY =
  "Thank you, Tobenna, and thanks for accepting. Checking each invoice the moment it is created is a smart place to sit. I would be glad to read the deck you offered whenever it suits you.";

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
    topic: "their company",
    touchesTermsOrMoney: false,
    words: "Reply to Ledgerline.",
    ...overrides,
  };
}

function book(startsAt: string): InstructionPlanStep {
  return {
    action: "schedule.meeting.book",
    argumentsJson: JSON.stringify({
      relationshipId: REL,
      idempotencyKey: "model-written-key",
      input: { purpose: "Intro call", startsAt, durationMinutes: 30 },
    }),
    topic: "times to meet",
    touchesTermsOrMoney: false,
    words: "Accept the time Ledgerline proposed.",
  };
}

const theyWrote = (
  over: Partial<InstructionThreadFacts> = {},
): ReadonlyMap<string, InstructionThreadFacts> =>
  new Map([
    [
      REL,
      {
        lastFrom: "THEM",
        asksQuestion: false,
        wantsToMeet: true,
        proposedTime: null,
        topicNumbers: [2],
        mentionsTermsOrMoney: false,
        declined: false,
        tone: "POSITIVE",
        ...over,
      },
    ],
  ]);

function check(
  step: InstructionPlanStep,
  options: Partial<ValidationContext> = {},
) {
  return validateStep(step, {
    grant: zinoGrant(),
    actions: ACTIONS,
    people: PEOPLE,
    sent: new Map<string, number>(),
    now: IN_HOURS,
    stepKey: "instr:test:run:0",
    facts: theyWrote(),
    delegation: { id: DELEGATION },
    ...options,
  });
}

const verdictOf = (result: ReturnType<typeof check>) =>
  result.verdict === "REFUSED" || result.verdict === "HOLD"
    ? `${result.verdict}:${result.code}`
    : `${result.verdict}${result.code === null ? "" : `:${result.code}`}${
        result.verdict === "AUTO" && result.delegationId !== undefined
          ? "+delegated"
          : ""
      }`;

describe("delegated vs asks first (the matrix)", () => {
  it.each([
    ["a reply in a live chat", chat(REPLY), {}, "AUTO+delegated"],
    [
      "accepting a time they proposed, in working hours",
      book("2026-10-08T10:00:00Z"),
      {},
      "AUTO+delegated",
    ],
    [
      "a time outside working hours",
      book("2026-10-08T19:00:00Z"),
      {},
      "ASK:MEETING_OUTSIDE_HOURS",
    ],
    [
      "anything about money or terms",
      chat(REPLY, { touchesTermsOrMoney: true }),
      {},
      "ASK:TERMS_OR_MONEY",
    ],
    [
      "a reply where they raised terms",
      chat(REPLY),
      { facts: theyWrote({ mentionsTermsOrMoney: true }) },
      "ASK:THEY_RAISED_TERMS",
    ],
    [
      "a reply after they said no",
      chat(REPLY),
      { facts: theyWrote({ declined: true }) },
      "ASK:THEY_DECLINED",
    ],
    [
      "a reply off the approved topics",
      chat(REPLY, { topic: "valuation" }),
      {},
      "ASK:OFF_TOPIC",
    ],
    [
      "a relationship outcome (a commitment, never routine)",
      {
        action: "relationship.outcome.change",
        argumentsJson: JSON.stringify({ relationshipId: REL, outcome: "PASS" }),
        topic: null,
        touchesTermsOrMoney: false,
        words: "Pass on Ledgerline.",
      },
      {},
      "ASK",
    ],
    [
      "first contact with someone not yet connected",
      chat(REPLY, {}, NEW_REL),
      {},
      "REFUSED:NOT_CONNECTED_YET",
    ],
    [
      "the same reply with delegation off",
      chat(REPLY),
      { delegation: null },
      "ASK",
    ],
  ] as const)("%s", (_label, step, options, expected) => {
    expect(verdictOf(check(step, options))).toBe(expected);
  });

  it("a shared document still asks first", () => {
    const attachment: InstructionPlanStep = {
      ...chat(REPLY),
      argumentsJson: JSON.stringify({
        relationshipId: REL,
        idempotencyKey: "model-written-key",
        input: { kind: "ATTACHMENT", documentId: "doc-1" },
      }),
    };
    expect(verdictOf(check(attachment))).toBe("ASK:ATTACHMENT");
  });

  it("under delegation Q may propose a call once they have written back", () => {
    const proposing = chat(
      "Thank you, Tobenna. Checking invoices at creation is a smart place to sit. Would a 30 minute call on Thursday morning suit you?",
      {
        asks: undefined,
        topic: "times to meet",
      } as Partial<InstructionPlanStep>,
    );
    // Ledgerline's own material, so code's message check runs.
    const material = {
      sender: { side: "INVESTOR" as const, facts: [] },
      counterparts: new Map([
        [
          COMPANY,
          [
            {
              label: "what they do",
              text: "Checks invoices at creation and files VAT for Nigerian SMEs.",
              source: "their Capital Q profile",
              anchors: ["invoice", "vat"],
              kind: "DESCRIPTION" as const,
            },
          ],
        ],
      ]),
    };
    expect(verdictOf(check(proposing, { material }))).toBe("AUTO+delegated");
    expect(verdictOf(check(proposing, { material, delegation: null }))).toBe(
      "REFUSED:MEETING_NOT_ALLOWED",
    );
  });
});

describe("caps", () => {
  const silent = (pace: Partial<ThreadPace>) =>
    new Map<string, ThreadPace>([
      [
        REL,
        {
          lastFrom: "US",
          lastFromUsAt: null,
          unansweredFromUs: 1,
          theyHaveWritten: true,
          ...pace,
        },
      ],
    ]);
  const followUp = chat(
    "Tobenna, a gentle follow-up on invoice checking at creation: if it is easy to share the deck you mentioned, I would be glad to read it this week.",
  );
  const quiet = theyWrote({ lastFrom: "US" });

  it("a follow-up after silence waits three of their working days", () => {
    // Friday 2 Oct: Mon, Tue, Wed since -- three working days, and over
    // the five calendar days of the house pacing.
    expect(
      verdictOf(
        check(followUp, {
          facts: quiet,
          pace: silent({ lastFromUsAt: new Date("2026-10-02T09:00:00Z") }),
        }),
      ),
    ).toBe("AUTO+delegated");
    // Monday 5 Oct: too soon.
    expect(
      verdictOf(
        check(followUp, {
          facts: quiet,
          pace: silent({ lastFromUsAt: new Date("2026-10-05T09:00:00Z") }),
        }),
      ),
    ).toBe("HOLD:TOO_SOON_TO_FOLLOW_UP");
  });

  it("never more than two unanswered in a row: then it asks", () => {
    expect(
      verdictOf(
        check(followUp, {
          facts: quiet,
          pace: silent({
            lastFromUsAt: new Date("2026-09-28T09:00:00Z"),
            unansweredFromUs: DELEGATION_LIMITS.followUpsInARow,
          }),
        }),
      ),
    ).toBe("ASK:UNANSWERED");
  });

  it("at most the day's cap on its own, then it asks", () => {
    const today = { count: DELEGATION_LIMITS.sendsPerDay - 1 };
    expect(verdictOf(check(chat(REPLY), { delegatedToday: today }))).toBe(
      "AUTO+delegated",
    );
    expect(today.count).toBe(DELEGATION_LIMITS.sendsPerDay);
    expect(verdictOf(check(chat(REPLY), { delegatedToday: today }))).toBe(
      "ASK:DELEGATION_DAILY_CAP",
    );
  });

  it("counts their working days in their zone", () => {
    const hours = zinoGrant().workingHours;
    const friday = new Date("2026-10-02T09:00:00Z");
    expect(
      workingDaysBetween(friday, new Date("2026-10-05T09:00:00Z"), hours),
    ).toBe(1);
    expect(
      workingDaysBetween(friday, new Date("2026-10-07T09:00:00Z"), hours),
    ).toBe(3);
    expect(
      workingDaysBetween(friday, IN_HOURS, { ...hours, timeZone: "Not/AZone" }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A firing: Done for you, audited; revoked; unreviewed
// ---------------------------------------------------------------------------

function passed(body: string): OutwardVerdict {
  return {
    verdict: "PASSED",
    body,
    score: 90,
    attempts: 1,
    jobId: null,
    draftId: null,
  };
}

function world(options: {
  readonly delegation: { id: string } | null;
  readonly review?: OutwardReview | undefined;
  readonly audit?: boolean;
}) {
  ran.length = 0;
  const audits: unknown[] = [];
  const asked: string[] = [];
  const steps = new Map<
    string,
    {
      status: string;
      words: string;
      reasonCode: string | null;
      messageId?: string | null;
    }
  >();
  const row: InstructionRow = {
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: userId,
    organisation_id: null,
    goal_text:
      "Reply to founders who accept or write to me, follow up when they go quiet, and propose meetings in my working hours; ask me first for anything about money, terms or commitments",
    status: "ACTIVE",
    grant_version: 1,
    budget_usd_month: "5.00",
    spent_usd_month: "0",
    spent_this_month: "0",
    pause_reason: null,
    expires_at: new Date("2026-11-01T00:00:00Z"),
    stopped_at: null,
    conversation_id: null,
    created_at: IN_HOURS,
    updated_at: IN_HOURS,
    grant_payload: zinoGrant(),
  };
  const store = {
    instruction: () => Promise.resolve(row),
    expire: () => Promise.resolve(),
    recordStep: (step: {
      idempotencyKey: string;
      status: string;
      words: string;
      reasonCode: string | null;
      messageId?: string | null;
    }) => {
      steps.set(step.idempotencyKey, step);
      return Promise.resolve(true);
    },
    stepDone: (key: string) => Promise.resolve(steps.has(key)),
    messagesSent: () => Promise.resolve(new Map<string, number>()),
    history: () => Promise.resolve([]),
    addSpend: () => Promise.resolve(),
    pause: () => Promise.resolve(true),
    notify: () => Promise.resolve(true),
    delegationOf: () =>
      Promise.resolve(
        options.delegation === null
          ? null
          : {
              id: options.delegation.id,
              scope: "RELATIONSHIP_ROUTINE",
              enabled_at: IN_HOURS,
            },
      ),
    delegatedSince: () => Promise.resolve(0),
  } as unknown as InstructionStore;
  const engine = createInstructionEngine({
    store,
    actions: ACTIONS,
    ports: {},
    actorFor: () => Promise.resolve(actor),
    people: () => Promise.resolve(PEOPLE),
    readThread: (input: { relationshipId: string }) =>
      Promise.resolve(
        input.relationshipId === REL
          ? {
              facts: { ...theyWrote().get(REL), questionAbout: [] } as never,
              costUsd: 0,
            }
          : { facts: null, costUsd: 0 },
      ),
    plan: () =>
      Promise.resolve({
        plan: { request: "EXECUTE" as const, steps: [chat(REPLY)], cannot: [] },
        costUsd: 0.01,
      }),
    ask: (_actor, card) => {
      asked.push(card.actionType);
      return Promise.resolve({ qActionId: randomUUID() });
    },
    now: () => IN_HOURS,
    autoEnabled: true,
    ...(options.review === undefined ? {} : { review: options.review }),
    ...(options.audit === false
      ? {}
      : {
          auditDelegated: (entry) => {
            audits.push(entry);
            return Promise.resolve();
          },
        }),
  });
  return { engine, row, steps, asked, audits };
}

const reviewer: OutwardReview = {
  prepare: () => Promise.resolve(null),
  review: (_who, _source, draft) => Promise.resolve(passed(draft.body)),
  abandon: () => Promise.resolve(),
  settle: () => Promise.resolve(),
};

describe("a firing under delegation", () => {
  it("sends the reply on its own: Done for you, with the message to unsend, audited under the delegation and the instruction", async () => {
    const { engine, row, steps, asked, audits } = world({
      delegation: { id: DELEGATION },
      review: reviewer,
    });
    const result = await engine.fire(row.id, "run-deleg-1");
    expect(result).toMatchObject({ done: 1, asked: 0 });
    expect(asked).toEqual([]);
    expect(ran).toEqual([
      { name: "chat.message.send", key: `instr:${row.id}:run-deleg-1:0` },
    ]);
    const step = [...steps.values()][0];
    expect(step).toMatchObject({
      status: "DONE",
      reasonCode: "DELEGATED",
      messageId: MESSAGE_ID,
    });
    expect(step?.words.startsWith("Done for you:")).toBe(true);
    expect(audits).toEqual([
      expect.objectContaining({
        delegationId: DELEGATION,
        instructionId: row.id,
        action: "chat.message.send",
        relationshipId: REL,
        idempotencyKey: `instr:${row.id}:run-deleg-1:0`,
        messageId: MESSAGE_ID,
      }),
    ]);
  });

  it("revoked (no live delegation): the same reply is the person's card", async () => {
    const { engine, row, asked } = world({
      delegation: null,
      review: reviewer,
    });
    await engine.fire(row.id, "run-deleg-2");
    expect(ran).toEqual([]);
    expect(asked).toEqual(["app.chat.message.send"]);
  });

  it("not read by the reviewer: asked, never sent", async () => {
    const { engine, row, asked, steps } = world({
      delegation: { id: DELEGATION },
    });
    await engine.fire(row.id, "run-deleg-3");
    expect(ran).toEqual([]);
    expect(asked).toEqual(["app.chat.message.send"]);
    expect([...steps.values()][0]?.reasonCode).toBe("NOT_REVIEWED");
  });

  it("without an audit sink nothing runs under a delegation", async () => {
    const { engine, row, asked } = world({
      delegation: { id: DELEGATION },
      review: reviewer,
      audit: false,
    });
    await engine.fire(row.id, "run-deleg-4");
    expect(ran).toEqual([]);
    expect(asked).toEqual(["app.chat.message.send"]);
  });

  it("tells the planner the delegation in plain words", async () => {
    const seen: string[] = [];
    const { row } = world({ delegation: { id: DELEGATION }, review: reviewer });
    const engine = createInstructionEngine({
      store: {
        instruction: () => Promise.resolve(row),
        messagesSent: () => Promise.resolve(new Map()),
        history: () => Promise.resolve([]),
        stepDone: () => Promise.resolve(false),
        recordStep: () => Promise.resolve(true),
        addSpend: () => Promise.resolve(),
        delegationOf: () =>
          Promise.resolve({
            id: DELEGATION,
            scope: "RELATIONSHIP_ROUTINE",
            enabled_at: IN_HOURS,
          }),
        delegatedSince: () => Promise.resolve(0),
      } as unknown as InstructionStore,
      actions: ACTIONS,
      ports: {},
      actorFor: () => Promise.resolve(actor),
      people: () => Promise.resolve(PEOPLE),
      plan: (_who, variables) => {
        seen.push(variables.grant);
        return Promise.resolve({ plan: null, costUsd: 0 });
      },
      ask: () => Promise.resolve(null),
      now: () => IN_HOURS,
      autoEnabled: true,
      auditDelegated: () => Promise.resolve(),
    });
    await engine.fire(row.id, "run-deleg-5");
    expect(seen[0]).toContain(
      `Delegation: on -- ${INSTRUCTION_DELEGATION_WORDS}`,
    );
  });
});

describe("Work shows it", () => {
  it("Done for you, with the chat's unsend for a short while only", () => {
    const at = new Date("2026-10-07T09:00:00Z");
    const step = {
      words: "Done for you: Reply to Ledgerline.",
      created_at: at,
      reason_code: "DELEGATED",
      relationship_id: REL,
      message_id: MESSAGE_ID,
    };
    expect(
      instructionStepDto(step, new Date(at.getTime() + 60_000)),
    ).toMatchObject({
      doneForYou: true,
      undo: { relationshipId: REL, messageId: MESSAGE_ID },
    });
    expect(
      instructionStepDto(
        step,
        new Date(at.getTime() + (DELEGATION_LIMITS.unsendMinutes + 1) * 60_000),
      ).undo,
    ).toBeNull();
    expect(
      instructionStepDto({ ...step, reason_code: null, message_id: null }),
    ).toMatchObject({ doneForYou: false, undo: null });
  });
});

describe("the switch is the person's own, on their own instruction", () => {
  function port(rows: { id: string }[]) {
    const audited: { actionType: string; resourceId: string }[] = [];
    const queries: unknown[][] = [];
    const tx = {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
        queries.push([strings.join("?"), ...values]);
        return Promise.resolve(rows);
      },
    };
    const qWork = createQWorkPagePort((() => Promise.resolve([])) as never, {
      transactions: {
        run: (work: (context: typeof tx) => Promise<unknown>) => work(tx),
      } as never,
      audit: {
        record: (
          _tx: unknown,
          input: { actionType: string; resourceId: string },
        ) => {
          audited.push(input);
          return Promise.resolve(input.actionType as never);
        },
      } as never,
    });
    return { qWork, audited, queries };
  }

  it("switching on writes the delegation and its audit; off revokes and audits", async () => {
    const on = port([{ id: DELEGATION }]);
    expect(await on.qWork.setDelegation?.(actor, randomUUID(), true)).toBe(
      true,
    );
    expect(on.audited).toEqual([
      expect.objectContaining({
        actionType: "q.delegation.enabled",
        resourceId: DELEGATION,
      }),
    ]);
    const off = port([{ id: DELEGATION }]);
    expect(await off.qWork.setDelegation?.(actor, randomUUID(), false)).toBe(
      true,
    );
    expect(off.audited[0]?.actionType).toBe("q.delegation.revoked");
    // Every write is predicated on the person's own user and tenant.
    expect(off.queries[0]).toEqual(
      expect.arrayContaining([actor.userId, actor.tenantId]),
    );
  });

  it("another tenant's instruction (no row of theirs): nothing changes, nothing audited", async () => {
    const other = port([]);
    expect(await other.qWork.setDelegation?.(actor, randomUUID(), true)).toBe(
      false,
    );
    expect(other.audited).toEqual([]);
  });
});
