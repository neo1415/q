import { describe, expect, it } from "vitest";

import { createChatService } from "@capital-q/communication";
import { createInMemoryChatStore } from "@capital-q/communication/testing";
import type { ActorContext } from "@capital-q/security";

import {
  ConnectionRequestAnswerPayloadSchema,
  createConnectionRequestAnswerAction,
  RELATIONSHIP_CONNECTION_REQUEST_RESPOND,
  type ConnectionRequestAnswerPayload,
} from "../src/composition/connection-request-answer-action.js";

/**
 * An investor's answer to a founder's Connection Request with Q's opening
 * message, as ONE approval (live 2026-10-02, Zino). The answer is bound to
 * the interest in the approver's own inbox; the message posts once, as the
 * approver, only after the acceptance; a failed message is reported, never
 * hidden, and the connection stands.
 */

const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const INTEREST = "00000000-0000-4000-8000-0000000000d1";
const COMPANY = "00000000-0000-4000-8000-0000000000f1";
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

const payload: ConnectionRequestAnswerPayload = {
  interestId: INTEREST,
  companyId: COMPANY,
  relationshipId: RELATIONSHIP,
  companyName: "Kazikit",
  decision: "ACCEPTED",
  openingMessage: "Hi Kazikit team, glad to connect. Can we talk this week?",
};

function world(options: { refuse?: boolean } = {}) {
  let connected = false;
  const answers: string[] = [];
  const store = createInMemoryChatStore();
  const chat = createChatService({
    store,
    parties: (who, relationshipId) =>
      Promise.resolve(
        who.organisationId === actor.organisationId &&
          relationshipId === RELATIONSHIP
          ? { side: "INVESTOR" as const, connected }
          : null,
      ),
    documents: () => Promise.resolve({ outcome: "NOT_FOUND" as const }),
    newCorrelationId: () => "cor_00000000-0000-4000-8000-000000000001",
  });
  const connections = {
    listConnectionRequests: ({ actor: who }: { actor: ActorContext }) =>
      who.organisationId === actor.organisationId
        ? Promise.resolve([
            {
              interest: {
                id: INTEREST,
                companyId: COMPANY,
                relationshipId: RELATIONSHIP,
              },
              company: { canonicalName: "Kazikit" },
            },
          ] as never)
        : Promise.reject(new Error("not this investor")),
    respondToConnectionRequest: (command: {
      idempotencyKey: string;
      decision: string;
    }) => {
      if (options.refuse === true) {
        return Promise.reject(new Error("already answered otherwise"));
      }
      const repeat = answers.includes(command.idempotencyKey);
      answers.push(command.idempotencyKey);
      if (command.decision === "ACCEPTED") connected = true;
      return Promise.resolve({ deduplicated: repeat } as never);
    },
  };
  return {
    store,
    answers,
    action: createConnectionRequestAnswerAction({ connections, chat }),
    disconnect: () => {
      connected = false;
    },
  };
}

const approved = (body = payload) => ({
  actionId: "00000000-0000-4000-8000-0000000000e1",
  runId: "00000000-0000-4000-8000-0000000000e2",
  tenantId: actor.tenantId,
  organisationId: actor.organisationId,
  actionType: RELATIONSHIP_CONNECTION_REQUEST_RESPOND,
  payload: body,
  idempotencyKey: "q_action:r:a",
});
const context = {
  approver: actor,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
};

describe("relationship.connection_request.respond", () => {
  it("is one approval naming both steps, with the message word for word", () => {
    const { action } = world();
    const described = action.describe(payload);
    expect(described.summary).toBe(
      "Accept Kazikit's connection request and send them your message",
    );
    expect(described.preview).toContain(payload.openingMessage);
  });

  it("authorises only the request in the approver's own inbox", async () => {
    const { action } = world();
    expect(await action.authorize(payload, actor)).toEqual({
      outcome: "ALLOW",
    });
    expect(await action.authorize(payload, stranger)).toMatchObject({
      outcome: "DENY",
    });
    expect(
      await action.authorize(
        { ...payload, relationshipId: "00000000-0000-4000-8000-0000000000c9" },
        actor,
      ),
    ).toMatchObject({ outcome: "DENY" });
  });

  it("accepts, then posts the message once as the approver; a retry answers and posts nothing new", async () => {
    const { action, store } = world();
    const first = await action.executor.execute(approved() as never, context);
    expect(first).toMatchObject({
      outcome: "EXECUTED",
      result: {
        alreadyAnswered: false,
        messageSent: true,
        messageFailure: null,
      },
    });
    const again = await action.executor.execute(approved() as never, {
      ...context,
      attempt: 2,
    });
    expect(again).toMatchObject({
      outcome: "EXECUTED",
      result: { alreadyAnswered: true, messageSent: true },
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ body: payload.openingMessage });
  });

  it("says why when the message could not be posted; the acceptance stands", async () => {
    const { action, store } = world();
    const chatFails = createConnectionRequestAnswerAction({
      connections: {
        listConnectionRequests: () => Promise.resolve([]),
        respondToConnectionRequest: () =>
          Promise.resolve({ deduplicated: false } as never),
      },
      chat: { send: () => Promise.reject(new Error("not connected")) },
    });
    const outcome = await chatFails.executor.execute(
      approved() as never,
      context,
    );
    expect(outcome).toMatchObject({
      outcome: "EXECUTED",
      result: { messageSent: false, messageFailure: "Error" },
    });
    expect(
      chatFails.confirm(payload, {
        interestId: INTEREST,
        decision: "ACCEPTED",
        alreadyAnswered: false,
        messageSent: false,
        messageFailure: "ChatNotConnectedError",
      }),
    ).toBe(
      "You and Kazikit are connected, but the message wasn't sent (ChatNotConnectedError). I can send it again.",
    );
    expect(action).toBeTruthy();
    expect(store.rows).toHaveLength(0);
  });

  it("a refused answer fails with its reason and sends nothing", async () => {
    const { action, store } = world({ refuse: true });
    expect(
      await action.executor.execute(approved() as never, context),
    ).toMatchObject({
      outcome: "FAILED",
      failureCode: "CONNECTION_ANSWER_REFUSED",
    });
    expect(store.rows).toHaveLength(0);
  });

  it("a declined request can carry no message", () => {
    expect(
      ConnectionRequestAnswerPayloadSchema.safeParse({
        ...payload,
        decision: "DECLINED",
      }).success,
    ).toBe(false);
  });
});
