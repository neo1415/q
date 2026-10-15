import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type ChatIntelligencePort,
  type RelationshipIntelligencePort,
  type ScheduleIntelligencePort,
} from "../src/index.js";
import { actorA, actorB, contextFor, fakePorts, planFor } from "./support.js";

/**
 * R34 chat tools: Q reads a thread and prepares chat actions only for a
 * relationship the firewall bound for this run AND that the invoker is a
 * party to; nothing is posted without approval.
 */

const RELATIONSHIP = "88888888-0000-4000-8000-0000000000c1";
const OTHER = "88888888-0000-4000-8000-0000000000c2";

function relationshipPlan(
  base: PermittedContextPlan,
  relationshipId: string,
): PermittedContextPlan {
  const template = base.scopes[0];
  if (template === undefined) throw new Error("plan has no scope");
  return {
    ...base,
    purpose: { ...base.purpose, taskClass: "RELATIONSHIP_QUESTION" },
    subjects: [{ kind: "RELATIONSHIP", relationshipId }],
    scopes: [
      ...base.scopes,
      {
        ...template,
        kind: "RELATIONSHIP_CONTEXT",
        subject: { kind: "RELATIONSHIP", relationshipId },
        contextLabel: "relationship_shared",
        filter: {
          tenantId: base.tenantId,
          relationshipIds: [relationshipId],
          contextLabels: ["investor_private", "relationship_shared"],
        },
      },
    ],
  };
}

function world(
  options: {
    readonly connected?: boolean;
    readonly blocked?: boolean;
    readonly running?: boolean;
    readonly counterpart?: string;
    /** Rows as communication's readForQ returns them (id, viaQ, envelope). */
    readonly richRows?: boolean;
  } = {},
) {
  const counterpart = options.counterpart ?? "Apex";
  const prepared: unknown[] = [];
  const reads: string[] = [];
  const chat: ChatIntelligencePort = {
    // Only actor B is a party, and only to RELATIONSHIP.
    thread: (actor, relationshipId) => {
      reads.push(`${actor.userId}:${relationshipId}`);
      return Promise.resolve(
        actor.userId === actorB.userId && relationshipId === RELATIONSHIP
          ? {
              connected: options.connected ?? true,
              blocked: options.blocked ?? false,
              counterpartName: counterpart,
              messages: [
                {
                  from: "OTHER_SIDE" as const,
                  senderName: "Ada",
                  kind: "TEXT" as const,
                  text: "Deck attached",
                  attachmentTitle: null,
                  sentAt: "2026-09-27T09:00:00.000Z",
                  ...(options.richRows === true
                    ? {
                        id: "88888888-0000-4000-8000-0000000000m1",
                        viaQ: true,
                        envelope: null,
                      }
                    : {}),
                },
              ],
            }
          : null,
      );
    },
    prepareForApproval: (entry) => {
      prepared.push(entry.proposal);
      return "PREPARED";
    },
    activeErrand: () =>
      Promise.resolve(
        options.running === true
          ? {
              counterpartName: "Apex",
              stage: "CONVERSING",
              lastStep: "Offered three times for the call.",
            }
          : null,
      ),
  };
  // Their own relationships by name: only actor B is a party, to Apex.
  const relationships = {
    ownRelationships: (actor: typeof actorA) =>
      Promise.resolve({
        side: "INVESTOR" as const,
        items:
          actor.userId === actorB.userId
            ? [
                {
                  relationshipId: RELATIONSHIP,
                  counterpart: {
                    kind: "COMPANY",
                    id: OTHER,
                    name: counterpart,
                  },
                  state: "CONNECTED",
                },
              ]
            : [],
      } as never),
  } as never as RelationshipIntelligencePort;
  const schedule: ScheduleIntelligencePort = {
    findSlots: () => Promise.resolve({ status: "UNAVAILABLE" }),
    upcoming: () => Promise.resolve({ meetings: [], reminders: [] }),
    organisedMeeting: () => Promise.resolve(null),
    brief: () => Promise.resolve(null),
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ chat, relationships, schedule })),
    ),
  });
  return { executor, prepared, reads };
}

