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
  Relationship,
  RelationshipEvent,
  RelationshipEventId,
  RelationshipId,
} from "../contracts/index.js";

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
};
