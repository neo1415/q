import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyAppAction } from "@capital-q/app-actions";
import { InstructionGrantSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInstructionEngine,
  threadOwnNumbers,
  validateStep,
  type InstructionPerson,
  type InstructionPlanStep,
} from "../src/composition/instructions/engine.js";
import {
  companyCardFacts,
  investorProfileFacts,
  type InstructionMaterial,
} from "../src/composition/instructions/material.js";
import type { InstructionPlan } from "../src/composition/instructions/planner.js";
import {
  threadPace,
  transcriptOf,
  type ThreadRead,
} from "../src/composition/instructions/quarantine.js";
import type { InstructionRow } from "../src/composition/instructions/store.js";
import { createInstructionTriggers } from "../src/composition/instructions/triggers.js";

/**
 * Tensorgate, 2026-10-08 (instruction 4fe0050f): the founder's standing
 * instruction "respond immediately to any investor who replies" fired once
 * and said "Looked at 1 person: nothing to do right now" while Zino's reply
 * (07 Oct 15:43) sat unanswered. Three planning calls were made; every
 * drafted reply was refused (a proposed call with booking on ASK; the
 * founder's own numbers "ungrounded"; nothing from Zino's profile named),
 * the third plan was empty, and nothing reached the founder. Fixture: that
 * exact thread, that exact grant. No model; code's verdicts only.
 */

