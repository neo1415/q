import { DOMAIN_EVENTS_QUEUE } from "../queue.js";
import type { EventDispatcher } from "./dispatcher.js";

/**
 * Publishes to the pgmq `domain-events` queue through the server's own
 * PostgreSQL connection. No queue SDK, no HTTP, no credentials beyond the
 * connection the caller already holds.
 *
 * The message is the canonical CapitalQEvent only. Outbox bookkeeping (row
 * id, attempts, errors) never reaches the queue, so consumers cannot come to
 * depend on it.
 *
 * Delivery is at least once. pgmq's visibility timeout, a consumer crash,
 * a manual replay or a worker restart can each present one message twice;
 * consumers dedupe by EventId.
 */
export function createPgmqEventDispatcher(): EventDispatcher {
  return {
    publish: async (tx, event) => {
      await tx.sql`
        select pgmq.send(${DOMAIN_EVENTS_QUEUE}, ${JSON.stringify(event)}::text::jsonb)`;
    },
  };
}
