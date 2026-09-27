import { describe, expect, it } from "vitest";

import { createChatService } from "@capital-q/communication";
import { createInMemoryChatStore } from "@capital-q/communication/testing";
import type { ActorContext } from "@capital-q/security";

import {
  CHAT_MESSAGE_SEND,
  createChatActionBoard,
  createChatMessageSendAction,
  createMeetingProposeAction,
  createReminderCreateAction,
  MEETING_PROPOSE,
  type ChatMessageSendPayload,
} from "../src/composition/chat-actions.js";

/**
 * R34 chat actions: a chat message posts once, as the approver, only for a
 * party on a connected relationship; reminders and meetings are approvable
 * proposals whose execution says NOT_CONFIGURED until Calendar exists.
 */

const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const actor = {
  actorType: "HUMAN",
  tenantId: "00000000-0000-4000-8000-00000000000a",
  userId: "00000000-0000-4000-8000-0000000000b1",
  organisationId: "00000000-0000-4000-8000-0000000000b2",
} as unknown as ActorContext;
const stranger = {
  ...actor,
  userId: "00000000-0000-4000-8000-0000000000b9",
  organisationId: "00000000-0000-4000-8000-0000000000b8",
} as unknown as ActorContext;

function world(options: { connected?: boolean } = {}) {
  const store = createInMemoryChatStore();
  const chat = createChatService({
    store,
    parties: (who, relationshipId) =>
      Promise.resolve(
        who.organisationId === actor.organisationId &&
          relationshipId === RELATIONSHIP
          ? { side: "INVESTOR" as const, connected: options.connected ?? true }
          : null,
      ),
    documents: () => Promise.resolve({ outcome: "NOT_FOUND" as const }),
    newCorrelationId: () => "cor_00000000-0000-4000-8000-000000000001",
  });
  return { store, chat, action: createChatMessageSendAction({ chat }) };
}

const payload: ChatMessageSendPayload = {
  relationshipId: RELATIONSHIP,
  counterpartName: "Apex",
  body: "Thanks, reading the deck now.",
};

const approved = (idempotencyKey: string, body = payload) => ({
  actionId: "00000000-0000-4000-8000-0000000000e1",
  runId: "00000000-0000-4000-8000-0000000000e2",
  tenantId: actor.tenantId,
  organisationId: actor.organisationId,
  actionType: CHAT_MESSAGE_SEND,
  payload: body,
  idempotencyKey,
});
const context = {
  approver: actor,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
};

describe("chat.message.send", () => {
  it("authorises only a party on a connected relationship", async () => {
    const { action } = world();
    expect(await action.authorize(payload, actor)).toEqual({ outcome: "ALLOW" });
    expect(await action.authorize(payload, stranger)).toMatchObject({ outcome: "DENY", code: "NOT_A_PARTY" });
    expect(
      await action.authorize(payload, { ...actor, actorType: "Q" } as unknown as ActorContext),
    ).toMatchObject({ outcome: "DENY" });
    const early = world({ connected: false });
    expect(await early.action.authorize(payload, actor)).toMatchObject({ outcome: "DENY", code: "NOT_CONNECTED" });
  });

  it("posts once per execution identity, as the approver, marked as via Q", async () => {
    const { action, store } = world();
    const first = await action.executor.execute(approved("q_action:r:a") as never, context as never);
    const second = await action.executor.execute(approved("q_action:r:a") as never, { ...context, attempt: 2 } as never);
    expect(first).toMatchObject({ outcome: "EXECUTED", result: { alreadySent: false } });
    expect(second).toMatchObject({ outcome: "EXECUTED", result: { alreadySent: true } });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ senderUserId: actor.userId, qActionId: "00000000-0000-4000-8000-0000000000e1" });
  });

  it("fails without posting for someone who is no longer a party", async () => {
    const { action, store } = world();
    const outcome = await action.executor.execute(approved("q_action:r:b") as never, { ...context, approver: stranger } as never);
    expect(outcome).toMatchObject({ outcome: "FAILED", failureCode: "NOT_A_PARTY", retryable: false });
    expect(store.rows).toHaveLength(0);
  });
});

describe("reminders and meetings before Calendar", () => {
  it("are approvable proposals that report NOT_CONFIGURED when executed", async () => {
    const { chat } = world();
    const meeting = createMeetingProposeAction({ chat });
    const reminder = createReminderCreateAction({ chat });
    const meetingPayload = {
      relationshipId: RELATIONSHIP,
      counterpartName: "Apex",
      purpose: "First call",
      proposedStarts: ["2026-10-01T14:00:00.000Z"],
      durationMinutes: 30,
    };
    expect(await meeting.authorize(meetingPayload, actor)).toEqual({ outcome: "ALLOW" });
    expect(await meeting.authorize(meetingPayload, stranger)).toMatchObject({ outcome: "DENY" });
    expect(
      await meeting.executor.execute({ ...approved("q_action:m:a"), actionType: MEETING_PROPOSE, payload: meetingPayload } as never, context as never),
    ).toEqual({ outcome: "FAILED", failureCode: "NOT_CONFIGURED", retryable: false });
    expect(meeting.describe(meetingPayload, meeting.targets(meetingPayload)).summary).toBe("Meeting with Apex");
    expect(
      await reminder.authorize(
        { relationshipId: RELATIONSHIP, counterpartName: "Apex", title: "Follow up", remindAt: "2026-10-03T09:00:00.000Z" },
        actor,
      ),
    ).toEqual({ outcome: "ALLOW" });
  });
});

describe("the chat board", () => {
  it("hands the proposal to the run's own person only, validated", async () => {
    const board = createChatActionBoard();
    const proposal = { actionType: "chat.message.send" as const, payload };
    board.prepareForApproval({ runId: "run-1", tenantId: actor.tenantId, actorUserId: actor.userId, proposal });
    const contextFor = (who: ActorContext) =>
      ({ runId: "run-1", actor: who }) as unknown as Parameters<typeof board.proposer.propose>[0];
    expect(await board.proposer.propose(contextFor(stranger))).toBeNull();
    board.prepareForApproval({ runId: "run-1", tenantId: actor.tenantId, actorUserId: actor.userId, proposal });
    expect(await board.proposer.propose(contextFor(actor))).toEqual({ actionType: CHAT_MESSAGE_SEND, payload });
    expect(
      board.prepareForApproval({ runId: "run-2", tenantId: actor.tenantId, actorUserId: actor.userId, proposal }),
    ).toBe("PREPARED");
    expect(
      board.prepareForApproval({
        runId: "run-2",
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        proposal: { ...proposal, payload: { ...payload, body: "different" } },
      }),
    ).toBe("ONE_PER_TURN");
  });
});
