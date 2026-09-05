import {
  createJobSchema,
  JobIdSchema,
  UtcTimestampSchema,
  type CapitalQEvent,
  type EventRegistry,
} from "@capital-q/contracts";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import { randomUUID } from "node:crypto";

import type { MessageOutcome } from "../queue/runner.js";
import {
  DOCUMENTS_QUEUE,
  type QueueClient,
  type QueueMessage,
} from "../queue/pgmq.js";
import type { RunnerLogger } from "../outbox-runner.js";

/**
 * `evidence.document.version_created` → `evidence.document.process`.
 *
 * A fact becomes an instruction here and nowhere else. The event says a
 * version exists; the job asks a worker to process it. They stay separate
 * concepts on separate queues, because a system that blurs them loses the
 * ability to reason about either.
 *
 * The job carries two identifiers. Everything else the pipeline needs — the
 * document, the storage identity, the tenant, whether processing is even
 * eligible — the worker resolves from the database, so a forged or stale
 * message can name a resource but never reach one.
 */

const TRIGGER_EVENT = "evidence.document.version_created";

const ProcessDocumentJobSchema = createJobSchema(ProcessDocumentJob.dataSchema);

export type DocumentProcessingHandlerOptions = {
  readonly registry: EventRegistry;
  readonly queues: QueueClient;
  readonly pipelineVersion: string;
  readonly logger: RunnerLogger;
};

type VersionCreatedData = {
  readonly documentId: string;
  readonly documentVersionId: string;
};

/**
 * Handles one `domain-events` message. Events this worker has no handler for
 * are archived rather than deleted: they are history, and another consumer's
 * absence today is not a reason to lose them.
 */
export function createDomainEventHandler(
  options: DocumentProcessingHandlerOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { registry, queues, logger } = options;

  return async (message) => {
    const parsed = registry.parse(message.message);
    if (!parsed.ok) {
      // An event this build cannot validate is kept, not silently dropped:
      // a newer producer's event is history we may need to replay.
      logger.warn(
        { msgId: message.msgId, rejection: parsed.rejection },
        "domain event not understood; archived unhandled",
      );
      return { kind: "ARCHIVE" };
    }

    const event: CapitalQEvent<unknown> = parsed.message;
    if (event.type !== TRIGGER_EVENT) {
      return { kind: "ARCHIVE" };
    }
    if (event.tenantId === undefined) {
      logger.warn(
        { msgId: message.msgId, eventId: event.id },
        "document version event carried no tenant; archived",
      );
      return { kind: "ARCHIVE" };
    }

    const data = event.data as VersionCreatedData;
    const job = ProcessDocumentJobSchema.parse({
      id: JobIdSchema.parse(randomUUID()),
      type: ProcessDocumentJob.name,
      jobVersion: ProcessDocumentJob.version,
      tenantId: event.tenantId,
      ...(event.correlationId === undefined
        ? {}
        : { correlationId: event.correlationId }),
      // The event that caused this work, so the chain stays traceable.
      causationId: `cau_${event.id}`,
      createdAt: UtcTimestampSchema.parse(new Date().toISOString()),
      data: {
        documentVersionId: data.documentVersionId,
        pipelineVersion: options.pipelineVersion,
      },
    });

    await queues.send(DOCUMENTS_QUEUE, job);
    logger.info(
      {
        msgId: message.msgId,
        eventId: event.id,
        documentVersionId: data.documentVersionId,
        pipelineVersion: options.pipelineVersion,
      },
      "document processing job enqueued",
    );
    // The event is kept as history; the job now carries the work forward. A
    // redelivery enqueues a second job, which the pipeline's processing-run
    // uniqueness absorbs.
    return { kind: "ARCHIVE" };
  };
}
