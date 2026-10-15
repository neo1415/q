import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import {
  handleEverythingGrant,
  type InstructionGrant,
} from "@capital-q/contracts";
import type { InstructionThreadFacts } from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import {
  messageSignOff,
  OWNER_ONLY,
  ROUTINE_MESSAGE_KINDS,
  type MessageSignOffInput,
} from "../src/composition/instructions/delegation-policy.js";
import {
  createInstructionEngine,
  goalBookingCard,
  onlyNeedsApproval,
  validateStep,
  type InstructionPerson,
  type InstructionPlanStep,
  type MeetingEvidence,
} from "../src/composition/instructions/engine.js";
import {
  bookingKey,
  isTerminal,
  meetingGoalState,
  readNegotiation,
  slotsIn,
  type MeetingGoalState,
  type NegotiationLine,
} from "../src/composition/instructions/meeting-goal.js";
import { qualityProblem } from "../src/composition/instructions/message-quality.js";
import type { ThreadRead } from "../src/composition/instructions/quarantine.js";
import type {
  InstructionRow,
  InstructionStore,
} from "../src/composition/instructions/store.js";

/**
 * Lane N (owner 2026-10-15): the meeting goal is decided by code, the
 * negotiation stops there, the investor side gets one booking card, the
 * reviewer signs off routine messages, and drafts are short and new. The
 * thread below is the live Tensorgate/Zino exchange (9 Oct), renamed.
 * No model and no provider: every verdict is code's.
 */

const at = (iso: string) => new Date(iso);
const US = (sentAt: string, text: string): NegotiationLine => ({
  from: "US",
  sentAt: at(sentAt),
  text,
});
const THEM = (sentAt: string, text: string): NegotiationLine => ({
  from: "THEM",
  sentAt: at(sentAt),
  text,
});

// The investor's side ("US"), Friday 9 Oct.
const AGREED_THREAD: readonly NegotiationLine[] = [
  US(
    "2026-10-09T11:15:00Z",
    "Wednesday would suit me well; what time works best for you?",
  ),
  THEM(
    "2026-10-09T11:25:00Z",
    "Thank you for confirming Wednesday. Would 2:00 p.m. UTC work for you?",
  ),
  US(
    "2026-10-09T15:33:00Z",
    "Thank you, Ada. Wednesday at 2:00 p.m. UTC works well for me.",
  ),
];
const WED_2PM = "2026-10-14T14:00:00.000Z";

