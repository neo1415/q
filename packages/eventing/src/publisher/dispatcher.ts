import type { CapitalQEvent } from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";

/**
 * Hands a validated canonical event to the durable queue.
 *
 * Exists for the publisher alone. Domain code never calls it: emitting an
 * event means writing the outbox inside the business transaction, and the
 * publisher is the only component that turns an outbox row into a queue
 * message.
 *
 * It takes the publisher's transaction so that, while the queue lives in the
 * same database, the send and the published_at mark commit together.
 */
export type EventDispatcher = {
  readonly publish: (
    tx: TransactionContext,
    event: CapitalQEvent<unknown>,
  ) => Promise<void>;
};
