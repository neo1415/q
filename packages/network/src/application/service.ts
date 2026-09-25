import type { ActorContext } from "@capital-q/security";

import type { Interest } from "../contracts/index.js";
import {
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
} from "../domain/event-registry.js";
import {
  createPostgresInterestRepository,
  createPostgresInterestRequestStore,
  createPostgresInterestResponseRepository,
  createPostgresInterestResponseRequestStore,
} from "../infrastructure/postgres-interest-repositories.js";
import {
  createListRelationshipsForCompany,
  createListRelationshipsForInvestor,
  createRelationshipForCompany,
  createRelationshipForInvestor,
  type RelationshipListing,
  type RelationshipStatus,
} from "./relationship-status.js";
import {
  createListIncomingInterest,
  createMayRespondToInterest,
  createRespondToInterest,
  type IncomingInterest,
  type RespondToInterestCommand,
  type RespondToInterestResult,
} from "./respond-to-interest.js";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
} from "../infrastructure/postgres-repositories.js";
import {
  createExpressInterest,
  createGetOwnInterest,
  createMayExpressInterest,
  type ExpressInterestCommand,
  type ExpressInterestDependencies,
  type ExpressInterestResult,
} from "./express-interest.js";
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
import type {
  InterestRepository,
  InterestRequestStore,
  InterestResponseRepository,
  InterestResponseRequestStore,
  RelationshipQueryPort,
} from "./ports.js";

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

/** Express Interest and the investor's own status read (CQ-NET-010). */
export type InterestService = {
  readonly expressInterest: (
    command: ExpressInterestCommand,
  ) => Promise<ExpressInterestResult>;
  readonly getOwnInterest: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }) => Promise<Interest | null>;
  /** The command's authorisation only; writes nothing. */
  readonly mayExpressInterest: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }) => Promise<boolean>;
  /** The company's inbox (CQ-NET-011). */
  readonly listIncomingInterest: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }) => Promise<readonly IncomingInterest[]>;
  /** Accept or decline, as the company (CQ-NET-011). */
  readonly respondToInterest: (
    command: RespondToInterestCommand,
  ) => Promise<RespondToInterestResult>;
  /** The answer's authorisation only; writes nothing. */
  readonly mayRespondToInterest: (query: {
    readonly actor: ActorContext;
    readonly interestId: string;
  }) => Promise<boolean>;
  /** "Where are we with this company?", for an investor (CQ-NET-012). */
  readonly relationshipForInvestor: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }) => Promise<RelationshipStatus | null>;
  /** "Where are we with this investor?", for a company (CQ-NET-012). */
  readonly relationshipForCompany: (query: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
  }) => Promise<RelationshipStatus | null>;
  /** An investor organisation's own relationships (CQ-WEB-030). */
  readonly listRelationshipsForInvestor: (query: {
    readonly actor: ActorContext;
  }) => Promise<readonly RelationshipListing[]>;
  /** A company's own relationships it can see anything of (CQ-WEB-030). */
  readonly listRelationshipsForCompany: (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }) => Promise<readonly RelationshipListing[]>;
};

export type InterestServiceOptions = NetworkServiceOptions &
  Pick<
    ExpressInterestDependencies,
    "authorization" | "investorSubject" | "companyVisibility"
  > & {
    readonly interests?: InterestRepository | undefined;
    readonly interestRequests?: InterestRequestStore | undefined;
    readonly interestResponses?: InterestResponseRepository | undefined;
    readonly interestResponseRequests?:
      InterestResponseRequestStore | undefined;
  };

export function createInterestService(
  options: InterestServiceOptions,
): InterestService {
  const dependencies: ExpressInterestDependencies = {
    ...options,
    registry:
      options.registry ??
      createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: options.repositories ?? {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
    interests: options.interests ?? createPostgresInterestRepository(),
    interestRequests:
      options.interestRequests ?? createPostgresInterestRequestStore(),
    interestResponses:
      options.interestResponses ?? createPostgresInterestResponseRepository(),
    interestResponseRequests:
      options.interestResponseRequests ??
      createPostgresInterestResponseRequestStore(),
  };
  return {
    expressInterest: createExpressInterest(dependencies),
    getOwnInterest: createGetOwnInterest(dependencies),
    mayExpressInterest: createMayExpressInterest(dependencies),
    listIncomingInterest: createListIncomingInterest(dependencies),
    respondToInterest: createRespondToInterest(dependencies),
    mayRespondToInterest: createMayRespondToInterest(dependencies),
    relationshipForInvestor: createRelationshipForInvestor(dependencies),
    relationshipForCompany: createRelationshipForCompany(dependencies),
    listRelationshipsForInvestor:
      createListRelationshipsForInvestor(dependencies),
    listRelationshipsForCompany:
      createListRelationshipsForCompany(dependencies),
  };
}
