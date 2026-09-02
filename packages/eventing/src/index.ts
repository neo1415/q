/**
 * @capital-q/eventing
 *
 * Owns: the transactional outbox (writer and publisher), the event dispatch
 * port and its pgmq adapter, and the publisher retry policy (AEC-036,
 * ERA-041). Does not own event definitions, domain event semantics, business
 * logic or worker process lifecycle.
 *
 * Domain and application packages import this entrypoint for OutboxWriter and
 * nothing else. Queue publication lives behind `@capital-q/eventing/publisher`
 * and is imported only by the worker deployable; lint enforces the split.
 *
 * Required emission pattern for every future domain (no real company code
 * exists yet; the shape is what matters):
 *
 *   await transactions.run(async (tx) => {
 *     await companyRepository.update(tx, company);
 *     await outbox.enqueue(tx, companyUpdatedEvent({ ...actor, ...ids }));
 *   });
 *
 * Never: commit, then publish to a queue as a second write.
 */

export { DOMAIN_EVENTS_QUEUE } from "./queue.js";
export {
  createOutboxWriter,
  type OutboxEnqueueOptions,
  type OutboxEnqueueResult,
  type OutboxWriter,
  type OutboxWriterOptions,
} from "./outbox-writer.js";
export { OutboxEventConflictError, OutboxEventInvalidError } from "./errors.js";

export const PACKAGE_NAME = "@capital-q/eventing" as const;
