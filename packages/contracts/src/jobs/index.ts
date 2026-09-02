/**
 * Jobs: instructions to perform work.
 *
 * A job is not an event. `evidence.document.process` asks a worker to do
 * something; `evidence.document.ready` reports that something happened. The two
 * travel through related infrastructure but mean opposite things, and a system
 * that blurs them loses the ability to reason about either.
 *
 * A job carries no authority. Running inside a worker does not exempt a handler
 * from tenant isolation or permission checks: identifiers in a payload say what
 * to look at, never what the handler may do with it.
 */

export {
  createJobSchema,
  JobEnvelopeSchema,
  JobIdSchema,
  JobTypeSchema,
  type CapitalQJob,
  type JobEnvelope,
  type JobId,
  type JobType,
} from "./envelope.js";

export {
  defineJob,
  deriveIdempotencyKey,
  IdempotencyKeySchema,
  jobKey,
  JobRetryPolicySchema,
  type IdempotencyStrategy,
  type JobDefinition,
  type JobRetryPolicy,
} from "./definition.js";

export { createJobRegistry, type JobRegistry } from "./registry.js";
