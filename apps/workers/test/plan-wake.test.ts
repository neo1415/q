import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import { relationshipInterestExpressedEvent } from "@capital-q/network/events";

import { withPlanWake } from "../src/network/plan-wake-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * Situation-first planning S6 (addendum 2): ANY domain event of a tenant
 * wakes its open plans' conditions -- no per-feature watchers. Only the
 * tenant id travels; the event is handled first; a failed announcement
 * never holds the event back.
 */

const cor = (): CorrelationId => `cor_${randomUUID()}`;
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});

function harness(fail = false) {
  const notified: { channel: string; payload: string }[] = [];
  const order: string[] = [];
  const handle = withPlanWake(
    (): Promise<MessageOutcome> => {
      order.push("handled");
      return Promise.resolve({ kind: "DONE" });
    },
    {
      channel: "q_plan_wake",
      notify: (channel, payload) => {
        order.push("announced");
        if (fail) return Promise.reject(new Error("db down"));
        notified.push({ channel, payload });
        return Promise.resolve();
      },
      logger: createRecordingLogger(),
    },
  );
  return { handle, notified, order };
}

describe("withPlanWake", () => {
  it("announces the tenant of any event, after the event is handled", async () => {
    const h = harness();
    await h.handle(
      message(
        relationshipInterestExpressedEvent({
          tenantId: TENANT_A,
          organisationId: "d0000000-0000-4000-8000-000000000001",
          actorUserId: "b0000000-0000-4000-8000-000000000001",
          relationshipId: "88888888-0000-4000-8000-000000000001",
          companyId: "a0000000-0000-4000-8000-000000000001",
          investorOrganisationId: "11111111-0000-4000-8000-000000000013",
          correlationId: cor(),
          interestId: "77777777-0000-4000-8000-000000000001",
        }),
      ),
    );
    // An event no worker handler knows (a figure recorded, a board task
    // ticked): the envelope alone is enough to wake the tenant's plans.
    await h.handle(
      message({
        specVersion: "1.0",
        id: randomUUID(),
        type: "capital.commitment.amount_confirmed",
        source: "capitalq://api",
        time: new Date().toISOString(),
        dataContentType: "application/json",
        eventVersion: 1,
        tenantId: TENANT_A,
        data: { anything: true },
      }),
    );
    expect(h.notified).toEqual([
      { channel: "q_plan_wake", payload: TENANT_A },
      { channel: "q_plan_wake", payload: TENANT_A },
    ]);
    expect(h.order).toEqual(["handled", "announced", "handled", "announced"]);
  });

  it("announces nothing for an event without a tenant, and never holds an event back", async () => {
    const h = harness(true);
    expect(await h.handle(message({ type: "not.an.event" }))).toEqual({
      kind: "DONE",
    });
    expect(
      await h.handle(
        message({
          specVersion: "1.0",
          id: randomUUID(),
          type: "billing.plan.changed",
          source: "capitalq://api",
          time: new Date().toISOString(),
          dataContentType: "application/json",
          eventVersion: 1,
          tenantId: TENANT_A,
          data: {},
        }),
      ),
    ).toEqual({ kind: "DONE" });
    expect(h.notified).toEqual([]);
  });
});
