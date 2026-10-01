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
  } = {},
) {
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
              counterpartName: "Apex",
              messages: [
                {
                  from: "OTHER_SIDE" as const,
                  senderName: "Ada",
                  kind: "TEXT" as const,
                  text: "Deck attached",
                  attachmentTitle: null,
                  sentAt: "2026-09-27T09:00:00.000Z",
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
  const relationships = {} as RelationshipIntelligencePort;
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
