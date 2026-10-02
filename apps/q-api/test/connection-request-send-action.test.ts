import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createConnectionRequestSendAction,
  RELATIONSHIP_CONNECTION_REQUEST_SEND,
  type ConnectionRequestSendPayload,
} from "../src/composition/connection-request-send-action.js";

/**
 * A founder's Connection Request, prepared by Q and sent on approval
 * (action parity 2026-10-02). Authorised by the investor page's own check
 * as the approver; sent once through the page's own command, idempotent
 * on the action's key.
 */

const INVESTOR = "00000000-0000-4000-8000-0000000000a1";
const INTEREST = "00000000-0000-4000-8000-0000000000d1";
const actor = ActorContextSchema.parse({
  actorType: "HUMAN",
  tenantId: "00000000-0000-4000-8000-00000000000a",
  userId: "00000000-0000-4000-8000-0000000000b1",
  organisationId: "00000000-0000-4000-8000-0000000000b2",
  membershipId: "00000000-0000-4000-8000-0000000000b3",
});

const payload: ConnectionRequestSendPayload = {
  investorOrganisationId: INVESTOR,
  investorName: "Kazikit Capital",
};

function world(options: { canRequest?: boolean; refuse?: boolean } = {}) {
  const keys: string[] = [];
  const connections = {
    connectionStatus: () =>
      Promise.resolve({
        canRequest: options.canRequest ?? true,
        notAccepted: null,
        request: null,
      }),
    requestConnection: (command: { idempotencyKey: string }) => {
      if (options.refuse === true) {
        return Promise.reject(new Error("not reachable"));
      }
      const repeat = keys.includes(command.idempotencyKey);
      keys.push(command.idempotencyKey);
      return Promise.resolve({
        interest: { id: INTEREST },
        deduplicated: repeat,
      });
    },
  };
  return {
    action: createConnectionRequestSendAction({
      connections: connections as never,
    }),
    keys,
  };
}

const approved = {
  actionId: "00000000-0000-4000-8000-0000000000e1",
  runId: "00000000-0000-4000-8000-0000000000e2",
  tenantId: actor.tenantId,
  organisationId: actor.organisationId,
  actionType: RELATIONSHIP_CONNECTION_REQUEST_SEND,
  payload,
  idempotencyKey: "q_action:r:a",
};
const context = {
  approver: actor,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
};

describe("relationship.connection_request.send", () => {
  it("names the investor on the card", () => {
    const { action } = world();
    expect(action.describe(payload, action.targets(payload)).summary).toBe(
      "Send Kazikit Capital a Connection Request",
    );
  });

  it("is allowed only where the page's own check allows a request", async () => {
    expect(await world().action.authorize(payload, actor)).toEqual({
      outcome: "ALLOW",
    });
    expect(
      await world({ canRequest: false }).action.authorize(payload, actor),
    ).toMatchObject({ outcome: "DENY" });
  });

  it("sends once on the action's key; a retry sends nothing new", async () => {
    const { action, keys } = world();
    const first = await action.executor.execute(approved as never, context);
    expect(first).toEqual({
      outcome: "EXECUTED",
      result: { interestId: INTEREST, alreadySent: false },
    });
    const again = await action.executor.execute(approved as never, {
      ...context,
      attempt: 2,
    });
    expect(again).toMatchObject({ result: { alreadySent: true } });
    expect(new Set(keys)).toEqual(new Set(["q-action:q_action:r:a"]));
  });

  it("reports a refusal as a failure, never as sent", async () => {
    const outcome = await world({ refuse: true }).action.executor.execute(
      approved as never,
      context,
    );
    expect(outcome).toMatchObject({
      outcome: "FAILED",
      failureCode: "CONNECTION_REQUEST_REFUSED",
    });
  });
});
