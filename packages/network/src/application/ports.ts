import type { CompanyId } from "@capital-q/companies";
import type {
  CorrelationId,
  DisclosureScope,
  RelationshipSourceType,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { InvestorOrganisationId } from "@capital-q/investors";
import type { ActorType, TenantId } from "@capital-q/security";

import type {
  Interest,
  InterestParty,
  InterestDecision,
  InterestId,
  InterestResponseId,
  MatchId,
  Relationship,
  RelationshipEvent,
  RelationshipEventId,
  RelationshipId,
} from "../contracts/index.js";
import type { PassStanding } from "../domain/reapproach.js";

/**
 * Application-owned persistence ports. Specific to the relationship spine;
 * no generic repository. Writes take the caller's transaction so a
 * relationship, its first history row, its audit record and its domain
 * event commit together. Nothing here sets `current_state` from outside:
 * the projector (CQ-NET-012) is the only future writer.
 */

export type RelationshipRepository = {
  readonly findById: (
    executor: DatabaseExecutor,
    relationshipId: RelationshipId,
  ) => Promise<Relationship | null>;
  /** The canonical pair lookup. Indexed by the pair unique constraint. */
  readonly findByParties: (
    executor: DatabaseExecutor,
    companyId: CompanyId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<Relationship | null>;
  /** Serialises first creation of one pair until commit. */
  readonly lockPair: (
    tx: TransactionContext,
    companyId: CompanyId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<void>;
  readonly insert: (
    tx: TransactionContext,
    input: {
      /** The company's tenant (ADR 0003). */
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly investorOrganisationId: InvestorOrganisationId;
    },
  ) => Promise<Relationship>;
  /**
   * Increments and returns the relationship's event sequence under its row
   * lock. Rolled-back callers release the value with the transaction, so
   * committed sequences are unique and gapless.
   */
  readonly allocateNextEventSequence: (
    tx: TransactionContext,
    relationshipId: RelationshipId,
  ) => Promise<number>;
  readonly listByCompany: (
    executor: DatabaseExecutor,
    companyId: CompanyId,
    limit: number,
  ) => Promise<readonly Relationship[]>;
  readonly listByInvestorOrganisation: (
    executor: DatabaseExecutor,
    investorOrganisationId: InvestorOrganisationId,
    limit: number,
  ) => Promise<readonly Relationship[]>;
  /**
   * The projector's write (CQ-NET-012), and the only writer of
   * `current_state`. Applied only when the fold reaches further than the
   * cached one, or equally far under another projector version (a
   * rebuild): a replayed or out-of-order projection can never move the
   * cache backwards. True when the row changed.
   */
  readonly recordProjection: (
    executor: DatabaseExecutor,
    input: {
      readonly relationshipId: RelationshipId;
      readonly state: string;
      readonly stateSince: string;
      readonly throughSequence: number;
      readonly version: string;
    },
  ) => Promise<boolean>;
  /** Keyset page of relationship ids, optionally only those whose projection is behind. */
  readonly listIdsForProjection: (
    executor: DatabaseExecutor,
    page: {
      readonly after: RelationshipId | null;
      readonly limit: number;
      readonly onlyBehind: boolean;
      /**
       * The current projector version: a cache folded by another version
       * is behind too, so a rebuild rolls a new version out from history.
       */
      readonly version?: string | undefined;
    },
  ) => Promise<readonly RelationshipId[]>;
};

export type NewRelationshipEvent = {
  readonly tenantId: TenantId;
  readonly relationshipId: RelationshipId;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly sourceType: RelationshipSourceType;
  readonly sourceId: string | null;
  readonly visibilityScope: DisclosureScope;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId: CorrelationId;
};

export type RelationshipEventRepository = {
  readonly append: (
    tx: TransactionContext,
    input: NewRelationshipEvent,
  ) => Promise<RelationshipEvent>;
  readonly findById: (
    executor: DatabaseExecutor,
    relationshipEventId: RelationshipEventId,
  ) => Promise<RelationshipEvent | null>;
  readonly listByRelationship: (
    executor: DatabaseExecutor,
    relationshipId: RelationshipId,
    page: {
      readonly afterSequence?: number | undefined;
      readonly limit: number;
    },
  ) => Promise<readonly RelationshipEvent[]>;
};

/**
 * Express Interest's own record (CQ-NET-010). Insert-only here: withdrawal
 * belongs to a later packet, and nothing in this port changes a status.
 */
export type InterestRepository = {
  readonly findById: (
    executor: DatabaseExecutor,
    interestId: InterestId,
  ) => Promise<Interest | null>;
  /** One party's open interest on this relationship, if any (default: the investor's). */
  readonly findOpenByRelationship: (
    executor: DatabaseExecutor,
    relationshipId: RelationshipId,
    party?: InterestParty,
  ) => Promise<Interest | null>;
  /** Open investor interests addressed to one company, newest first, with their answers. */
  readonly listByCompany: (
    executor: DatabaseExecutor,
    companyId: CompanyId,
    limit: number,
  ) => Promise<readonly Interest[]>;
  /** Open Connection Requests addressed to one investor organisation, newest first (ADR 0023). */
  readonly listByInvestor: (
    executor: DatabaseExecutor,
    investorOrganisationId: InvestorOrganisationId,
    limit: number,
  ) => Promise<readonly Interest[]>;
  readonly insert: (
    tx: TransactionContext,
    input: {
      readonly id: InterestId;
      readonly tenantId: TenantId;
      readonly relationshipId: RelationshipId;
      /** Absent: the investor, as before ADR 0023. */
      readonly expressedByParty?: InterestParty;
      readonly expressedByUserId: string;
      readonly expressedInOrganisationId: string;
      readonly relationshipEventId: RelationshipEventId;
    },
  ) => Promise<Interest>;
};

/** Hashes only: (person, organisation, key hash) -> the interest the command resolved to. */
export type InterestRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: string,
    organisationId: string,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: string,
    organisationId: string,
    idempotencyKeyHash: string,
  ) => Promise<{
    readonly requestHash: string;
    readonly interestId: InterestId;
  } | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: string;
      readonly organisationId: string;
      readonly tenantId: TenantId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly interestId: InterestId;
    },
  ) => Promise<void>;
};

