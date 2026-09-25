import type { EventRegistry } from "@capital-q/contracts";
import {
  RelationshipIdSchema,
  type RelationshipStateProjector,
} from "@capital-q/network";
import { NETWORK_EVENTS } from "@capital-q/network/events";

import type { RunnerLogger } from "../outbox-runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { MessageOutcome } from "../queue/runner.js";

/**
 * The relationship state projector's consumer (CQ-NET-012).
 *
 * Every Network announcement names a relationship; that is all this reads
 * from the message. The projector then re-reads the relationship's whole
 * ordered history and folds it, so a duplicate, a replay or an
 * out-of-order delivery all converge on the same state, and the cache is
 * written with a compare-and-set that can never move it backwards. A
 * failure retries; the inner handler still sees every message, because
 * other consumers read the same queue.
 */

const NETWORK_EVENT_TYPES: ReadonlySet<string> = new Set(
  NETWORK_EVENTS.map((definition) => definition.name),
);

export type RelationshipProjectionOptions = {
  readonly registry: EventRegistry;
  readonly projector: Pick<RelationshipStateProjector, "project">;
  readonly logger: RunnerLogger;
};

export function withRelationshipProjection(
  inner: (message: QueueMessage) => Promise<MessageOutcome>,
  options: RelationshipProjectionOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { registry, projector, logger } = options;
  return async (message) => {
    const parsed = registry.parse(message.message);
    if (!parsed.ok || !NETWORK_EVENT_TYPES.has(parsed.message.type)) {
      return inner(message);
    }
    const data: unknown = parsed.message.data;
    const raw =
      typeof data === "object" && data !== null && "relationshipId" in data
        ? data.relationshipId
        : undefined;
    const relationshipId = RelationshipIdSchema.safeParse(raw);
    if (!relationshipId.success) return inner(message);

    const fields = {
      msgId: message.msgId,
      eventId: parsed.message.id,
      eventType: parsed.message.type,
      relationshipId: relationshipId.data,
    };
    try {
      const { projection, changed } = await projector.project(
        relationshipId.data,
      );
      logger.info(
        {
          ...fields,
          state: projection?.state ?? null,
          throughSequence: projection?.throughSequence ?? null,
          anomalies: projection?.anomalies.length ?? 0,
          changed,
        },
        "relationship state projected",
      );
    } catch (error: unknown) {
      logger.warn(
        { ...fields, err: error },
        "relationship state projection failed; retrying",
      );
      return { kind: "RETRY", errorCode: "RELATIONSHIP_PROJECTION_FAILED" };
    }
    return inner(message);
  };
}
