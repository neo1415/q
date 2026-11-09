import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import { documentReadyEvent } from "@capital-q/evidence/events";
import { relationshipInterestExpressedEvent } from "@capital-q/network/events";

import {
  readyDocumentOf,
  withDocumentReadyWake,
} from "../src/network/document-ready-wake-handler.js";
import type { QueueMessage } from "../src/queue/pgmq.js";
import type { MessageOutcome } from "../src/queue/runner.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * D82: a document that finished reading is announced to the Q API (its id
 * only), after the event is handled, so a turn answered "I'm reading it
 * now" is answered properly. Nothing else announces; a failed
 * announcement never holds the event back.
 */

const DOCUMENT = "d0000000-0000-4000-8000-0000000000a1";
const cor = (): CorrelationId => `cor_${randomUUID()}`;
const message = (event: unknown): QueueMessage => ({
  msgId: 1,
  readCount: 1,
  enqueuedAt: new Date().toISOString(),
  message: event,
});

const ready = () =>
  documentReadyEvent(
    {
      tenantId: TENANT_A,
      organisationId: "a0000000-0000-4000-8000-000000000009",
      correlationId: cor(),
    },
    {
      documentId: DOCUMENT,
      documentVersionId: "e0000000-0000-4000-8000-0000000000a1",
      processingRunId: "f0000000-0000-4000-8000-0000000000a1",
      pipelineVersion: "docs-v1",
    },
  );

function harness(fail = false) {
  const notified: { channel: string; payload: string }[] = [];
  const order: string[] = [];
  const handle = withDocumentReadyWake(
    (): Promise<MessageOutcome> => {
      order.push("handled");
      return Promise.resolve({ kind: "DONE" });
    },
    {
      channel: "q_document_ready_wake",
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

describe("withDocumentReadyWake (D82)", () => {
  it("announces a ready document's id, after the event is handled", async () => {
    const h = harness();
    expect(await h.handle(message(ready()))).toEqual({ kind: "DONE" });
    expect(h.order).toEqual(["handled", "announced"]);
    expect(h.notified).toEqual([
      { channel: "q_document_ready_wake", payload: DOCUMENT },
    ]);
  });

  it("any other event announces nothing", async () => {
    const h = harness();
    await h.handle(
      message(
        relationshipInterestExpressedEvent({
          tenantId: TENANT_A,
          organisationId: "d0000000-0000-4000-8000-000000000001",
          actorUserId: "b0000000-0000-4000-8000-000000000001",
          relationshipId: "88888888-0000-4000-8000-000000000001",
          companyId: "a0000000-0000-4000-8000-000000000001",
          investorOrganisationId: "c0000000-0000-4000-8000-000000000001",
          correlationId: cor(),
        } as never),
      ),
    );
    expect(h.notified).toEqual([]);
    expect(readyDocumentOf({ type: "evidence.document.ready" })).toBeNull();
  });

  it("a failed announcement never holds the event back", async () => {
    const h = harness(true);
    expect(await h.handle(message(ready()))).toEqual({ kind: "DONE" });
  });
});
