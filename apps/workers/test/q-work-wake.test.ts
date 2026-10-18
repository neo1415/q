import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  interestAnsweredEvent,
  NETWORK_EVENTS,
  relationshipInterestExpressedEvent,
} from "@capital-q/network/events";

import { withQWorkWake } from "../src/network/q-work-wake-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * Founder direction 2026-10-01: acceptance (or a decline) announces the
 * relationship on the wake channel, so Q's waiting work continues at once.
 * Everything else passes through untouched; a failed announcement retries.
 */

const registry = createEventRegistry([...NETWORK_EVENTS]);
const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";
const cor = (): CorrelationId => `cor_${randomUUID()}`;
const envelope = {
  tenantId: TENANT_A,
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorUserId: "b0000000-0000-4000-8000-000000000001",
  relationshipId: RELATIONSHIP,
  companyId: "a0000000-0000-4000-8000-000000000001",
  investorOrganisationId: "11111111-0000-4000-8000-000000000013",
};
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});
const answered = (decision: "ACCEPTED" | "DECLINED") =>
  interestAnsweredEvent({
    ...envelope,
    correlationId: cor(),
    decision,
    interestId: "77777777-0000-4000-8000-000000000001",
    matchId:
      decision === "ACCEPTED" ? "55555555-0000-4000-8000-000000000001" : null,
  });

function harness(fail = false) {
  const notified: { channel: string; payload: string }[] = [];
  const passed: unknown[] = [];
  const handle = withQWorkWake(
    (inner): Promise<MessageOutcome> => {
      passed.push(inner.message);
      return Promise.resolve({ kind: "DONE" });
    },
    {
      registry,
      channel: "q_work_wake",
      notify: (channel, payload) => {
        if (fail) return Promise.reject(new Error("db down"));
        notified.push({ channel, payload });
        return Promise.resolve();
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, notified, passed };
}

describe("withQWorkWake", () => {
  it("announces an acceptance and a decline, then passes the message on", async () => {
    const h = harness();
    await h.handle(message(answered("ACCEPTED")));
    await h.handle(message(answered("DECLINED")));
    expect(h.notified).toEqual([
      { channel: "q_work_wake", payload: RELATIONSHIP },
      { channel: "q_work_wake", payload: RELATIONSHIP },
    ]);
    expect(h.passed).toHaveLength(2);
  });

  it("does not announce an interest merely expressed, or anything unreadable", async () => {
    const h = harness();
    await h.handle(
      message(
        relationshipInterestExpressedEvent({
          ...envelope,
          correlationId: cor(),
          interestId: "77777777-0000-4000-8000-000000000001",
        }),
      ),
    );
    await h.handle(message({ type: "not.an.event" }));
    expect(h.notified).toEqual([]);
    expect(h.passed).toHaveLength(2);
  });

  it("retries when the announcement cannot be made", async () => {
    const h = harness(true);
    expect(await h.handle(message(answered("ACCEPTED")))).toEqual({
      kind: "RETRY",
      errorCode: "Q_WORK_WAKE_FAILED",
    });
    expect(h.passed).toHaveLength(0);
  });
});