describe("times in words (code's read)", () => {
  it("resolves a weekday, a clock time and a zone to one instant", () => {
    expect(
      slotsIn(
        "Wednesday at 2:00 p.m. UTC works well for me.",
        at("2026-10-09T15:33:00Z"),
        "Europe/London",
      ).map((slot) => slot.startsAt.toISOString()),
    ).toEqual([WED_2PM]);
    // A dated time in a named zone (the errand's own words).
    expect(
      slotsIn(
        "Would Wed 14 Oct, 14:00 (Africa/Lagos) work for a 30-minute call?",
        at("2026-10-13T11:44:00Z"),
        "UTC",
      ).map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-10-14T13:00:00.000Z"]);
    // The default zone when none is said.
    expect(
      slotsIn(
        "Friday at 2pm?",
        at("2026-10-14T06:55:00Z"),
        "Europe/London",
      ).map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-10-16T13:00:00.000Z"]);
  });

  it("a time with no day, or numbers that are not times, is not a slot", () => {
    expect(slotsIn("Would 2:00 p.m. UTC work?", at(WED_2PM), "UTC")).toEqual(
      [],
    );
    expect(
      slotsIn(
        "Four design partners, two $180k contracts and 31m requests on Wednesday.",
        at(WED_2PM),
        "UTC",
      ),
    ).toEqual([]);
  });
});

describe("the terminal-state detector", () => {
  it("both sides agreed a concrete time: AGREED, terminal (the live thread)", () => {
    const negotiation = readNegotiation(AGREED_THREAD, "UTC");
    expect(negotiation.agreed?.slot.startsAt.toISOString()).toBe(WED_2PM);
    expect(negotiation.agreed?.proposedBy).toBe("THEM");
    const goal = meetingGoalState({
      negotiation,
      calls: [],
      now: at("2026-10-12T10:00:00Z"),
    });
    expect(goal.state).toBe("AGREED");
    expect(isTerminal(goal)).toBe(true);
  });

  it("re-confirmations keep it agreed; a different time or a decline reopens it", () => {
    const reconfirmed = readNegotiation(
      [
        ...AGREED_THREAD,
        THEM(
          "2026-10-13T17:53:00Z",
          "Thank you for confirming Wednesday at 2:00 p.m. UTC. See you then.",
        ),
      ],
      "UTC",
    );
    expect(reconfirmed.agreed?.slot.startsAt.toISOString()).toBe(WED_2PM);

    const moved = readNegotiation(
      [
        ...AGREED_THREAD,
        THEM(
          "2026-10-12T09:00:00Z",
          "Unfortunately Wednesday doesn't work any more. Could we do Thursday at 3pm UTC?",
        ),
      ],
      "UTC",
    );
    expect(moved.agreed).toBeNull();
    expect(
      moved.proposedToUs.map((slot) => slot.startsAt.toISOString()),
    ).toEqual(["2026-10-15T15:00:00.000Z"]);
    const goal = meetingGoalState({
      negotiation: moved,
      calls: [],
      now: at("2026-10-12T10:00:00Z"),
    });
    expect(goal.state).toBe("PROPOSED_TO_US");
    expect(isTerminal(goal)).toBe(false);
  });

  it("an acceptance of a time nobody else named is not an agreement", () => {
    const one = readNegotiation(
      [US("2026-10-09T11:15:00Z", "Wednesday at 2pm UTC works for me.")],
      "UTC",
    );
    expect(one.agreed).toBeNull();
    expect(
      meetingGoalState({ negotiation: one, calls: [], now: at(WED_2PM) }).state,
    ).toBe("OPEN");
    // Unknown stays open.
    expect(
      meetingGoalState({ negotiation: undefined, calls: [], now: at(WED_2PM) })
        .state,
    ).toBe("OPEN");
  });

  it("a booked call is the truth, whatever the words say; it ends after the call", () => {
    const call = {
      id: randomUUID(),
      startsAt: WED_2PM,
      endsAt: "2026-10-14T14:30:00.000Z",
      timeZone: "UTC",
      status: "SCHEDULED" as const,
      organisedByYou: false,
    };
    expect(
      meetingGoalState({
        negotiation: undefined,
        calls: [call],
        now: at("2026-10-12T10:00:00Z"),
      }).state,
    ).toBe("BOOKED");
    expect(
      meetingGoalState({
        negotiation: undefined,
        calls: [{ ...call, status: "CANCELLED" }],
        now: at("2026-10-12T10:00:00Z"),
      }).state,
    ).toBe("OPEN");
    // Long after the call, with a new message from them: a new conversation.
    const later = readNegotiation(
      [
        ...AGREED_THREAD,
        THEM("2026-10-20T09:00:00Z", "Following up on our call."),
      ],
      "UTC",
    );
    expect(
      meetingGoalState({
        negotiation: later,
        calls: [],
        now: at("2026-10-20T10:00:00Z"),
      }).state,
    ).toBe("OPEN");
  });
});

describe("the delegation policy: who signs off a message", () => {
  const routine: MessageSignOffInput = {
    delegated: true,
    reviewer: "PASSED",
    body: "We have four design partners; two converted to $180k contracts. Would Tuesday 10:00 or Wednesday 15:00 UTC suit you?",
    grounded: true,
    acceptsTime: false,
    proposesTimes: true,
    answersFromFacts: false,
  };

  it("the reviewer signs off routine messages inside the delegation", () => {
    expect(messageSignOff(routine)).toEqual({
      by: "REVIEWER",
      kind: "PROPOSE_TIMES",
    });
    expect(
      messageSignOff({
        ...routine,
        proposesTimes: false,
        answersFromFacts: true,
      }),
    ).toEqual({ by: "REVIEWER", kind: "FACTUAL_ANSWER" });
    expect(
      messageSignOff({
        ...routine,
        body: "Noted, speak Wednesday.",
        proposesTimes: false,
      }),
    ).toEqual({ by: "REVIEWER", kind: "ACKNOWLEDGEMENT" });
    expect(ROUTINE_MESSAGE_KINDS).toEqual([
      "PROPOSE_TIMES",
      "FACTUAL_ANSWER",
      "ACKNOWLEDGEMENT",
    ]);
  });

  it("the owner is asked for commitments, restricted data, terms, flags, and without delegation", () => {
    const owner = (over: Partial<MessageSignOffInput>) => {
      const out = messageSignOff({ ...routine, ...over });
      return out.by === "OWNER" ? out.reason : out.by;
    };
    expect(owner({ acceptsTime: true })).toBe("CALENDAR_COMMITMENT");
    expect(
      owner({
        body: "Happy to discuss a $4m round at a $20m pre-money valuation.",
      }),
    ).toBe("COMMERCIAL_TERMS");
    expect(owner({ body: "We'd invest $500k if the round closes." })).toBe(
      "COMMERCIAL_TERMS",
    );
    expect(owner({ grounded: false })).toBe("RESTRICTED_DATA");
    expect(owner({ reviewer: "HELD" })).toBe("REVIEWER_FLAGGED");
    expect(owner({ reviewer: "NOT_REVIEWED" })).toBe("REVIEWER_FLAGGED");
    expect(owner({ delegated: false })).toBe("NOT_DELEGATED");
    // Owner-only wins over routine: a passed draft that commits still asks.
    expect(owner({ reviewer: "PASSED", acceptsTime: true })).toBe(
      "CALENDAR_COMMITMENT",
    );
    expect(OWNER_ONLY).toContain("COMMERCIAL_TERMS");
  });
});

describe("message quality (code's check against what this side wrote)", () => {
  const before =
    "Hello Acme team, thank you for sharing that four design partners have converted two $180k contracts, alongside the 31 million requests served. Would Tuesday or Wednesday suit you better?";

  it("blocks a repeated or near-duplicate message", () => {
    expect(
      qualityProblem({ body: before, replying: true, ours: [before] }),
    ).toBe("NEAR_DUPLICATE");
    expect(
      qualityProblem({
        body: "Hello Acme team, thank you for sharing that four design partners have led to two $180k contracts, alongside the 31 million requests served. Would Wednesday suit you?",
        replying: false,
        ours: [before],
      }),
    ).toBe("NEAR_DUPLICATE");
    expect(
      qualityProblem({
        body: "Wednesday 14:00 UTC is in my calendar.",
        replying: true,
        ours: [before],
      }),
    ).toBeNull();
  });

  it("caps a reply's length, repeated thanks and more than one ask", () => {
    expect(
      qualityProblem({
        body: Array.from({ length: 81 }, () => "word").join(" "),
        replying: true,
        ours: [],
      }),
    ).toBe("MESSAGE_TOO_LONG");
    expect(
      qualityProblem({
        body: "Thank you for the note. Tuesday at 10:00 UTC works.",
        replying: true,
        ours: ["Thanks for getting back to me."],
      }),
    ).toBe("REPEATED_PLEASANTRY");
    expect(
      qualityProblem({
        body: "Can you share the deck? And what is your burn?",
        replying: true,
        ours: [],
      }),
    ).toBe("MORE_THAN_ONE_ASK");
  });
});

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const userId = randomUUID();
const tenantId = randomUUID();
const actor = ActorContextSchema.parse({
  userId,
  tenantId,
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const REL = randomUUID();
// Monday 2026-10-12, 11:00 in London.
const NOW = at("2026-10-12T10:00:00Z");
const ran: { name: string; key: string; input: unknown }[] = [];

function declared(name: string, input: z.ZodType): AnyAppAction {
  return {
    name,
    classification: "CONSEQUENTIAL",
    does: `Does ${name}.`,
    input,
    authorize: () => Promise.resolve({ ok: true }),
    run: (_p: unknown, context: { idempotencyKey: string }, value: unknown) => {
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
        input: z.object({ kind: z.literal("TEXT"), body: z.string() }).strict(),
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
            timeZone: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
  ),
];

/** The investor side: the counterpart is a company. */
const INVESTOR_SIDE: readonly InstructionPerson[] = [
  {
    relationshipId: REL,
    counterpartKind: "COMPANY",
    counterpartId: randomUUID(),
    name: "Acme Robotics",
    state: "CONNECTED",
  },
];
/** The founder side: the counterpart is an investor organisation. */
const FOUNDER_SIDE: readonly InstructionPerson[] = [
  {
    relationshipId: REL,
    counterpartKind: "INVESTOR_ORGANISATION",
    counterpartId: randomUUID(),
    name: "Northwind Capital",
    state: "CONNECTED",
  },
];

function grant(chatMode: "AUTO" | "ASK" = "AUTO"): InstructionGrant {
  const base = handleEverythingGrant({
    timeZone: "Europe/London",
    topics: ["introductions", "times to meet"],
  });
  return {
    ...base,
    actions: [
      { action: "chat.message.send", mode: chatMode },
      { action: "schedule.meeting.book", mode: "ASK" },
    ],
  };
}

function chat(
  body: string,
  over: Partial<InstructionPlanStep> = {},
): InstructionPlanStep {
  return {
    action: "chat.message.send",
    argumentsJson: JSON.stringify({
      relationshipId: REL,
      idempotencyKey: "model-written-key",
      input: { kind: "TEXT", body },
    }),
    topic: "times to meet",
    touchesTermsOrMoney: false,
    words: "Reply to Acme.",
    ...over,
  };
}

const THEIR_LAST: InstructionThreadFacts = {
  lastFrom: "THEM",
  asksQuestion: false,
  wantsToMeet: true,
  proposedTime: null,
  topicNumbers: [2],
  mentionsTermsOrMoney: false,
  declined: false,
  tone: "POSITIVE",
};

function verdict(
  step: InstructionPlanStep,
  options: {
    people?: readonly InstructionPerson[];
    goal?: MeetingGoalState;
    delegated?: boolean;
    chatMode?: "AUTO" | "ASK";
  } = {},
): string {
  const out = validateStep(step, {
    grant: grant(options.chatMode ?? "AUTO"),
    actions: ACTIONS,
    people: options.people ?? INVESTOR_SIDE,
    sent: new Map(),
    now: NOW,
    stepKey: "instr:test:run:0",
    facts: new Map([[REL, THEIR_LAST]]),
    ...(options.delegated === true ? { delegation: { id: randomUUID() } } : {}),
    ...(options.goal === undefined
      ? {}
      : { goals: new Map([[REL, options.goal]]) }),
  });
  return out.verdict === "REFUSED"
    ? `REFUSED:${out.code}`
    : `${out.verdict}${out.code === null ? "" : `:${out.code}`}`;
}

const AGREED: MeetingGoalState = meetingGoalState({
  negotiation: readNegotiation(AGREED_THREAD, "UTC"),
  calls: [],
  now: NOW,
});

describe("post-terminal suppression (validator)", () => {
  it("after the goal is reached, any message to them is refused as GOAL_REACHED", () => {
    expect(AGREED.state).toBe("AGREED");
    expect(
      verdict(chat("Looking forward to Wednesday."), { goal: AGREED }),
    ).toBe("REFUSED:GOAL_REACHED");
    // The same message with no goal reached goes, as before.
    expect(verdict(chat("Noted, I'll send the agenda."))).toBe("AUTO");
  });

  it("their proposed time is the investor's booking card, never a chat yes", () => {
    const proposed = meetingGoalState({
      negotiation: readNegotiation(
        [THEM("2026-10-12T09:00:00Z", "Would Wednesday at 2pm UTC work?")],
        "UTC",
      ),
      calls: [],
      now: NOW,
    });
    expect(proposed.state).toBe("PROPOSED_TO_US");
    expect(
      verdict(chat("Wednesday at 2pm UTC works for me."), { goal: proposed }),
    ).toBe("REFUSED:BOOKING_FOR_YOUR_YES");
    // The founder side accepting is a calendar commitment: their yes.
    expect(
      verdict(chat("Wednesday at 2pm UTC works for us."), {
        goal: proposed,
        people: FOUNDER_SIDE,
      }),
    ).toBe("ASK:CALENDAR_COMMITMENT");
  });

  it("the planner's terms flag on declared figures goes to the reviewer under delegation; real terms ask", () => {
    const figures = chat(
      "Two of our four design partners converted to $180k contracts. Would Tuesday or Wednesday suit you?",
      { touchesTermsOrMoney: true },
    );
    // Delegated (chat is ASK in the grant, the delegation is on): AUTO,
    // and the engine still sends only once the reviewer passed it.
    expect(
      verdict(figures, {
        people: FOUNDER_SIDE,
        delegated: true,
        chatMode: "ASK",
      }),
    ).toBe("AUTO");
    // Without delegation it is the person's card, as before.
    expect(verdict(figures, { people: FOUNDER_SIDE })).toBe(
      "ASK:TERMS_OR_MONEY",
    );
    expect(
      verdict(
        chat("We are raising $4m at a $20m pre-money valuation.", {
          touchesTermsOrMoney: true,
        }),
        { people: FOUNDER_SIDE, delegated: true, chatMode: "ASK" },
      ),
    ).toBe("ASK:COMMERCIAL_TERMS");
  });
});

describe("the booking card", () => {
  const slot = { startsAt: at(WED_2PM), timeZone: "UTC" };

  it("its idempotency key is the relationship and the start: the same every firing", () => {
    expect(bookingKey(REL, slot)).toBe(bookingKey(REL, { ...slot }));
    expect(bookingKey(REL, slot)).toBe(`goal-book:${REL}:29866440`);
    expect(
      bookingKey(REL, {
        startsAt: at("2026-10-14T15:00:00Z"),
        timeZone: "UTC",
      }),
    ).not.toBe(bookingKey(REL, slot));
    expect(bookingKey(randomUUID(), slot)).not.toBe(bookingKey(REL, slot));
  });

  it("binds the exact slot; a waiting proposal is accepted through its own state machine", () => {
    const booking = goalBookingCard({
      relationshipId: REL,
      counterpartName: "Acme Robotics",
      slot,
      durationMinutes: 20,
      proposals: [],
    });
    expect(booking.actionType).toBe("app.schedule.meeting.book");
    expect(booking.payload).toEqual({
      relationshipId: REL,
      idempotencyKey: bookingKey(REL, slot),
      input: {
        purpose: "Call with Acme Robotics",
        startsAt: WED_2PM,
        durationMinutes: 20,
        timeZone: "UTC",
      },
    });
    const proposalId = randomUUID();
    const accept = goalBookingCard({
      relationshipId: REL,
      counterpartName: "Acme Robotics",
      slot,
      durationMinutes: 30,
      proposals: [
        {
          id: proposalId,
          state: "INVESTOR_REVIEW",
          options: [
            { startsAt: "2026-10-13T10:00:00Z" },
            { startsAt: WED_2PM },
          ],
        },
      ],
    });
    expect(accept.actionType).toBe("app.schedule.proposal.accept");
    expect(accept.payload).toEqual({
      relationshipId: REL,
      proposalId,
      idempotencyKey: bookingKey(REL, slot),
      input: { optionIndex: 1 },
    });
  });
});

describe("can't-lines that only need an approval are not the owner's", () => {
  it("drops 'already pending approval' and 'requires approval'; keeps real ones", () => {
    expect(
      onlyNeedsApproval({
        reason: "The same reply is already pending Daniel's approval.",
        instead: "Wait.",
      }),
    ).toBe(true);
    expect(
      onlyNeedsApproval({
        reason: "They are not connected.",
        instead: "Approve a relationship.connection_request.send step.",
      }),
    ).toBe(true);
    expect(
      onlyNeedsApproval({
        reason: "No listed action negotiates a term sheet.",
        instead: "I can summarise their terms for you.",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A firing
// ---------------------------------------------------------------------------

function firing(input: {
  people: readonly InstructionPerson[];
  thread: readonly NegotiationLine[];
  evidence?: MeetingEvidence;
  plan: readonly InstructionPlanStep[];
}) {
  const steps = new Map<
    string,
    { status: string; action: string; words: string; reasonCode: string | null }
  >();
  const asks: { actionType: string; payload: unknown; key: string }[] = [];
  const notices: { key: string; title: string; priority: string }[] = [];
  const row: InstructionRow = {
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: userId,
    organisation_id: null,
    goal_text: "Reply to founders and book calls with the good ones",
    status: "ACTIVE",
    grant_version: 1,
    budget_usd_month: "5.00",
    spent_usd_month: "0",
    spent_this_month: "0",
    pause_reason: null,
    expires_at: new Date("2026-11-01T00:00:00Z"),
    stopped_at: null,
    conversation_id: null,
    created_at: NOW,
    updated_at: NOW,
    grant_payload: grant(),
  };
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
    addSpend: () => Promise.resolve(),
    pause: () => Promise.resolve(true),
    notify: (notice: { key: string; title: string; priority: string }) => {
      notices.push(notice);
      return Promise.resolve(true);
    },
  } as unknown as InstructionStore;
  const read: ThreadRead = {
    facts: { ...THEIR_LAST, questionAbout: [] },
    costUsd: 0,
    pace: {
      lastFrom: input.thread[input.thread.length - 1]?.from ?? "NONE",
      lastFromUsAt: null,
      unansweredFromUs: 0,
      theyHaveWritten: true,
    },
    negotiation: readNegotiation(input.thread, "UTC"),
  };
  const engine = createInstructionEngine({
    store,
    actions: ACTIONS,
    ports: {},
    actorFor: () => Promise.resolve(actor),
    people: () => Promise.resolve(input.people),
    readThread: () => Promise.resolve(read),
    meetingEvidence: () =>
      Promise.resolve(
        new Map([[REL, input.evidence ?? { calls: [], proposals: [] }]]),
      ),
    plan: () =>
      Promise.resolve({
        plan: {
          request: "EXECUTE" as const,
          steps: [...input.plan],
          cannot: [],
        },
        costUsd: 0.01,
      }),
    ask: (_actor, card) => {
      asks.push({
        actionType: card.actionType,
        payload: card.payload,
        key: card.key,
      });
      return Promise.resolve({ qActionId: randomUUID() });
    },
    now: () => NOW,
    autoEnabled: true,
  });
  return { engine, steps, asks, notices };
}

describe("a firing after the goal is reached", () => {
  it("investor side: one booking card bound to the slot, the reply suppressed and logged, the same card next firing", async () => {
    ran.length = 0;
    const world = firing({
      people: INVESTOR_SIDE,
      thread: AGREED_THREAD,
      plan: [chat("Looking forward to Wednesday at 2:00 p.m. UTC.")],
    });
    await world.engine.fire(randomUUID(), "run-one-0001");
    await world.engine.fire(randomUUID(), "run-two-0002");
    // No message went, either time.
    expect(ran.filter((one) => one.name === "chat.message.send")).toEqual([]);
    // One card, for the exact slot, under the deterministic key.
    expect(world.asks).toHaveLength(1);
    expect(world.asks[0]?.actionType).toBe("app.schedule.meeting.book");
    expect(world.asks[0]?.payload).toMatchObject({
      relationshipId: REL,
      idempotencyKey: `goal-book:${REL}:29866440`,
      input: { startsAt: WED_2PM, durationMinutes: 30, timeZone: "UTC" },
    });
    const recorded = [...world.steps.values()];
    expect(
      recorded.filter((step) => step.reasonCode === "GOAL_BOOKING"),
    ).toHaveLength(1);
    // The planned reply: suppressed, noted (not a refusal for the person).
    const suppressed = recorded.filter(
      (step) => step.reasonCode === "GOAL_REACHED",
    );
    expect(suppressed.length).toBeGreaterThan(0);
    expect(suppressed.every((step) => step.status === "NOTED")).toBe(true);
    expect(
      world.notices.filter(
        (n) => n.priority === "NEEDS_YOU" && n.key.startsWith("reply-waiting"),
      ),
    ).toEqual([]);
  });

  it("founder side: the booked call is told to main Q once; nothing more is written", async () => {
    ran.length = 0;
    const callId = randomUUID();
    const world = firing({
      people: FOUNDER_SIDE,
      thread: AGREED_THREAD.map((line) => ({
        ...line,
        from: line.from === "US" ? ("THEM" as const) : ("US" as const),
      })),
      evidence: {
        calls: [
          {
            id: callId,
            startsAt: WED_2PM,
            endsAt: "2026-10-14T14:30:00.000Z",
            timeZone: "UTC",
            status: "SCHEDULED",
            organisedByYou: false,
          },
        ],
        proposals: [],
      },
      plan: [chat("Thank you for booking. See you Wednesday.")],
    });
    await world.engine.fire(randomUUID(), "run-one-0001");
    await world.engine.fire(randomUUID(), "run-two-0002");
    expect(ran).toEqual([]);
    expect(world.asks).toEqual([]);
    const booked = world.notices.filter(
      (n) => n.key === `goal-booked:${callId}`,
    );
    expect(booked).toHaveLength(1);
    expect(booked[0]?.title).toBe("Northwind Capital booked your call");
    expect(booked[0]?.priority).toBe("UPDATE");
  });
});
