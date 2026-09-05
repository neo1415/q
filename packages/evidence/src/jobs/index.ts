import { z } from "zod";

import {
  defineJob,
  UuidSchema,
  type JobDefinition,
} from "@capital-q/contracts";

/**
 * Evidence jobs: work a worker performs, never facts.
 *
 *   evidence.document.version_created   a fact: bytes became a version
 *   evidence.document.process           an instruction: go process it
 *   evidence.document.ready             a fact: processing finished
 *
 * The payload names what to look at and nothing else. It carries no bytes,
 * no extracted text, no storage key and no signed URL: a queue message
 * outlives the work through retries and dead-letter records, and confidential
 * material must not live there. The worker resolves everything it needs from
 * the database, and the identifiers in the payload confer no authority.
 */

export const PROCESS_DOCUMENT_JOB_DATA = z
  .object({
    documentVersionId: UuidSchema,
    /** Which processing behaviour to apply; a new one is a new run. */
    pipelineVersion: z.string().min(1).max(64),
  })
  .strict();

export type ProcessDocumentJobData = z.infer<typeof PROCESS_DOCUMENT_JOB_DATA>;

export const ProcessDocumentJob = defineJob({
  name: "evidence.document.process",
  version: 1,
  owner: "@capital-q/evidence",
  handlerOwner: "@capital-q/workers",
  // The instruction names a confidential resource even though it carries
  // none of its content.
  sensitivity: "CONFIDENTIAL",
  dataSchema: PROCESS_DOCUMENT_JOB_DATA,
  idempotency: {
    describes: "documentVersionId + pipelineVersion",
    derive: (data) => `${data.documentVersionId}:${data.pipelineVersion}`,
  },
  retryPolicy: {
    maxAttempts: 5,
    // Comfortably longer than a bounded parser run plus its storage reads,
    // so a slow document is not redelivered while it is still being read.
    visibilityTimeoutSeconds: 300,
    backoff: {
      strategy: "EXPONENTIAL",
      initialDelaySeconds: 15,
      maxDelaySeconds: 900,
      jitter: true,
    },
    /**
     * Only failures another attempt could plausibly fix. An unsupported
     * format, a decompression refusal, a malformed package or an infected
     * object are decisions, not outages: retrying them forever is how a
     * poison document becomes a permanent load.
     */
    retryableErrorCodes: [
      "STORAGE_UNAVAILABLE",
      "DATABASE_UNAVAILABLE",
      "SCANNER_UNAVAILABLE",
      "PARSER_TIMEOUT",
      "WORKER_INTERRUPTED",
    ],
    deadLetter: true,
  },
  description:
    "Extract structure from one immutable document version under one processing pipeline version.",
});

export const EVIDENCE_JOBS: readonly JobDefinition[] = [ProcessDocumentJob];
