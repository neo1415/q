import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import { APP_ACTIONS, type AppActionPorts } from "../src/index.js";

/**
 * Recovery D-07 (audit): what Q sends in the person's chat is marked as
 * Q's -- an approved card by its action id, a delegated or instruction
 * send by the delegation it acted under -- so the counterpart sees "sent
 * by Q". The person's own send from the chat screen is never marked.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});

function sendAction() {
  const action = APP_ACTIONS.find((one) => one.name === "chat.message.send");
  if (action === undefined) throw new Error("no chat.message.send");
  return action;
}

function capture() {
  const calls: Record<string, unknown>[] = [];
  const ports = {
    chat: {
      send: (input: Record<string, unknown>) => {
        calls.push(input);
        return Promise.resolve({ message: {}, deduplicated: false });
      },
    },
  } as unknown as AppActionPorts;
  return { calls, ports };
}

const input = {
  relationshipId: randomUUID(),
  idempotencyKey: "via-q-key-0001",
  input: { kind: "TEXT", body: "Thanks, Zino." },
};

const context = (extra: Record<string, unknown>) => ({
  actor,
  idempotencyKey: "via-q-key-0001",
  correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
  ...extra,
});

describe("chat.message.send marks Q's sends (recovery D-07)", () => {
  it("carries the approved card's action id when Q sends", async () => {
    const { calls, ports } = capture();
    const qActionId = randomUUID();
    await sendAction().run(
      ports,
      context({ surface: "Q", qActionId }) as never,
      input,
    );
    expect(calls[0]).toMatchObject({ qActionId });
    expect(calls[0]?.["qDelegationId"]).toBeUndefined();
  });

  it("carries the delegation when Q acts under one", async () => {
    const { calls, ports } = capture();
    const qDelegationId = randomUUID();
    await sendAction().run(
      ports,
      context({ surface: "Q", qDelegationId }) as never,
      input,
    );
    expect(calls[0]).toMatchObject({ qDelegationId });
  });

  it("never marks the person's own send from the screen", async () => {
    const { calls, ports } = capture();
    await sendAction().run(
      ports,
      context({
        surface: "SCREEN",
        qActionId: randomUUID(),
        qDelegationId: randomUUID(),
      }) as never,
      input,
    );
    expect(calls[0]?.["qActionId"]).toBeUndefined();
    expect(calls[0]?.["qDelegationId"]).toBeUndefined();
  });
});
