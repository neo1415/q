import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import { EVIDENCE_EVENTS } from "@capital-q/evidence/events";

import { createDomainEventHandler } from "../src/events/document-processing-handler.js";
import type { QueueClient, QueueMessage } from "../src/queue/pgmq.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * The step where a fact becomes an instruction.
 *
 * The event says a version exists; the job asks a worker to process it. What
 * matters here is that the job carries only identifiers, keeps the causal
 * chain, and that an event this build cannot use is kept as history rather
 * than discarded.
 */

const PIPELINE_VERSION = "evidence-processing-v1";
const registry = createEventRegistry([...EVIDENCE_EVENTS]);

function collectingQueues(): {
  readonly client: QueueClient;
  readonly sent: { queue: string; message: unknown }[];
} {
  const sent: { queue: string; message: unknown }[] = [];
  return {
    sent,
    client: {
      send: (queue, message) => {
        sent.push({ queue, message });
        return Promise.resolve(1);
      },
      read: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      archive: () => Promise.resolve(),
      delayVisibility: () => Promise.resolve(),
    },
  };
}

function versionCreated(overrides: Record<string, unknown> = {}): QueueMessage {
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  return {
    msgId: 5,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      specVersion: "1.0",
      id: randomUUID(),
      type: "evidence.document.version_created",
      source: "capitalq://api/evidence",
      time: new Date().toISOString(),
      subject: `document/${documentId}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: TENANT_A,
      organisationId: randomUUID(),
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "document", id: documentId, version: 2 },
      data: {
        documentId,
        documentVersionId,
        versionNumber: 1,
        supersedesVersionId: null,
      },
      ...overrides,
    },
  };
}

describe("domain event handler", () => {
  it("turns a version-created event into a process job", async () => {
    const queues = collectingQueues();
    const handle = createDomainEventHandler({
      registry,
      queues: queues.client,
      pipelineVersion: PIPELINE_VERSION,
      logger: createRecordingLogger(),
    });
    const message = versionCreated();

    const outcome = await handle(message);

    expect(outcome).toEqual({ kind: "ARCHIVE" });
    expect(queues.sent).toHaveLength(1);
    const job = queues.sent[0]?.message as Record<string, unknown>;
    expect(queues.sent[0]?.queue).toBe("documents");
    expect(job).toMatchObject({
      type: "evidence.document.process",
      jobVersion: 1,
      tenantId: TENANT_A,
      data: { pipelineVersion: PIPELINE_VERSION },
    });
    // The chain stays traceable back to the event that caused the work.
    expect(String(job.causationId)).toMatch(/^cau_/);
    // Identifiers only: no filename, no storage key, no title.
    expect(Object.keys(job.data as object).sort()).toEqual([
      "documentVersionId",
      "pipelineVersion",
    ]);
  });

  it("keeps an event it has no handler for", async () => {
    const queues = collectingQueues();
    const handle = createDomainEventHandler({
      registry,
      queues: queues.client,
      pipelineVersion: PIPELINE_VERSION,
      logger: createRecordingLogger(),
    });

    const outcome = await handle(
      versionCreated({
        type: "evidence.claim.created",
        eventVersion: 1,
        data: {
          claimId: randomUUID(),
          subjectType: "COMPANY",
          subjectId: randomUUID(),
          claimType: "revenue",
          claimKey: "revenue.arr",
          changeKind: "CREATED",
          revisionNumber: 1,
        },
      }),
    );

    expect(outcome).toEqual({ kind: "ARCHIVE" });
    expect(queues.sent).toEqual([]);
  });

  it("keeps, rather than acts on, an event it cannot validate", async () => {
    const queues = collectingQueues();
    const logger = createRecordingLogger();
    const handle = createDomainEventHandler({
      registry,
      queues: queues.client,
      pipelineVersion: PIPELINE_VERSION,
      logger,
    });

    const outcome = await handle({
      msgId: 1,
      readCount: 1,
      enqueuedAt: new Date().toISOString(),
      message: { type: "evidence.document.version_created" },
    });

    expect(outcome).toEqual({ kind: "ARCHIVE" });
    expect(queues.sent).toEqual([]);
    expect(logger.lines[0]?.level).toBe("warn");
  });
});