const actor = ActorContextSchema.parse({
  userId: randomUUID(),
  tenantId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const REL = randomUUID();
const ZINO_ORG = randomUUID();
// Thursday 2026-10-08 08:24 UTC, the instruction's first firing.
const FIRED_AT = new Date("2026-10-08T08:24:32Z");

/** The approved grant, as stored for 4fe0050f (grant version 1). */
const GRANT = InstructionGrantSchema.parse({
  tone: "Warm, brief and professional, in their own voice.",
  digest: "DAILY",
  topics: ["introductions", "their company", "times to meet"],
  actions: [
    { mode: "AUTO", action: "chat.message.send" },
    { mode: "ASK", action: "schedule.meeting.book" },
  ],
  counterparts: {
    scope: "ALL_MY_RELATIONSHIPS",
    exclude: [],
    relationshipIds: [],
    includeNewCompanies: false,
  },
  workingHours: {
    end: "23:59",
    days: [1, 2, 3, 4, 5, 6, 7],
    start: "00:00",
    timeZone: "UTC",
  },
  expiresInDays: 30,
  budgetUsdMonth: "5.00",
  routineReplies: true,
  maxMessagesPerCounterpart: 8,
});

const PEOPLE: readonly InstructionPerson[] = [
  {
    relationshipId: REL,
    counterpartKind: "INVESTOR_ORGANISATION",
    counterpartId: ZINO_ORG,
    name: "Zino Aviation",
    state: "CONNECTED",
  },
];

/** communication.messages of conversation 08b5cf9f, as Q reads them. */
const THREAD = [
  {
    id: randomUUID(),
    from: "YOU" as const,
    sentAt: "2026-10-06T17:28:35.767Z",
    text: "Thanks for connecting. Tensorgate is a policy gateway for LLM traffic in regulated industries: 4 design partners, 2 converted to $180k contracts, 31m requests served. Raising a $4m seed. Want the deck, or 20 minutes this week? Daniel",
    attachmentTitle: null,
  },
  {
    id: randomUUID(),
    from: "OTHER_SIDE" as const,
    sentAt: "2026-10-07T15:43:31.143Z",
    text: "Hello Tensorgate team — thank you for the invitation. Running LLM inference inside hardware enclaves and attesting every request addresses a concrete barrier for regulated firms using sensitive data. I’d be interested to hear how those firms are evaluating the gateway in practice. Would you be open to connecting?",
    attachmentTitle: null,
  },
];
const ZINO_LATEST = THREAD[1]?.text ?? "";

const FACTS = {
  lastFrom: "THEM" as const,
  asksQuestion: true,
  wantsToMeet: true,
  proposedTime: null,
  topicNumbers: [2],
  mentionsTermsOrMoney: false,
  declined: false,
  tone: "POSITIVE" as const,
  questionAbout: ["OTHER" as const],
};

function threadRead(messages = THREAD): ThreadRead {
  return {
    facts: { ...FACTS, lastFrom: threadPace(messages).lastFrom },
    costUsd: 0,
    pace: threadPace(messages),
    transcript: transcriptOf(messages),
    theirLatest: ZINO_LATEST,
  };
}

const labels = {
  code: (code: string) => ({ seed: "Seed", NG: "Nigeria" })[code],
  investorType: (code: string) => ({ ANGEL: "Angel" })[code],
};
const MATERIAL: InstructionMaterial = {
  sender: {
    side: "COMPANY",
    facts: companyCardFacts(
      {
        currentStageCode: "seed",
        headquartersCountry: null,
        shortDescription:
          "A gateway that runs LLM inference inside hardware enclaves and attests every request, so regulated firms can use AI on sensitive data.",
      },
      labels.code,
      "your company profile",
    ),
  },
  counterparts: new Map([
    [
      ZINO_ORG,
      investorProfileFacts(
        {
          investorType: "ANGEL",
          hqCountry: "NG",
          publicDescription:
            "I’m a founder and angel investor actively backing pre-seed companies, typically investing around €3 million, across B2B SaaS, enterprise software, fintech and consumer markets. I look for ambitious teams with strong technical capability.",
        },
        labels,
        "their Capital Q profile",
      ),
    ],
  ]),
};

const ran: { name: string; input: unknown }[] = [];
const CHAT: AnyAppAction = {
  name: "chat.message.send",
  classification: "CONSEQUENTIAL",
  does: "Sends a chat message.",
  input: z
    .object({
      relationshipId: z.string(),
      idempotencyKey: z.string().min(8),
      input: z.object({ kind: z.literal("TEXT"), body: z.string() }).strict(),
    })
    .strict(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (_ports: unknown, _context: unknown, value: unknown) => {
    ran.push({ name: "chat.message.send", input: value });
    return Promise.resolve({});
  },
} as unknown as AnyAppAction;
const BOOK = {
  ...CHAT,
  name: "schedule.meeting.book",
  input: z.object({ relationshipId: z.string() }).passthrough(),
} as AnyAppAction;

function reply(body: string, asks: "MEETING" | "QUESTION" | "NONE" = "NONE") {
  return {
    action: "chat.message.send",
    argumentsJson: JSON.stringify({
      relationshipId: REL,
      idempotencyKey: "model-written-key",
      input: { kind: "TEXT", body },
    }),
    topic: "their company",
    touchesTermsOrMoney: false,
    words: "Reply to Zino Aviation about how regulated firms evaluate it.",
    message: { kind: "REPLY", asks },
  } as InstructionPlanStep;
}

const WITH_CALL = reply(
  "Thank you, Zino. Regulated firms evaluate the gateway with a pilot on one sensitive workload, checking each enclave attestation. Two of our 4 design partners converted to $180k contracts. Would a 20 minute call this week suit you?",
  "MEETING",
);
const NO_CALL = reply(
  "Thank you, Zino. Regulated firms evaluate the gateway with a pilot on one sensitive workload, checking each enclave attestation before rollout; two design partners converted to $180k contracts. Happy to share the deck if useful.",
);

function world(plans: readonly InstructionPlan[], read = threadRead()) {
  const row: InstructionRow = {
    id: randomUUID(),
    tenant_id: actor.tenantId,
    user_id: actor.userId,
    organisation_id: null,
    goal_text:
      "make sure that wherever and whenever you see an investor reach out to you or reply a message, you respond to it immediately",
    status: "ACTIVE",
    grant_version: 1,
    budget_usd_month: "5.00",
    spent_usd_month: "0",
    spent_this_month: "0",
    pause_reason: null,
    expires_at: new Date("2026-11-07T08:24:31Z"),
    stopped_at: null,
    conversation_id: null,
    created_at: FIRED_AT,
    updated_at: FIRED_AT,
    grant_payload: GRANT,
  };
  const steps: {
    status: string;
    reasonCode: string | null;
    words: string;
    idempotencyKey: string;
  }[] = [];
  const notices: { key: string; title: string; priority: string }[] = [];
  const cards: { actionType: string; words: string }[] = [];
  const planned: string[] = [];
  const seenPeople: string[] = [];
  let call = 0;
  const engine = createInstructionEngine({
    store: {
      instruction: () => Promise.resolve(row),
      expire: () => Promise.resolve(),
      recordStep: (step) => {
        if (steps.some((one) => one.idempotencyKey === step.idempotencyKey)) {
          return Promise.resolve(false);
        }
        steps.push(step);
        return Promise.resolve(true);
      },
      stepDone: (key) =>
        Promise.resolve(steps.some((one) => one.idempotencyKey === key)),
      messagesSent: () => Promise.resolve(new Map<string, number>()),
      history: () => Promise.resolve([]),
      addSpend: () => Promise.resolve(),
      pause: () => Promise.resolve(true),
      notify: (notice) => {
        notices.push(notice);
        return Promise.resolve(true);
      },
    },
    actions: [CHAT, BOOK],
    ports: {},
    actorFor: () => Promise.resolve(actor),
    people: () => Promise.resolve(PEOPLE),
    material: () => Promise.resolve(MATERIAL),
    readThread: () => Promise.resolve(read),
    introduced: () => Promise.resolve(new Set([REL])),
    plan: (_who, variables) => {
      planned.push(variables.refusals);
      seenPeople.push(variables.people);
      const next = plans[Math.min(call, plans.length - 1)] ?? null;
      call += 1;
      return Promise.resolve({ plan: next, costUsd: 0.001 });
    },
    ask: (_actor, card) => {
      cards.push({ actionType: card.actionType, words: card.words });
      return Promise.resolve({ qActionId: randomUUID() });
    },
    now: () => FIRED_AT,
    autoEnabled: true,
  });
  return { engine, row, steps, notices, cards, planned, seenPeople };
}

const plan = (...steps: InstructionPlanStep[]): InstructionPlan => ({
  request: "EXECUTE",
  steps,
  cannot: [],
});

describe("founder side: Tensorgate's instruction answers Zino (8 Oct)", () => {
  it("a reply proposing a call, with booking on ASK and no delegation, is the founder's card -- not refused into silence", async () => {
    ran.length = 0;
    const { engine, row, cards, steps, planned } = world([plan(WITH_CALL)]);
    const result = await engine.fire(row.id, "sched-founder-1");
    expect(result).toMatchObject({ outcome: "RAN", asked: 1, refused: 0 });
    expect(planned).toEqual(["None."]);
    expect(cards).toEqual([
      expect.objectContaining({ actionType: "app.chat.message.send" }),
    ]);
    expect(steps.map((step) => step.reasonCode)).toEqual(["MEETING_NEEDS_YES"]);
    expect(steps[0]?.words).toContain("calls are yours to agree");
    expect(ran).toHaveLength(0);
  });

  it("a routine reply restating the founder's own numbers from the thread, and taking up what Zino said, is sent at once", async () => {
    ran.length = 0;
    const { engine, row, steps } = world([plan(NO_CALL)]);
    const result = await engine.fire(row.id, "sched-founder-2");
    expect(result).toMatchObject({ outcome: "RAN", done: 1, refused: 0 });
    expect(ran).toEqual([
      expect.objectContaining({ name: "chat.message.send" }),
    ]);
    expect(steps.some((step) => step.reasonCode === "NOTHING_TO_DO")).toBe(
      false,
    );
  });

  it("a number neither side's record holds is still refused", () => {
    const verdict = validateStep(
      reply(
        "Thank you, Zino. Regulated firms evaluate the gateway with a pilot on one sensitive workload; 7 banks signed $950k contracts.",
      ),
      {
        grant: GRANT,
        actions: [CHAT, BOOK],
        people: PEOPLE,
        sent: new Map(),
        now: FIRED_AT,
        stepKey: "instr:test:run:0",
        facts: new Map([[REL, FACTS]]),
        material: MATERIAL,
        introduced: new Set([REL]),
        threads: new Map([
          [
            REL,
            {
              theirTerms: [],
              ourNumbers: threadOwnNumbers(transcriptOf(THREAD)),
            },
          ],
        ]),
      },
    );
    expect(verdict).toMatchObject({
      verdict: "REFUSED",
      code: "UNGROUNDED_NUMBER",
    });
  });

  it("only the sender's own side's numbers count, never theirs", () => {
    const numbers = threadOwnNumbers(
      transcriptOf([
        ...THREAD,
        {
          id: randomUUID(),
          from: "OTHER_SIDE",
          sentAt: "2026-10-07T16:00:00Z",
          text: "We usually write $750k tickets.",
          attachmentTitle: null,
        },
      ]),
    );
    expect(numbers).toEqual(
      expect.arrayContaining([180_000, 31_000_000, 4_000_000]),
    );
    expect(numbers).not.toContain(750_000);
  });

  it("when no reply passes code's checks after the re-plans, Zino's message goes to the founder with the reason -- never 'nothing to do'", async () => {
    const coldOpen = reply(
      "I came across Tensorgate's investor list and would love to introduce our gateway for regulated firms.",
    );
    const { engine, row, steps, notices, planned } = world([
      plan(coldOpen),
      plan(coldOpen),
      plan(),
    ]);
    await engine.fire(row.id, "sched-founder-3");
    // Two re-plans with code's reasons, then one more because the plan
    // left Zino's waiting message unanswered.
    expect(planned).toHaveLength(4);
    expect(planned[3]).toContain(
      "NO REPLY PLANNED: Zino Aviation (relationshipId",
    );
    const waiting = steps.find((step) => step.reasonCode === "REPLY_WAITING");
    expect(waiting?.words).toBe(
      "Zino Aviation's message is waiting for a reply. I couldn't answer it on my own: they wrote to you first, and the message introduced you as if they hadn't (COLD_OPEN_IN_REPLY). Reply in the chat, or tell me what to say and I'll send it.",
    );
    expect(steps.some((step) => step.reasonCode === "NOTHING_TO_DO")).toBe(
      false,
    );
    expect(notices).toEqual([
      expect.objectContaining({
        priority: "NEEDS_YOU",
        title: "Zino Aviation is waiting for a reply",
      }),
    ]);
    // Once per message of theirs: the next firing adds nothing.
    await engine.fire(row.id, "sched-founder-4");
    expect(
      steps.filter((step) => step.reasonCode === "REPLY_WAITING"),
    ).toHaveLength(1);
  });

  it("backlog on creation: the first firing finds the reply that predates the instruction", async () => {
    // Zino wrote at 07 Oct 15:43; the instruction was created 08 Oct 08:24.
    const { engine, row, cards } = world([plan(WITH_CALL)]);
    expect(Date.parse(THREAD[1]?.sentAt ?? "")).toBeLessThan(
      row.created_at.getTime(),
    );
    await engine.fire(row.id, `sched-${FIRED_AT.toISOString()}`);
    expect(cards).toHaveLength(1);
  });

  it("with the last word the founder's, the line says why nothing was done", async () => {
    const ours = THREAD.slice(0, 1);
    const { engine, row, steps } = world([plan()], threadRead(ours));
    await engine.fire(row.id, "sched-founder-5");
    expect(steps).toEqual([
      expect.objectContaining({
        reasonCode: "NOTHING_TO_DO",
        words:
          "Looked at 1 person: no unanswered messages, so nothing to send right now. I'll look again when someone writes.",
      }),
    ]);
  });
});

describe("an empty plan with a reply waiting (second kick, 08:56)", () => {
  it("is re-planned once with code's words naming the waiting reply; the planner sees REPLY WAITING and the founder's own earlier words", async () => {
    ran.length = 0;
    const { engine, row, planned, steps, seenPeople } = world([
      plan(),
      plan(NO_CALL),
    ]);
    await engine.fire(row.id, "sched-founder-6");
    expect(seenPeople[0]).toContain(
      'REPLY WAITING: they wrote last and no one has answered: write one REPLY now; your side already said: "Thanks for connecting. Tensorgate is a policy gateway',
    );
    // The founder's own words only, never Zino's (S6).
    expect(seenPeople[0]).not.toContain("hardware enclaves and attesting");
    expect(planned).toHaveLength(2);
    expect(planned[1]).toContain("NO REPLY PLANNED");
    expect(ran).toHaveLength(1);
    expect(steps.some((step) => step.reasonCode === "REPLY_WAITING")).toBe(
      false,
    );
  });

  it("empty again after the nudge: one nudge only, then the founder is told, with NO_REPLY_PLANNED", async () => {
    const { engine, row, planned, steps } = world([plan()]);
    await engine.fire(row.id, "sched-founder-7");
    expect(planned).toHaveLength(2);
    expect(
      steps.find((step) => step.reasonCode === "REPLY_WAITING")?.words,
    ).toContain("my plan had no reply to them (NO_REPLY_PLANNED)");
  });
});

describe("wake on message: a new investor message runs the founder's instruction at once", () => {
  it("the chat wake claims and fires it in the same turn -- no timer, no cadence wait", async () => {
    ran.length = 0;
    const { engine, row } = world([plan(NO_CALL)]);
    let due = false;
    const triggers = createInstructionTriggers({
      store: {
        claimDue: () => {
          const claimed = due ? [{ id: row.id, claimed_at: new Date() }] : [];
          due = false;
          return Promise.resolve(claimed);
        },
        defer: () => Promise.resolve(),
        wakeFor: () => Promise.resolve(0),
        // The SQL makes due the receiving side's instructions (latest
        // sender INVESTOR -> the company's members).
        wakeForChat: (relationshipId) => {
          due = relationshipId === REL;
          return Promise.resolve(due ? 1 : 0);
        },
      },
      engine: () => engine,
    });
    const started = Date.now();
    expect(await triggers.wakeChat(REL)).toBe(1);
    await triggers.sweep();
    expect(ran).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(60_000);
  });
});
