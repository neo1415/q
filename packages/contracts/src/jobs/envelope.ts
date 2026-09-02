import { z } from "zod";

import {
  CausationIdSchema,
  CorrelationIdSchema,
  createUuidIdSchema,
  UuidSchema,
} from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { VersionSchema } from "../common/version.js";

/**
 * Identifies one job instance. Distinct from EventId: a job is work to perform,
 * an event is a fact that happened, and conflating their identifiers conflates
 * the two concepts.
 */
export const JobIdSchema = createUuidIdSchema("JobId");
export type JobId = z.infer<typeof JobIdSchema>;

/**
 * Job names read `<context>.<entity-or-capability>.<imperative-action>`:
 *
 *   evidence.document.process
 *   knowledge.subject.reassess
 *   recommendation.slate.rebuild
 *
 * Same structural rule as events, opposite tense. A job is an instruction, so
 * `evidence.document.processed` is wrong here -- that names a fact and belongs
 * to an event. As with events the schema enforces structure only; tense is a
 * review rule, because no regex can tell an imperative from a past participle.
 */
const MESSAGE_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2}$/;

export const JobTypeSchema = z
  .string()
  .regex(
    MESSAGE_NAME,
    "expected <context>.<entity>.<imperative_action> in lower_snake_case",
  )
  .max(128);

export type JobType = z.infer<typeof JobTypeSchema>;

const jobEnvelopeShape = {
  id: JobIdSchema,
  type: JobTypeSchema,

  /** Semantic version of this job type's payload. Starts at 1. */
  jobVersion: VersionSchema,

  /**
   * Optional on the generic envelope, required by any tenant-owned job
   * definition. A job never escapes tenant authorization by virtue of running
   * in a worker: the handler still resolves and checks tenancy before touching
   * anything the payload names.
   */
  tenantId: UuidSchema.optional(),

  correlationId: CorrelationIdSchema.optional(),
  causationId: CausationIdSchema.optional(),

  createdAt: UtcTimestampSchema,

  /**
   * Delivery attempt, maintained by the queue runtime. Positive when present;
   * absent on a job that has not been dispatched yet.
   */
  attempt: VersionSchema.optional(),
};

/**
 * Build the schema for a job carrying `dataSchema` as its payload.
 *
 * Payloads carry identifiers and small configuration references -- a document
 * id and a pipeline version, not the document. Sending the artefact itself
 * copies confidential material into queue storage, retries and dead-letter
 * records, where it long outlives the work.
 */
export function createJobSchema<TData extends z.ZodType>(dataSchema: TData) {
  return z.object({ ...jobEnvelopeShape, data: dataSchema });
}

/** The envelope with an unvalidated payload, for routing before schema lookup. */
export const JobEnvelopeSchema = z.object({
  ...jobEnvelopeShape,
  data: z.unknown(),
});

export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

export type CapitalQJob<TData> = Omit<JobEnvelope, "data"> & {
  readonly data: TData;
};