const base = (actor: typeof actorA) =>
  planFor(actor, "GENERAL_QUESTION", [
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);

describe("list_messages", () => {
  // R1 regression (TensorGate, hosted run 77dbcc69, 2026-10-09): the real
  // port's rows carry id/viaQ/envelope; spreading them failed the strict
  // output with INVALID_TOOL_OUTPUT on every non-empty thread.
  it("reads a thread whose rows carry the port's extra fields", async () => {
    const { executor } = world({ richRows: true });
    const outcome = await executor.execute(
      {
        callId: "c0",
        name: "list_messages",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { messages: [{ from: "OTHER_SIDE", text: "Deck attached" }] },
    });
    const data = outcome.result.ok ? outcome.result.data : null;
    expect(JSON.stringify(data)).not.toContain("envelope");
  });

  it("reads the invoker's own bound thread", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      {
        callId: "c1",
        name: "list_messages",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        open: true,
        counterpartName: "Apex",
        messages: [{ text: "Deck attached" }],
      },
    });
  });

  it("never reads a thread the firewall did not bind for this run", async () => {
    const { executor, reads } = world();
    const outcome = await executor.execute(
      {
        callId: "c2",
        name: "list_messages",
        arguments: { relationshipId: OTHER },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(reads).toEqual([]);
  });

  it("gives a non-party nothing, even with the thread bound", async () => {
    const { executor } = world();
    const outcome = await executor.execute(
      {
        callId: "c3",
        name: "list_messages",
        arguments: { relationshipId: RELATIONSHIP },
      },
      contextFor(actorA, relationshipPlan(base(actorA), RELATIONSHIP)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(JSON.stringify(outcome)).not.toContain("Deck attached");
  });
});

describe("chat proposals", () => {
  it("prepares a message for approval and posts nothing", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      {
        callId: "c4",
        name: "propose_chat_message",
        arguments: {
          relationshipId: RELATIONSHIP,
          body: "Thanks Ada, reading it now.",
        },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([
      {
        actionType: "chat.message.send",
        payload: {
          relationshipId: RELATIONSHIP,
          counterpartName: "Apex",
          body: "Thanks Ada, reading it now.",
        },
      },
    ]);
  });

  it("prepares a message to a connected party named as they said it, from Home (no relationship on screen)", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      {
        callId: "c4n",
        name: "propose_chat_message",
        arguments: { counterpartName: "apex", body: "Shall we talk Tuesday?" },
      },
      contextFor(actorB, base(actorB)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([
      {
        actionType: "chat.message.send",
        payload: {
          relationshipId: RELATIONSHIP,
          counterpartName: "Apex",
          body: "Shall we talk Tuesday?",
        },
      },
    ]);
    // Someone with no relationship of that name gets nothing prepared.
    const stranger = await executor.execute(
      {
        callId: "c4s",
        name: "propose_chat_message",
        arguments: { counterpartName: "Apex", body: "Hi" },
      },
      contextFor(actorA, base(actorA)),
    );
    expect(stranger.result).not.toMatchObject({ data: { status: "PREPARED" } });
    expect(prepared).toHaveLength(1);
  });

  it('"send a message to nixo telling them i am looking forward to the next meeting": a message card for Nixo, from Home', async () => {
    const { executor, prepared } = world({ counterpart: "Nixo" });
    const outcome = await executor.execute(
      {
        callId: "c4f",
        name: "propose_chat_message",
        arguments: {
          counterpartName: "nixo",
          body: "I am looking forward to the next meeting.",
        },
      },
      contextFor(actorB, base(actorB)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toEqual([
      {
        actionType: "chat.message.send",
        payload: {
          relationshipId: RELATIONSHIP,
          counterpartName: "Nixo",
          body: "I am looking forward to the next meeting.",
        },
      },
    ]);
  });

  it("does not prepare a message before the relationship is connected", async () => {
    const { executor, prepared } = world({ connected: false });
    const outcome = await executor.execute(
      {
        callId: "c5",
        name: "propose_chat_message",
        arguments: { relationshipId: RELATIONSHIP, body: "Hello" },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "NOT_CONNECTED" },
    });
    expect(prepared).toEqual([]);
  });

  it("does not prepare a message while messaging is blocked, and reads as not open", async () => {
    const { executor, prepared } = world({ blocked: true });
    const context = contextFor(
      actorB,
      relationshipPlan(base(actorB), RELATIONSHIP),
    );
    const outcome = await executor.execute(
      {
        callId: "c6",
        name: "propose_chat_message",
        arguments: { relationshipId: RELATIONSHIP, body: "Hello" },
      },
      context,
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "BLOCKED",
        awaitingApprovalOf: "You can't message this relationship right now.",
      },
    });
    expect(prepared).toEqual([]);
    const read = await executor.execute(
      {
        callId: "c7",
        name: "list_messages",
        arguments: { relationshipId: RELATIONSHIP },
      },
      context,
    );
    expect(read.result).toMatchObject({ ok: true, data: { open: false } });
  });

  it("prepares a meeting and a reminder as proposals", async () => {
    const { executor, prepared } = world();
    const context = contextFor(
      actorB,
      relationshipPlan(base(actorB), RELATIONSHIP),
    );
    await executor.execute(
      {
        callId: "c6",
        name: "propose_meeting",
        arguments: {
          relationshipId: RELATIONSHIP,
          purpose: "First call",
          startsAt: "2026-10-01T14:00:00.000Z",
          durationMinutes: 30,
        },
      },
      context,
    );
    await executor.execute(
      {
        callId: "c7",
        name: "propose_reminder",
        arguments: {
          relationshipId: RELATIONSHIP,
          title: "Follow up with Apex",
          remindAt: "2026-10-03T09:00:00.000Z",
        },
      },
      context,
    );
    expect(
      prepared.map((p) => (p as { actionType: string }).actionType),
    ).toEqual(["meeting.schedule", "reminder.create"]);
  });
});

describe("propose_errand, one errand per subject (QA 2026-10-01)", () => {
  const errand = {
    callId: "e1",
    name: "propose_errand",
    arguments: {
      relationshipId: RELATIONSHIP,
      callPurpose: "Introductory call",
    },
  };

  it("prepares a card when nothing is running for them", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      errand,
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "PREPARED" },
    });
    expect(prepared).toHaveLength(1);
  });

  it("prepares no second card, and says what Q is already doing and where it stands", async () => {
    const { executor, prepared } = world({ running: true });
    const outcome = await executor.execute(
      errand,
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        status: "ALREADY_ACTIVE",
        awaitingApprovalOf:
          "Q is already looking after Apex for you (in the chat with them): Offered three times for the call.",
      },
    });
    expect(prepared).toEqual([]);
  });
});

