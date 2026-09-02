/**
 * @capital-q/eventing/publisher
 *
 * Worker-side infrastructure: turns committed outbox rows into durable queue
 * messages. Imported by apps/workers only; every other package reaches the
 * pipeline through OutboxWriter on the root entrypoint. Lint enforces it.
 */

export type { EventDispatcher } from "./dispatcher.js";
export { createPgmqEventDispatcher } from "./pgmq-dispatcher.js";
export {
  createOutboxPublisher,
  OUTBOX_DEFAULT_BATCH_SIZE,
  OUTBOX_MAX_BATCH_SIZE,
  type OutboxPublishOutcome,
  type OutboxPublishRecord,
  type OutboxPublisher,
  type OutboxPublisherOptions,
  type PublishBatchResult,
} from "./outbox-publisher.js";
export {
  createOutboxRetryPolicy,
  DEFAULT_MAX_ATTEMPTS,
  exponentialBackoffSeconds,
  type OutboxRetryPolicy,
} from "./retry-policy.js";
