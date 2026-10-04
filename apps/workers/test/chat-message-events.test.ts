import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  NETWORK_EVENTS,
  relationshipInterestExpressedEvent,
  relationshipMessageSentEvent,
} from "@capital-q/network/events";

import { withChatMessageEvents } from "../src/network/chat-message-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * QA run 8a1d57b9: a chat message wakes the standing instructions covering
 * its relationship at once (it waited for a 240-minute cadence). Other
 * events pass through untouched; a failed announcement retries.
 */

const registry = createEventRegistry([...NETWORK_EVENTS]);
const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";
const cor = (): CorrelationId => `cor_${randomUUID()}`;
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});
const sent = () =>
  relationshipMessageSentEvent({
    tenantId: TENANT_A,
    senderUserId: "b0000000-0000-4000-8000-000000000001",
    correlationId: cor(),
    relationshipId: RELATIONSHIP,
    conversationId: "99999999-0000-4000-8000-000000000001",
    messageId: "66666666-0000-4000-8000-000000000001",
    senderSide: "COMPANY",
  });

function harness(fail = false, noticeFails = false) {
  const notified: { channel: string; payload: string }[] = [];
  const told: {
    relationshipId: string;
    conversationId: string;
    senderSide: string;
    at: Date;
  }[] = [];
  const passed: unknown[] = [];
  const handle = withChatMessageEvents(
    (inner): Promise<MessageOutcome> => {
      passed.push(inner.message);
      return Promise.resolve({ kind: "DONE" });
    },
    {
      registry,
      channel: "q_instruction_wake",
      notify: (channel, payload) => {
        if (fail) return Promise.reject(new Error("connection lost"));
        notified.push({ channel, payload });
        return Promise.resolve();
      },
      notices: {
        notify: (input) => {
          if (noticeFails) return Promise.reject(new Error("db down"));
          told.push(input);
          return Promise.resolve(1);
        },
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, notified, passed, told };
}

describe("a chat message wakes standing instructions", () => {
  it("announces the relationship id (never the words) on the instruction channel, then passes on", async () => {
    const { handle, notified, passed } = harness();
    const event = sent();
    expect(await handle(message(event))).toEqual({ kind: "DONE" });
    expect(notified).toEqual([
      { channel: "q_instruction_wake", payload: RELATIONSHIP },
    ]);
    expect(passed).toEqual([event]);
  });

  it("tells the other side, per conversation, at the message's own time (replay-safe)", async () => {
    const { handle, told } = harness();
    const event = sent();
    await handle(message(event));
    expect(told).toEqual([
      {
        relationshipId: RELATIONSHIP,
        conversationId: "99999999-0000-4000-8000-000000000001",
        senderSide: "COMPANY",
        at: new Date(event.time),
      },
    ]);
  });

  it("retries when the notice cannot be written", async () => {
    const { handle, notified } = harness(false, true);
    expect((await handle(message(sent()))).kind).toBe("RETRY");
    expect(notified).toEqual([]);
  });

  it("leaves other events alone", async () => {
    const { handle, notified, told } = harness();
    await handle(
      message(
        relationshipInterestExpressedEvent({
          tenantId: TENANT_A,
          organisationId: "d0000000-0000-4000-8000-000000000001",
          actorUserId: "b0000000-0000-4000-8000-000000000001",
          correlationId: cor(),
          relationshipId: RELATIONSHIP,
          interestId: "77777777-0000-4000-8000-000000000001",
          companyId: "a0000000-0000-4000-8000-000000000001",
          investorOrganisationId: "11111111-0000-4000-8000-000000000013",
        }),
      ),
    );
    expect(notified).toEqual([]);
    expect(told).toEqual([]);
  });

  it("retries when the announcement fails", async () => {
    const { handle, passed } = harness(true);
    expect(await handle(message(sent()))).toEqual({
      kind: "RETRY",
      errorCode: "INSTRUCTION_WAKE_FAILED",
    });
    expect(passed).toEqual([]);
  });
});