describe("propose_errand honours the time they asked for, or says why not (live 2026-10-02, Zino)", () => {
  // "book a meeting with Nixon the next five minutes"
  it("'in the next five minutes': the window rides on the plan, and the card says why it can't be kept", async () => {
    const { executor, prepared } = world();
    const before = Date.now();
    const outcome = await executor.execute(
      {
        callId: "e2",
        name: "propose_errand",
        arguments: {
          relationshipId: RELATIONSHIP,
          callPurpose: "Meeting",
          callWindow: { fromMinutes: 0, toMinutes: 5 },
        },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    const data = (outcome.result as { data: { awaitingApprovalOf: string } })
      .data;
    expect(data.awaitingApprovalOf).toBe(
      "Q looks after Apex for you; I can't book the call within 5 minutes: Q books a call at least 18 hours ahead, after they accept, so nobody is surprised, and it will take the first free time after that",
    );
    const plan = (
      prepared[0] as {
        payload: { bookCall: { notBefore: string; notAfter: string } };
      }
    ).payload.bookCall;
    expect(Date.parse(plan.notBefore)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(plan.notAfter) - Date.parse(plan.notBefore)).toBe(
      5 * 60_000,
    );
  });

  it("a window it can keep is carried with no note", async () => {
    const { executor, prepared } = world();
    const outcome = await executor.execute(
      {
        callId: "e3",
        name: "propose_errand",
        arguments: {
          relationshipId: RELATIONSHIP,
          callPurpose: "Meeting",
          callWindow: { fromMinutes: 2 * 24 * 60, toMinutes: 3 * 24 * 60 },
        },
      },
      contextFor(actorB, relationshipPlan(base(actorB), RELATIONSHIP)),
    );
    expect(
      (outcome.result as { data: { awaitingApprovalOf: string } }).data
        .awaitingApprovalOf,
    ).toBe("Q looks after Apex for you");
    expect(
      (prepared[0] as { payload: { bookCall: { notBefore?: string } } }).payload
        .bookCall.notBefore,
    ).toBeDefined();
  });
});
