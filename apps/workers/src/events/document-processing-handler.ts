import {
  createJobSchema,
  JobIdSchema,
  UtcTimestampSchema,
  type CapitalQEvent,
  type EventRegistry,
} from "@capital-q/contracts";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import { TenantIdSchema, type TenantId } from "@capital-q/security";
import { randomUUID } from "node:crypto";

import type { MessageOutcome } from "../queue/runner.js";
import {
  DOCUMENTS_QUEUE,
  type QueueClient,
  type QueueMessage,
} from "../queue/pgmq.js";
import type { RunnerLogger } from "../outbox-runner.js";

/**
 * The domain-event consumer. Two events matter to this worker.
 *
 * `evidence.document.version_created` → `evidence.document.process`.
 *
 * A fact becomes an instruction here and nowhere else. The event says a
 * version exists; the job asks a worker to process it. They stay separate
 * concepts on separate queues, because a system that blurs them loses the
 * ability to reason about either.
 *
 * `evidence.document.ready` → the founder's onboarding review
 * (CQ-C5-R2B §7-§8).
 *
 * The READY event, not the version event: "a file was uploaded" is not "a
 * document can be read", and preparing a review from an unprocessed version
 * would produce a confident reading of nothing. Waiting for the pipeline's
 * own completion is what makes the trigger honest.
 *
 * Both events carry identifiers only. Everything else — the document, the
 * storage identity, the tenant, the company, whether a founder is even in a
 * journey — is resolved from the database, so a forged or stale message can
 * name a resource but never reach one.
 */

const PROCESS_TRIGGER_EVENT = "evidence.document.version_created";
const READY_EVENT = "evidence.document.ready";

const ProcessDocumentJobSchema = createJobSchema(ProcessDocumentJob.dataSchema);

export type DocumentProcessingHandlerOptions = {
  readonly registry: EventRegistry;
  readonly queues: QueueClient;
  readonly pipelineVersion: string;
  /**
   * The founder onboarding review, when this deployment composes one.
   * Optional: a worker without a model provider still processes documents,
   * and onboarding continues without a review rather than stalling on it.
   */
  readonly founderReview?:
    | {
        readonly onDocumentReady: (event: {
          readonly tenantId: TenantId;
          readonly documentId: string;
          readonly documentVersionId: string;
        }) => Promise<{ readonly kind: string }>;
      }
    | undefined;
  readonly logger: RunnerLogger;
};

type VersionCreatedData = {
  readonly documentId: string;
  readonly documentVersionId: string;
};

type DocumentReadyData = {
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
  const { registry, queues, founderReview, logger } = options;

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
    if (event.type !== PROCESS_TRIGGER_EVENT && event.type !== READY_EVENT) {
      return { kind: "ARCHIVE" };
    }
    if (event.tenantId === undefined) {
      logger.warn(
        { msgId: message.msgId, eventId: event.id },
        "document event carried no tenant; archived",
      );
      return { kind: "ARCHIVE" };
    }

    if (event.type === READY_EVENT) {
      if (founderReview === undefined) {
        return { kind: "ARCHIVE" };
      }
      const ready = event.data as DocumentReadyData;
      try {
        const outcome = await founderReview.onDocumentReady({
          // A queue message is untrusted input: the tenant is validated
          // here, at the boundary, before it names anything.
          tenantId: TenantIdSchema.parse(event.tenantId),
          documentId: ready.documentId,
          documentVersionId: ready.documentVersionId,
        });
        logger.info(
          {
            msgId: message.msgId,
            eventId: event.id,
            documentVersionId: ready.documentVersionId,
            outcome: outcome.kind,
          },
          "founder onboarding review handled",
        );
      } catch (error: unknown) {
        // The document is processed and retrievable either way. A failed
        // review is worth retrying, but it must never send the document
        // back through the pipeline, so it retries on its own message.
        logger.warn(
          { err: error, msgId: message.msgId, eventId: event.id },
          "founder onboarding review failed; retrying",
        );
        return { kind: "RETRY", errorCode: "FOUNDER_REVIEW_FAILED" };
      }
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
