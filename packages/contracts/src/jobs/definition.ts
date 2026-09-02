import { z } from "zod";

import { VersionSchema } from "../common/version.js";
import { MessageSensitivitySchema } from "../messaging/sensitivity.js";
import type { MessageSensitivity } from "../messaging/sensitivity.js";
import { JobTypeSchema } from "./envelope.js";

/**
 * Per-job retry configuration.
 *
 * Metadata only -- this package describes retry policy, it does not implement
 * one. There is deliberately no single global policy: a document extraction and
 * an outbound notification fail in different ways and should not share an
 * attempt count or a backoff curve.
 *
 * The presence of a policy is not licence to retry every exception. A handler
 * still classifies transient, permanent, validation and security failures, and
 * only the first is worth retrying.
 */
export const JobRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(100),
  visibilityTimeoutSeconds: z.number().int().min(1).max(86_400),
  backoff: z.object({
    strategy: z.enum(["FIXED", "EXPONENTIAL"]),
    initialDelaySeconds: z.number().int().min(0).max(3_600),
    maxDelaySeconds: z.number().int().min(0).max(86_400).optional(),
    /** Spreads retries so a shared dependency failure does not resynchronise. */
    jitter: z.boolean().optional(),
  }),
  /**
   * Failure classes worth retrying. An empty list is valid and means this job
   * is never retried automatically.
   */
  retryableErrorCodes: z.array(z.string().min(1).max(64)),
  deadLetter: z.boolean(),
});

export type JobRetryPolicy = z.infer<typeof JobRetryPolicySchema>;

/**
 * A derived idempotency key.
 *
 * Bounded and restricted to a safe character set so a key cannot become a
 * smuggling channel for payload content. Keys are written to queue storage and
 * logs, so they must never contain document text, private notes, tokens or
 * anything else confidential -- identifiers and version numbers only.
 */
export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9:_.@-]+$/,
    "expected a bounded key of identifiers and versions",
  );

export type IdempotencyStrategy<TData> = {
  /** Human-readable derivation, e.g. "documentId + processingPipelineVersion". */
  readonly describes: string;
  /**
   * Derive the key identifying this unit of work.
   *
   * Must be deterministic: the same work identity always yields the same key,
   * and genuinely different work yields a different one. This is what makes
   * at-least-once delivery survivable.
   */
  readonly derive: (data: TData) => string;
};

export type JobDefinition<TData extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly version: number;
  /** The bounded context that owns the job's meaning. */
  readonly owner: string;
  /** The context owning the handler that executes it. */
  readonly handlerOwner: string;
  readonly sensitivity: MessageSensitivity;
  readonly dataSchema: TData;
  readonly idempotency: IdempotencyStrategy<z.infer<TData>>;
  readonly retryPolicy: JobRetryPolicy;
  readonly description: string;
};

const definitionMetaSchema = z.object({
  name: JobTypeSchema,
  version: VersionSchema,
  owner: z.string().min(1).max(128),
  handlerOwner: z.string().min(1).max(128),
  sensitivity: MessageSensitivitySchema,
  retryPolicy: JobRetryPolicySchema,
  description: z.string().min(1).max(500),
});

export function defineJob<TData extends z.ZodType>(
  definition: JobDefinition<TData>,
): JobDefinition<TData> {
  definitionMetaSchema.parse({
    name: definition.name,
    version: definition.version,
    owner: definition.owner,
    handlerOwner: definition.handlerOwner,
    sensitivity: definition.sensitivity,
    retryPolicy: definition.retryPolicy,
    description: definition.description,
  });

  return Object.freeze({ ...definition });
}

/**
 * Derive and validate a job's idempotency key.
 *
 * The canonical job envelope deliberately carries no idempotencyKey field --
 * Document 22 does not define one, and adding it here would change the wire
 * contract to serve an implementation concern. Each definition derives its own,
 * and the queue runtime decides where the derived key is persisted.
 */
export function deriveIdempotencyKey<TData extends z.ZodType>(
  definition: JobDefinition<TData>,
  data: z.infer<TData>,
): string {
  return IdempotencyKeySchema.parse(definition.idempotency.derive(data));
}

export function jobKey(name: string, version: number): string {
  return `${name}@${String(version)}`;
}
