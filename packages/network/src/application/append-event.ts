import type {
  CorrelationId,
  DisclosureScope,
  RelationshipSourceType,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";

import type {
  RelationshipEvent,
  RelationshipEventActor,
  RelationshipId,
} from "../contracts/index.js";
import { RelationshipNotFoundError } from "../domain/errors.js";
import type { NetworkServiceDependencies } from "./dependencies.js";

/**
 * The validated, transactional history append primitive.
 *
 * Owning workflows (Express Interest, Match, meetings ...) call this inside
 * their own transaction after their own authorisation: type, scope and
 * payload are validated against the Network registry, the next sequence is
 * allocated under the relationship row lock, and the row is inserted. There
 * is deliberately no detached variant: a material relationship event never
 * commits on its own.
 */

export type AppendRelationshipEventInput = {
  readonly relationshipId: RelationshipId;
  readonly eventType: string;
  /** Server time when omitted. Never a browser timestamp. */
  readonly occurredAt?: string | undefined;
  /** Trusted: resolved by the owning workflow, never from a client body. */
  readonly actor: RelationshipEventActor;
  readonly source: {
    readonly type: RelationshipSourceType;
    readonly id?: string | undefined;
  };
  /** Chosen by the owning workflow's semantics; there is no default. */
  readonly visibilityScope: DisclosureScope;
  readonly payload: unknown;
  readonly correlationId: CorrelationId;
};

export type RelationshipEventAppender = {
  readonly append: (
    tx: TransactionContext,
    input: AppendRelationshipEventInput,
  ) => Promise<RelationshipEvent>;
};

export function createRelationshipEventAppender(
  dependencies: Pick<NetworkServiceDependencies, "registry" | "repositories">,
): RelationshipEventAppender {
  const { registry, repositories } = dependencies;
  return {
    append: async (tx, input) => {
      const payload = registry.validate({
        eventType: input.eventType,
        visibilityScope: input.visibilityScope,
        payload: input.payload,
      });
      const relationship = await repositories.relationships.findById(
        tx.sql,
        input.relationshipId,
      );
      if (relationship === null) {
        throw new RelationshipNotFoundError();
      }
      const sequence =
        await repositories.relationships.allocateNextEventSequence(
          tx,
          relationship.id,
        );
      return repositories.events.append(tx, {
        tenantId: relationship.tenantId,
        relationshipId: relationship.id,
        sequence,
        eventType: input.eventType,
        occurredAt: input.occurredAt ?? null,
        actorType: input.actor.type,
        actorId: input.actor.id,
        sourceType: input.source.type,
        sourceId: input.source.id ?? null,
        visibilityScope: input.visibilityScope,
        payload,
        correlationId: input.correlationId,
      });
    },
  };
}
