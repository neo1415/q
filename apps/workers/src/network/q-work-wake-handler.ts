import type { EventRegistry } from "@capital-q/contracts";
import {
  RelationshipInterestDeclinedEvent,
  RelationshipMatchedEvent,
} from "@capital-q/network/events";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * Wakes Q's waiting work when a relationship moves (founder direction
 * 2026-10-01): "once the person connects, it fires immediately and
 * continues". On `network.relationship.matched` (they accepted, either
 * direction: an investor's interest or a founder's request) and
 * `network.relationship.interest_declined`, announce the relationship id
 * on the `q_work_wake` channel; the Q API continues every errand and
 * delegation waiting on it at once.
 *
 * Runs inside the relationship projection (so the state Q re-reads is
 * already projected), and is idempotent: the announcement is only a
 * wake-up, and a second one finds the work already moved on. A failed
 * announcement is retried with the message; the Q API's own tick is the
 * last safety net.
 */

const WAKING: ReadonlySet<string> = new Set([
  RelationshipMatchedEvent.name,
  RelationshipInterestDeclinedEvent.name,
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QWorkWakeOptions = {
  readonly registry: EventRegistry;
  readonly channel: string;
  /** `select pg_notify(channel, payload)`, as the composition provides it. */
  readonly notify: (channel: string, payload: string) => Promise<void>;
  readonly logger: RunnerLogger;
};

export function withQWorkWake(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: QWorkWakeOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  return async (message) => {
    const parsed = options.registry.parse(message.message);
    if (!parsed.ok || !WAKING.has(parsed.message.type)) return inner(message);
    const data: unknown = parsed.message.data;
    const relationshipId =
      typeof data === "object" &&
      data !== null &&
      "relationshipId" in data &&
      typeof data.relationshipId === "string" &&
      UUID.test(data.relationshipId)
        ? data.relationshipId
        : null;
    if (relationshipId === null) return inner(message);
    try {
      await options.notify(options.channel, relationshipId);
      options.logger.info(
        {
          msgId: message.msgId,
          eventType: parsed.message.type,
          relationshipId,
        },
        "q work wake announced",
      );
    } catch (error: unknown) {
      options.logger.warn(
        { msgId: message.msgId, relationshipId, err: error },
        "q work wake not announced; retrying",
      );
      return { kind: "RETRY", errorCode: "Q_WORK_WAKE_FAILED" };
    }
    return inner(message);
  };
}
