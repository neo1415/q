import {
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
} from "../domain/event-registry.js";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
} from "../infrastructure/postgres-repositories.js";
import {
  createRelationshipEventAppender,
  type RelationshipEventAppender,
} from "./append-event.js";
import type { NetworkServiceDependencies } from "./dependencies.js";
import {
  createEnsureRelationship,
  type EnsuredRelationship,
  type EnsureRelationshipCommand,
} from "./ensure-relationship.js";
import type { RelationshipQueryPort } from "./ports.js";

/**
 * The Network application service consumed by later owning workflows
 * (Express Interest, GateQ, Match ...) and, through the query port, by the
 * projector and Q tools. It exposes no HTTP surface and no state setter.
 */
export type NetworkService = {
  readonly ensureRelationship: (
    command: EnsureRelationshipCommand,
  ) => Promise<EnsuredRelationship>;
  readonly events: RelationshipEventAppender;
  readonly query: RelationshipQueryPort;
};

export type NetworkServiceOptions = Omit<
  NetworkServiceDependencies,
  "repositories" | "registry"
> & {
  readonly repositories?:
    NetworkServiceDependencies["repositories"] | undefined;
  readonly registry?: NetworkServiceDependencies["registry"] | undefined;
};

export function createNetworkService(
  options: NetworkServiceOptions,
): NetworkService {
  const dependencies: NetworkServiceDependencies = {
    ...options,
    registry:
      options.registry ??
      createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: options.repositories ?? {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  };
  const { sql, repositories } = dependencies;
  return {
    ensureRelationship: createEnsureRelationship(dependencies),
    events: createRelationshipEventAppender(dependencies),
    query: {
      getById: (relationshipId) =>
        repositories.relationships.findById(sql, relationshipId),
      findByParties: (companyId, investorOrganisationId) =>
        repositories.relationships.findByParties(
          sql,
          companyId,
          investorOrganisationId,
        ),
      listEvents: (relationshipId, page = {}) =>
        repositories.events.listByRelationship(sql, relationshipId, {
          afterSequence: page.afterSequence,
          limit: page.limit ?? 100,
        }),
      getEventById: (relationshipEventId) =>
        repositories.events.findById(sql, relationshipEventId),
    },
  };
}