/**
 * The company's answer (CQ-NET-011). Insert-only: one answer per interest
 * (the database refuses a second), and a match only for an acceptance.
 */
export type InterestResponseRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: {
      readonly id: InterestResponseId;
      readonly tenantId: TenantId;
      readonly relationshipId: RelationshipId;
      readonly interestId: InterestId;
      readonly decision: InterestDecision;
      readonly respondedByUserId: string;
      readonly respondedInOrganisationId: string;
      /** Absent: the company, as before ADR 0023. */
      readonly respondedByParty?: InterestParty;
      readonly relationshipEventId: RelationshipEventId;
    },
  ) => Promise<void>;
  readonly insertMatch: (
    tx: TransactionContext,
    input: {
      readonly id: MatchId;
      readonly tenantId: TenantId;
      readonly relationshipId: RelationshipId;
      readonly interestResponseId: InterestResponseId;
    },
  ) => Promise<void>;
};

/** Hashes only: (person, organisation, key hash) -> the interest answered. */
export type InterestResponseRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: string,
    organisationId: string,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: string,
    organisationId: string,
    idempotencyKeyHash: string,
  ) => Promise<{
    readonly requestHash: string;
    readonly interestId: InterestId;
  } | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: string;
      readonly organisationId: string;
      readonly tenantId: TenantId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly interestResponseId: InterestResponseId;
    },
  ) => Promise<void>;
};

/**
 * The narrow read port future relationship APIs, Interest/Match commands,
 * the projector and Q consult. Permission-neutral: a caller that has not
 * applied party and disclosure rules (CQ-PERM-001) must not forward what it
 * reads here to anyone.
 */
export type RelationshipQueryPort = {
  readonly getById: (
    relationshipId: RelationshipId,
  ) => Promise<Relationship | null>;
  readonly findByParties: (
    companyId: CompanyId,
    investorOrganisationId: InvestorOrganisationId,
  ) => Promise<Relationship | null>;
  readonly listEvents: (
    relationshipId: RelationshipId,
    page?: {
      readonly afterSequence?: number | undefined;
      readonly limit?: number | undefined;
    },
  ) => Promise<readonly RelationshipEvent[]>;
  /** One history row by id, for disclosure resolution (CQ-PERM-001). Permission-neutral. */
  readonly getEventById: (
    relationshipEventId: RelationshipEventId,
  ) => Promise<RelationshipEvent | null>;
  /**
   * The current pass's time and the mandate it was made under (doc 19
   * §67), for the re-approach rule; never its reason. Permission-neutral.
   * Absent: a passed relationship stays closed to discovery.
   */
  readonly passStanding?:
    | ((relationshipId: RelationshipId) => Promise<PassStanding | null>)
    | undefined;
};
